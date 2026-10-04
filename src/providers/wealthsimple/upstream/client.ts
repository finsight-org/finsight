import type { SessionContext, WealthsimpleConnection } from '../connection/connection.js';
import { Unauthorized, WealthsimpleError } from '../errors.js';
import { authFailure, json, object } from '../protocol.js';
import type { ForwardingRequest, ForwardingResponse } from '../../../providers.js';

/** Configured GraphQL client. Authentication snapshots exist only during requests. */
export class WealthsimpleApiClient {
  constructor(
    private readonly connection: WealthsimpleConnection,
    private readonly operationTimeoutMs = 60_000,
  ) {}

  async query(operation: ForwardingRequest, requestSignal: AbortSignal, injectIdentity = false): Promise<ForwardingResponse> {
    const context = this.connection.acquireSession();
    const signal = AbortSignal.any([
      requestSignal, context.lifetimeSignal, AbortSignal.timeout(this.operationTimeoutMs),
    ]);
    return this.#withAuthentication(operation, context, signal, injectIdentity);
  }

  // Fixed authentication interceptor: one send, at most one refresh and retry.
  async #withAuthentication(operation: ForwardingRequest, context: SessionContext, signal: AbortSignal, injectIdentity: boolean) {
    context.assertCurrent(signal);
    let data: ForwardingResponse;
    try { data = await this.#send(operation, context, signal, injectIdentity); }
    catch (error) {
      if (!(error instanceof Unauthorized)) throw error;
      context = await context.refresh(signal);
      try { data = await this.#send(operation, context, signal, injectIdentity); }
      catch (error) {
        if (error instanceof Unauthorized) context.rejectAuthentication(signal);
        throw error;
      }
    }
    context.assertCurrent(signal);
    return data;
  }

  async #send(operation: ForwardingRequest, context: SessionContext, signal: AbortSignal, injectIdentity: boolean) {
    const response = await context.transport.request(context.transport.endpoints.graphql, signal, {
      ...operation, ...(injectIdentity ? { variables: { ...operation.variables, identityId: context.identityId } } : {}),
    }, {
      ...context.headers, 'x-ws-profile': 'trade', 'x-ws-api-version': '12',
      'x-ws-locale': 'en-CA', 'x-platform-os': 'web',
    });
    let body: Record<string, unknown>;
    try { body = json(response.text); }
    catch {
      throw new WealthsimpleError(response.status === 429 ? 'RATE_LIMITED' : response.status >= 400 ? 'UPSTREAM_FAILURE' : 'INVALID_RESPONSE');
    }
    if (authFailure(body)) throw new Unauthorized();
    if (Array.isArray(body.errors)) {
      for (const entry of body.errors) {
        const error = object(entry);
        const extensions = error.extensions == null ? {} : object(error.extensions);
        if (extensions.code === 'UNAUTHENTICATED' || authFailure(error)) throw new Unauthorized();
      }
    }
    const invalid = () => new WealthsimpleError(response.status === 429 ? 'RATE_LIMITED' : response.status >= 400 ? 'UPSTREAM_FAILURE' : 'INVALID_RESPONSE');
    if (!('data' in body) && !('errors' in body)) throw invalid();
    if ('data' in body && body.data !== null && (typeof body.data !== 'object' || Array.isArray(body.data))) throw invalid();
    if ('errors' in body && (!Array.isArray(body.errors) || body.errors.length === 0 || body.errors.some(error => !error || typeof error !== 'object' || Array.isArray(error) || typeof error.message !== 'string'))) throw invalid();
    return response;
  }
}
