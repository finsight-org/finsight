import { randomUUID } from 'node:crypto';
import { Transport, type TransportOptions } from './transport.js';
import { OTPRequired, RequestAborted, Unauthorized, WealthsimpleError } from './errors.js';
import { authFailure, checkStatus, json, requiredString } from './protocol.js';

export interface Clock {
  now(): number;
  /** Schedule expiry and return a cancellation function. */
  schedule(callback: () => void, delayMs: number): () => void;
}
export interface WealthsimpleOptions extends TransportOptions {
  clock?: Clock;
  operationTimeoutMs?: number;
}
export type ConnectInput = { email: string; password: string } & (
  { attemptId?: undefined; otp?: undefined } | { attemptId: string; otp: string }
);
/** A request snapshot with closures over its private session; never a mutable session. */
export interface SessionContext {
  readonly identityId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly transport: Pick<Transport, 'endpoints' | 'request'>;
  readonly lifetimeSignal: AbortSignal;
  readonly assertCurrent: (signal: AbortSignal) => void;
  readonly refresh: (signal: AbortSignal) => Promise<SessionContext>;
  readonly rejectAuthentication: (signal: AbortSignal) => never;
}

interface Session {
  transport: Transport;
  lifetime: AbortController;
  sessionId: string;
  deviceId: string;
  clientId: string;
  identity: string;
  tokens?: { access: string; refresh: string };
  tokenRevision: number;
  refreshing?: Promise<void>;
}
type State =
  | { status: 'disconnected' | 'reconnect_required' }
  | { status: 'connecting' | 'connected'; session: Session }
  | { status: 'mfa_required'; session: Session; attemptId: string; email: string; expires: number; cancelExpiry: () => void };

