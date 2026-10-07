import { randomUUID } from 'node:crypto';
import fetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';

export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const APP_BUNDLE_SOURCE = /<script\b[^>]*\bsrc\s*=\s*["']([^"']*\/app-[^"']+\.js(?:\?[^"']*)?)["']/i;
// The bundle puts clientId after "production" within the same configuration block.
const PRODUCTION_CLIENT_ID = /["']production["'][^}]*\bclientId\s*:\s*["']([a-zA-Z0-9_-]+)["']/;

interface Endpoints {
  login: string;
  token: string;
  tokenInfo: string;
  graphql: string;
}
export interface WealthsimpleOptions {
  /** Application/test configuration only, never incoming request values. */
  endpoints?: Partial<Endpoints>;
  fetch?: typeof globalThis.fetch;
}
export interface LoginInput {
  email: string;
  password: string;
  otp?: string;
}
export interface GraphQLRequest {
  query: string;
  operationName?: string | null;
  variables?: Record<string, unknown> | null;
}
interface Session {
  clientId?: string;
  deviceId?: string;
  sessionId?: string;
  accessToken?: string;
  refreshToken?: string;
  identityId?: string;
}

const errors = {
  INVALID_REQUEST: [400, 'Invalid Wealthsimple request.'],
  LOGIN_FAILED: [401, 'Wealthsimple login failed. Check your credentials and OTP.'],
  NOT_CONNECTED: [401, 'Connect to Wealthsimple before querying financial data.'],
  UPSTREAM_FAILURE: [502, 'Wealthsimple could not complete the request.'],
} as const;

export class WealthsimpleError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(kind: keyof typeof errors, message: string = errors[kind][1]) {
    super(message);
    this.code = `WEALTHSIMPLE_${kind}`;
    this.statusCode = errors[kind][0];
  }
}

/** One mutable, memory-only session with a private cookie jar. */
export class WealthsimpleClient {
  #session: Session = {};
  #jar = new CookieJar();
  #fetch: typeof globalThis.fetch;
  #endpoints: Endpoints;
  #refreshing?: Promise<void>;
  #mfaRequired = false;
  // Server shutdown cancels all upstream work, including the shared refresh.
  #shutdown = new AbortController();

  constructor(options: WealthsimpleOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#endpoints = {
      login: 'https://my.wealthsimple.com/app/login',
      token: 'https://api.production.wealthsimple.com/v1/oauth/v2/token',
      tokenInfo: 'https://api.production.wealthsimple.com/v1/oauth/v2/token/info',
      graphql: 'https://my.wealthsimple.com/graphql',
      ...options.endpoints,
    };
  }

  getStatus(): 'connected' | 'mfa_required' | 'disconnected' {
    if (this.#session.accessToken && this.#session.identityId) return 'connected';
    return this.#mfaRequired ? 'mfa_required' : 'disconnected';
  }

  async #bootstrap(session: Session, signal: AbortSignal) {
    session.sessionId ??= randomUUID();
    const page = await this.#request(this.#endpoints.login, { signal });
    this.#assertCurrent(session);
    if (page.status !== 200) throw new WealthsimpleError('UPSTREAM_FAILURE');
    session.deviceId = requiredString(
      this.#jar.getCookiesSync(this.#endpoints.login).find(cookie => cookie.key === 'wssdi')?.value,
    );
    const appBundleSource = requiredString(page.text.match(APP_BUNDLE_SOURCE)?.[1]);
    const loginUrl = new URL(this.#endpoints.login);
    const appBundleUrl = new URL(appBundleSource.replaceAll('&amp;', '&'), loginUrl);
    const appBundle = await this.#request(appBundleUrl.href, { signal });
    this.#assertCurrent(session);
    if (appBundle.status !== 200) throw new WealthsimpleError('UPSTREAM_FAILURE');
    session.clientId = requiredString(appBundle.text.match(PRODUCTION_CLIENT_ID)?.[1]);
  }

  async login(input: LoginInput, signal: AbortSignal) {
    // A new object invalidates old work while retaining identifiers for OTP completion.
    const { clientId, deviceId, sessionId } = this.#session;
    const session: Session = this.#session = { clientId, deviceId, sessionId };
    this.#jar = this.#jar.cloneSync()!;
    this.#refreshing = undefined;
    this.#mfaRequired = false;
    // Credentials are used only for this request, never retained for OTP completion.
    try {
      if (!session.clientId || !session.deviceId) await this.#bootstrap(session, signal);
      this.#assertCurrent(session);
      const response = await this.#request(this.#endpoints.token, {
        signal,
        body: {
          grant_type: 'password',
          username: input.email,
          password: input.password,
          skip_provision: 'true',
          scope: 'invest.read trade.read tax.read',
          client_id: session.clientId,
          otp_claim: null,
        },
        headers: {
          'x-wealthsimple-client': '@wealthsimple/wealthsimple',
          'x-ws-profile': 'undefined',
          ...(input.otp ? { 'x-wealthsimple-otp': `${input.otp};remember=true` } : {}),
        },
      });
      this.#assertCurrent(session);
      const body = json(response.text);
      if (!input.otp && ['invalid_grant', 'otp_required', 'mfa_required'].includes(String(body.error))) {
        this.#mfaRequired = true;
        return { status: 'mfa_required' as const };
      }
      if (response.status !== 200 || body.error) throw new WealthsimpleError('LOGIN_FAILED');
      const accessToken = requiredString(body.access_token);
      const refreshToken = requiredString(body.refresh_token);
      session.accessToken = accessToken;
      session.refreshToken = refreshToken;
      const info = await this.#request(this.#endpoints.tokenInfo, {
        signal,
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          'x-wealthsimple-client': '@wealthsimple/wealthsimple',
        },
      });
      this.#assertCurrent(session);
      if (info.status !== 200) throw new WealthsimpleError('LOGIN_FAILED');
      session.identityId = requiredString(json(info.text).identity_canonical_id);
      return { status: 'connected' as const };
    } catch (error) {
      if (session === this.#session) this.disconnect();
      throw error;
    }
  }

  async #refresh(session: Session) {
    this.#assertCurrent(session);
    const response = await this.#request(this.#endpoints.token, {
      body: {
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        client_id: session.clientId,
      },
      headers: {
        'x-wealthsimple-client': '@wealthsimple/wealthsimple',
        'x-ws-profile': 'invest',
      },
    });
    this.#assertCurrent(session);
    if (response.status === 400 || response.status === 401) {
      this.disconnect();
      throw new WealthsimpleError('NOT_CONNECTED', 'The Wealthsimple session expired. Connect again.');
    }
    if (response.status !== 200) throw new WealthsimpleError('UPSTREAM_FAILURE');
    const body = json(response.text);
    if (body.error) {
      this.disconnect();
      throw new WealthsimpleError('NOT_CONNECTED', 'The Wealthsimple session expired. Connect again.');
    }
    const accessToken = requiredString(body.access_token);
    const refreshToken = requiredString(body.refresh_token);
    session.accessToken = accessToken;
    session.refreshToken = refreshToken;
  }

  async graphql(input: GraphQLRequest, signal: AbortSignal) {
    if (this.getStatus() !== 'connected') throw new WealthsimpleError('NOT_CONNECTED');
    const session = this.#session;
    const accessToken = session.accessToken;
    const send = () => {
      this.#assertCurrent(session);
      return this.#request(this.#endpoints.graphql, {
        signal,
        body: {
          ...input,
          variables: { ...input.variables, identityId: session.identityId },
        },
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          'x-ws-profile': 'trade',
          'x-ws-api-version': '12',
          'x-ws-locale': 'en-CA',
          'x-platform-os': 'web',
        },
      });
    };
    let response = await send();
    this.#assertCurrent(session);
    if (!authenticationFailure(response)) return response;

    // Another request may already have refreshed the token while this response was pending.
    if (session.accessToken === accessToken) {
      if (!this.#refreshing) {
        const refreshing = this.#refresh(session).finally(() => {
          if (this.#refreshing === refreshing) this.#refreshing = undefined;
        });
        this.#refreshing = refreshing;
      }
      await this.#refreshing;
    }
    this.#assertCurrent(session);
    signal.throwIfAborted();
    response = await send();
    this.#assertCurrent(session);
    if (authenticationFailure(response)) {
      this.disconnect();
      throw new WealthsimpleError('NOT_CONNECTED', 'The Wealthsimple session expired. Connect again.');
    }
    return response;
  }

  async #request(address: string, { signal, body, headers = {} }: {
    signal?: AbortSignal;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}) {
    const session = this.#session;
    // Each request keeps its original jar, so late cookies cannot reach a replacement login.
    const checkedFetch: typeof globalThis.fetch = async (input, init) => {
      this.#assertCurrent(session);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const configuredOrigin = Object.values(this.#endpoints).some(endpoint => new URL(endpoint).origin === url.origin);
      const wealthsimpleHttpsHost = url.protocol === 'https:' && url.hostname.endsWith('.wealthsimple.com');
      if ((!configuredOrigin && !wealthsimpleHttpsHost) || url.username || url.password ||
          !['http:', 'https:'].includes(url.protocol)) {
        throw new WealthsimpleError('UPSTREAM_FAILURE');
      }
      return this.#fetch(input, init);
    };
    const fetchWithCookies = fetchCookie(checkedFetch, this.#jar);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = AbortSignal.any([this.#shutdown.signal, timeout, ...(signal ? [signal] : [])]);
    try {
      requestSignal.throwIfAborted();
      const response = await fetchWithCookies(address, {
        method: body === undefined ? 'GET' : 'POST',
        // fetch-cookie follows only destinations checked above; POST redirects remain rejected.
        redirect: body === undefined ? 'follow' : 'error',
        headers: {
          accept: 'application/json, text/html;q=0.9, */*;q=0.8',
          'x-ws-device-id': session.deviceId ?? '',
          'x-ws-session-id': session.sessionId ?? '',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestSignal,
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        requestSignal.throwIfAborted();
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new WealthsimpleError('UPSTREAM_FAILURE');
        chunks.push(chunk);
      }
      requestSignal.throwIfAborted();
      this.#assertCurrent(session);
      return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
    } catch (error) {
      this.#assertCurrent(session);
      if (error instanceof WealthsimpleError || requestSignal.aborted) throw error;
      throw new WealthsimpleError('UPSTREAM_FAILURE');
    }
  }

  disconnect() {
    this.#session = {};
    this.#jar = new CookieJar();
    this.#refreshing = undefined;
    this.#mfaRequired = false;
  }

  close() {
    this.#shutdown.abort();
    this.disconnect();
  }

  #assertCurrent(session: Session) {
    if (session !== this.#session) {
      throw new WealthsimpleError('NOT_CONNECTED', 'The Wealthsimple connection changed. Submit a new request.');
    }
  }
}

function json(text: string): Record<string, unknown> {
  try { return JSON.parse(text); }
  catch { throw new WealthsimpleError('UPSTREAM_FAILURE'); }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new WealthsimpleError('UPSTREAM_FAILURE');
  return value;
}

function authenticationFailure(response: { status: number; text: string }): boolean {
  if (response.status === 401) return true;
  const body = json(response.text);
  return isAuthenticationError(body) || (Array.isArray(body?.errors) && body.errors.some(isAuthenticationError));
}

function isAuthenticationError(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const error = value as { message?: unknown; extensions?: { code?: unknown } };
  const message = typeof error.message === 'string' ? error.message.trim().toLowerCase() : '';
  return error.extensions?.code === 'UNAUTHENTICATED' || message === 'not authorized' || message === 'not authorized.';
}
