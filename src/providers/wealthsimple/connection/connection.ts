import { randomUUID } from 'node:crypto';
import { Transport, type TransportOptions } from '../upstream/http.js';
import { OTPRequired, RequestAborted, Unauthorized, WealthsimpleError } from '../errors.js';
import {
  authenticatedHeaders, bootstrap, login, lookupIdentity, refreshTokens,
  type AuthIdentifiers, type ConnectInput, type Tokens,
} from './auth.js';
export type { ConnectInput } from './auth.js';

export interface Clock {
  now(): number;
  /** Schedule expiry and return a cancellation function. */
  schedule(callback: () => void, delayMs: number): () => void;
}
export interface WealthsimpleOptions extends TransportOptions {
  clock?: Clock;
  operationTimeoutMs?: number;
}
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

interface Session extends AuthIdentifiers {
  transport: Transport;
  lifetime: AbortController;
  identity: string;
  tokens?: Tokens;
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
      if (!session.clientId) {
        const identifiers = await bootstrap(session.transport, signal);
        this.#assertCurrent(session, signal);
        session.deviceId = identifiers.deviceId;
        session.clientId = identifiers.clientId;
      }
      const tokens = await login(session.transport, session, input, signal);
      this.#setTokens(session, tokens, signal);
      const identity = await this.#identity(session, signal);
      this.#assertCurrent(session, signal);
      session.identity = identity;
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
      headers: Object.freeze(authenticatedHeaders(session, tokens.access)),
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

  // Authentication results become current only after checking the captured session.
  #setTokens(session: Session, tokens: Tokens, signal: AbortSignal) {
    this.#assertCurrent(session, signal);
    session.tokens = tokens;
    session.tokenRevision++;
  }

  async #identity(session: Session, signal: AbortSignal): Promise<string> {
    let context = this.#requestContext(session);
    const readIdentity = () => lookupIdentity(context.transport, context.headers, signal);
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
    try {
      const tokens = await refreshTokens(session.transport, session, refreshToken, signal);
      this.#setTokens(session, tokens, signal);
    } catch (error) {
      if (error instanceof Unauthorized) this.#requireReconnect(session);
      throw error;
    }
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