const systemClock: Clock = {
  now: Date.now,
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

/** Owns the entire Wealthsimple session. It has no HTTP-server or GraphQL-server dependency. */
export class WealthsimpleConnection {
  #options: WealthsimpleOptions;
  #clock: Clock;
  #state: State = { status: 'disconnected' };
  #closed = false;

  constructor(options: WealthsimpleOptions = {}) {
    this.#options = options;
    this.#clock = options.clock ?? systemClock;
  }

  getStatus(): State['status'] {
    if (this.#state.status === 'mfa_required' && this.#clock.now() >= this.#state.expires) {
      this.#reset('disconnected');
    }
    return this.#state.status;
  }

  async connect(input: ConnectInput, requestSignal: AbortSignal) {
    this.getStatus(); // Expire an old OTP attempt before selecting the next transition.
    const state = this.#state;
    if (this.#closed || state.status === 'connecting' || state.status === 'connected') {
      throw new WealthsimpleError('CONNECTION_CONFLICT');
    }

    let session: Session;
    if (state.status === 'mfa_required') {
      if (input.attemptId !== state.attemptId || input.email !== state.email) {
        throw new WealthsimpleError('CONNECTION_CONFLICT');
      }
      state.cancelExpiry();
      session = state.session;
    } else {
      if (input.attemptId) throw new WealthsimpleError('CONNECTION_CONFLICT');
      session = {
        transport: new Transport(this.#options), lifetime: new AbortController(),
        sessionId: randomUUID(), deviceId: '', clientId: '', identity: '', tokenRevision: 0,
      };
    }
    this.#state = { status: 'connecting', session };
    const signal = this.#operationSignal(session, requestSignal);
    try {
      if (!session.clientId) await this.#bootstrap(session, signal);
      await this.#login(session, input, signal);
      session.identity = await this.#identity(session, signal);
      this.#assertCurrent(session, signal);
      this.#state = { status: 'connected', session };
      return { status: 'connected' as const };
    } catch (error) {
      // Preserve the reason for this operation before cleanup aborts its session.
      if (this.#currentSession() !== session && session.lifetime.signal.reason instanceof RequestAborted) {
        throw new WealthsimpleError('CONNECTION_CONFLICT');
      }
      const failure = signal.aborted ? this.#abortReason(signal) : error;
      if (this.#currentSession() === session) {
        if (failure instanceof OTPRequired && !input.otp) return this.#awaitOTP(session, input.email);
        this.#reset('disconnected');
      }
      throw failure;
    }
  }

  disconnect() { this.#reset('disconnected'); }
  close() {
    this.#closed = true;
    this.disconnect();
  }

  acquireSession(): SessionContext {
    const state = this.#state;
    if (state.status !== 'connected') {
      throw new WealthsimpleError(state.status === 'reconnect_required' ? 'RECONNECT_REQUIRED' : 'NOT_CONNECTED');
    }
    return this.#requestContext(state.session);
  }

  #requestContext(session: Session): SessionContext {
    const tokens = session.tokens;
    if (!tokens) throw new WealthsimpleError('NOT_CONNECTED');
    const revision = session.tokenRevision;
    return Object.freeze({
      identityId: session.identity,
      headers: Object.freeze({ ...this.#headers(session), authorization: `Bearer ${tokens.access}` }),
      transport: session.transport,
      lifetimeSignal: session.lifetime.signal,
      assertCurrent: (signal: AbortSignal) => this.#assertCurrent(session, signal),
      refresh: (signal: AbortSignal) => this.#refreshFor(session, revision, signal),
      rejectAuthentication: (signal: AbortSignal) => {
        this.#assertCurrent(session, signal);
        return this.#requireReconnect(session);
      },
    });
  }

  // Connection lifetime and OTP transitions.
  #currentSession(): Session | undefined {
    return 'session' in this.#state ? this.#state.session : undefined;
  }

  #reset(status: 'disconnected' | 'reconnect_required', reason: WealthsimpleError = new RequestAborted(undefined)) {
    const state = this.#state;
    this.#state = { status };
    if (state.status === 'mfa_required') state.cancelExpiry();
    if ('session' in state) {
      const session = state.session;
      session.lifetime.abort(reason);
      session.transport.clear();
      session.tokens = undefined;
      session.identity = '';
      session.clientId = '';
      session.deviceId = '';
      session.sessionId = '';
    }
  }

  #awaitOTP(session: Session, email: string) {
    const attemptId = randomUUID();
    const expires = this.#clock.now() + 300_000;
    const cancelExpiry = this.#clock.schedule(() => {
      if (this.#state.status === 'mfa_required' && this.#state.attemptId === attemptId) {
        this.#reset('disconnected');
      }
    }, 300_000);
    this.#state = { status: 'mfa_required', session, attemptId, email, expires, cancelExpiry };
    return { status: 'mfa_required' as const, attemptId, expiresAt: new Date(expires).toISOString() };
  }

  #operationSignal(session: Session, request: AbortSignal) {
    return AbortSignal.any([request, session.lifetime.signal, AbortSignal.timeout(this.#options.operationTimeoutMs ?? 60_000)]);
  }

  #abortReason(signal: AbortSignal): WealthsimpleError {
    return signal.reason instanceof WealthsimpleError ? signal.reason : new RequestAborted(signal.reason);
  }

  #assertCurrent(session: Session, signal: AbortSignal) {
    if (signal.aborted) throw this.#abortReason(signal);
    if (this.#currentSession() !== session) throw new WealthsimpleError('CONNECTION_CONFLICT');
  }

  // Wealthsimple authentication protocol.
  async #bootstrap(session: Session, signal: AbortSignal) {
    const transport = session.transport;
    const page = await transport.request(transport.endpoints.login, signal);
    checkStatus(page.status);
    session.deviceId = requiredString(transport.deviceId());
    const scripts = [...page.text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)];
    const source = scripts.map(match => match[1]).find(path => /\/app-[^/]+\.js(?:\?|$)/.test(path));
    if (!source) throw new WealthsimpleError('INVALID_RESPONSE');
    const script = await transport.request(transport.assetUrl(source.replaceAll('&amp;', '&')), signal);
    checkStatus(script.status);
    session.clientId = requiredString(script.text.match(/["']production["'][^}]{0,2000}\bclientId\s*:\s*["']([a-zA-Z0-9_-]+)["']/)?.[1]);
  }

  #headers(session: Session, profile?: string): Record<string, string> {
    return {
      'x-ws-device-id': session.deviceId, 'x-ws-session-id': session.sessionId,
      ...(profile === undefined ? {} : { 'x-wealthsimple-client': '@wealthsimple/wealthsimple', 'x-ws-profile': profile }),
    };
  }

  #setTokens(session: Session, body: Record<string, unknown>, signal: AbortSignal) {
    const access = requiredString(body.access_token);
    const refresh = requiredString(body.refresh_token);
    this.#assertCurrent(session, signal);
    session.tokens = { access, refresh };
    session.tokenRevision++;
  }

  async #login(session: Session, input: ConnectInput, signal: AbortSignal) {
    const headers = this.#headers(session, 'undefined');
    if (input.otp) headers['x-wealthsimple-otp'] = `${input.otp};remember=true`;
    const response = await session.transport.request(session.transport.endpoints.token, signal, {
      grant_type: 'password', username: input.email, password: input.password, skip_provision: 'true',
      scope: 'invest.read trade.read tax.read', client_id: session.clientId, otp_claim: null,
    }, headers);
    if (![200, 400, 401].includes(response.status)) checkStatus(response.status);
    const body = json(response.text);
    if (body.error) {
      if (!input.otp && ['invalid_grant', 'otp_required', 'mfa_required'].includes(String(body.error))) throw new OTPRequired();
      throw new WealthsimpleError('LOGIN_FAILED');
    }
    if (response.status !== 200) throw new WealthsimpleError('LOGIN_FAILED');
    this.#setTokens(session, body, signal);
  }

  async #identity(session: Session, signal: AbortSignal): Promise<string> {
    let context = this.#requestContext(session);
    const readIdentity = async () => {
      const response = await context.transport.request(context.transport.endpoints.tokenInfo, signal, undefined, {
        ...context.headers, 'x-wealthsimple-client': '@wealthsimple/wealthsimple',
      });
      checkStatus(response.status);
      const body = json(response.text);
      if (authFailure(body)) throw new Unauthorized();
      return requiredString(body.identity_canonical_id);
    };
    context.assertCurrent(signal);
    let identity: string;
    try { identity = await readIdentity(); }
    catch (error) {
      if (!(error instanceof Unauthorized)) throw error;
      context = await context.refresh(signal);
      try { identity = await readIdentity(); }
      catch (error) {
        if (error instanceof Unauthorized) context.rejectAuthentication(signal);
        throw error;
      }
    }
    context.assertCurrent(signal);
    return identity;
  }

  #requireReconnect(session: Session): never {
    const error = new WealthsimpleError('RECONNECT_REQUIRED');
    if (this.#currentSession() === session) {
      this.#reset(this.#state.status === 'connected' ? 'reconnect_required' : 'disconnected', error);
    }
    throw error;
  }

  async #refresh(session: Session, refreshToken: string) {
    const signal = AbortSignal.any([session.lifetime.signal, AbortSignal.timeout(30_000)]);
    const response = await session.transport.request(session.transport.endpoints.token, signal, {
      grant_type: 'refresh_token', refresh_token: refreshToken, client_id: session.clientId,
    }, this.#headers(session, 'invest'));
    if (response.status === 400 || response.status === 401) this.#requireReconnect(session);
    checkStatus(response.status);
    const body = json(response.text);
    if (body.error) this.#requireReconnect(session);
    this.#setTokens(session, body, signal);
  }

  // Refresh coordination belongs to the session, not to any individual reader.
  async #refreshFor(session: Session, failedRevision: number, signal: AbortSignal): Promise<SessionContext> {
    this.#assertCurrent(session, signal);
    if (session.tokenRevision === failedRevision) {
      const tokens = session.tokens;
      if (!tokens) throw new WealthsimpleError('NOT_CONNECTED');
      session.refreshing ??= this.#refresh(session, tokens.refresh).finally(() => { session.refreshing = undefined; });
      await this.#waitForRefresh(session.refreshing, signal);
    }
    this.#assertCurrent(session, signal);
    return this.#requestContext(session);
  }

  #waitForRefresh(refresh: Promise<void>, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(this.#abortReason(signal));
    return new Promise((resolve, reject) => {
      const cleanup = () => signal.removeEventListener('abort', abort);
      const abort = () => { cleanup(); reject(this.#abortReason(signal)); };
      signal.addEventListener('abort', abort, { once: true });
      refresh.then(
        () => { cleanup(); resolve(); },
        error => { cleanup(); reject(error); },
      );
    });
  }
}
