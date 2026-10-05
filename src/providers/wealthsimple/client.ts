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

  constructor(options: WealthsimpleOptions = {}) {
    this.#fetch = fetchCookie(options.fetch ?? globalThis.fetch, this.#jar);
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

  async #bootstrap(signal: AbortSignal) {
    this.#session.sessionId ??= randomUUID();
    const page = await this.#request(this.#endpoints.login, { signal });
    if (page.status !== 200) throw new WealthsimpleError('UPSTREAM_FAILURE');
    this.#session.deviceId = requiredString(
      this.#jar.getCookiesSync(this.#endpoints.login).find(cookie => cookie.key === 'wssdi')?.value,
    );
    const appBundleSource = requiredString(page.text.match(APP_BUNDLE_SOURCE)?.[1]);
    const loginUrl = new URL(this.#endpoints.login);
    const appBundleUrl = new URL(appBundleSource.replaceAll('&amp;', '&'), loginUrl);
    const sameOrigin = appBundleUrl.origin === loginUrl.origin;
    const wealthsimpleHttpsHost = appBundleUrl.protocol === 'https:' && appBundleUrl.hostname.endsWith('.wealthsimple.com');
    if ((!sameOrigin && !wealthsimpleHttpsHost) || appBundleUrl.username || appBundleUrl.password) {
      throw new WealthsimpleError('UPSTREAM_FAILURE');
    }
    const appBundle = await this.#request(appBundleUrl.href, { signal });
    if (appBundle.status !== 200) throw new WealthsimpleError('UPSTREAM_FAILURE');
    this.#session.clientId = requiredString(appBundle.text.match(PRODUCTION_CLIENT_ID)?.[1]);
  }

  async login(input: LoginInput, signal: AbortSignal) {
    this.#mfaRequired = false;
    // Credentials are used only for this request, never retained for OTP completion.
    this.#session.accessToken = undefined;
    this.#session.refreshToken = undefined;
    this.#session.identityId = undefined;
    try {
      if (!this.#session.clientId || !this.#session.deviceId) await this.#bootstrap(signal);
      const response = await this.#request(this.#endpoints.token, {
        signal,
        body: {
          grant_type: 'password',
          username: input.email,
          password: input.password,
          skip_provision: 'true',
          scope: 'invest.read trade.read tax.read',
          client_id: this.#session.clientId,
          otp_claim: null,
        },
        headers: {
          'x-wealthsimple-client': '@wealthsimple/wealthsimple',
          'x-ws-profile': 'undefined',
          ...(input.otp ? { 'x-wealthsimple-otp': `${input.otp};remember=true` } : {}),
        },
      });
      const body = json(response.text);
      if (!input.otp && ['invalid_grant', 'otp_required', 'mfa_required'].includes(String(body.error))) {
        this.#mfaRequired = true;
        return { status: 'mfa_required' as const };
      }
      if (response.status !== 200 || body.error) throw new WealthsimpleError('LOGIN_FAILED');
      const accessToken = requiredString(body.access_token);
      const refreshToken = requiredString(body.refresh_token);
      this.#session.accessToken = accessToken;
      this.#session.refreshToken = refreshToken;
      const info = await this.#request(this.#endpoints.tokenInfo, {
        signal,
        headers: {
          authorization: `Bearer ${this.#session.accessToken}`,
          'x-wealthsimple-client': '@wealthsimple/wealthsimple',
        },
      });
      if (info.status !== 200) throw new WealthsimpleError('LOGIN_FAILED');
      this.#session.identityId = requiredString(json(info.text).identity_canonical_id);
      return { status: 'connected' as const };
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  async #refresh() {
    const response = await this.#request(this.#endpoints.token, {
      body: {
        grant_type: 'refresh_token',
        refresh_token: this.#session.refreshToken,
        client_id: this.#session.clientId,
      },
      headers: {
        'x-wealthsimple-client': '@wealthsimple/wealthsimple',
        'x-ws-profile': 'invest',
      },
    });
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
    this.#session.accessToken = accessToken;
    this.#session.refreshToken = refreshToken;
  }

  async graphql(input: GraphQLRequest, signal: AbortSignal) {
    if (this.getStatus() !== 'connected') throw new WealthsimpleError('NOT_CONNECTED');
    const accessToken = this.#session.accessToken;
    const send = () => this.#request(this.#endpoints.graphql, {
      signal,
      body: {
        ...input,
        variables: { ...input.variables, identityId: this.#session.identityId },
      },
      headers: {
        authorization: `Bearer ${this.#session.accessToken}`,
        'x-ws-profile': 'trade',
        'x-ws-api-version': '12',
        'x-ws-locale': 'en-CA',
        'x-platform-os': 'web',
      },
    });
    let response = await send();
    if (!authenticationFailure(response)) return response;

    // Another request may already have refreshed the token while this response was pending.
    if (this.#session.accessToken === accessToken) {
      this.#refreshing ??= this.#refresh().finally(() => { this.#refreshing = undefined; });
      await this.#refreshing;
    }
    signal.throwIfAborted();
    response = await send();
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
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.#fetch(address, {
        method: body === undefined ? 'GET' : 'POST',
        // Let fetch-cookie handle public redirects; never replay credentials or queries through a redirect.
        redirect: body === undefined ? 'follow' : 'error',
        headers: {
          accept: 'application/json, text/html;q=0.9, */*;q=0.8',
          'x-ws-device-id': this.#session.deviceId ?? '',
          'x-ws-session-id': this.#session.sessionId ?? '',
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
      return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
    } catch (error) {
      if (error instanceof WealthsimpleError || requestSignal.aborted) throw error;
      throw new WealthsimpleError('UPSTREAM_FAILURE');
    }
  }

  disconnect() {
    this.#session = {};
    this.#jar.removeAllCookiesSync();
    this.#mfaRequired = false;
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
