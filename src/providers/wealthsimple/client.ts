import type { SessionContext, WealthsimpleConnection } from './connection.js';
import { Unauthorized, WealthsimpleError } from './errors.js';
import { authFailure, checkStatus, json, object } from './protocol.js';

export interface GraphQLOperation {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

/** Configured GraphQL client. Authentication snapshots exist only during requests. */
export class WealthsimpleApiClient {
  constructor(
    private readonly connection: WealthsimpleConnection,
    private readonly operationTimeoutMs = 60_000,
  ) {}

  async query(operation: GraphQLOperation, requestSignal: AbortSignal): Promise<Record<string, unknown>> {
    const context = this.connection.acquireSession();
    const signal = AbortSignal.any([
      requestSignal, context.lifetimeSignal, AbortSignal.timeout(this.operationTimeoutMs),
    ]);
    return this.#withAuthentication(operation, context, signal);
  }

  // Fixed authentication interceptor: one send, at most one refresh and retry.
  async #withAuthentication(operation: GraphQLOperation, context: SessionContext, signal: AbortSignal) {
    context.assertCurrent(signal);
    let data: Record<string, unknown>;
    try { data = await this.#send(operation, context, signal); }
    catch (error) {
      if (!(error instanceof Unauthorized)) throw error;
      context = await context.refresh(signal);
      try { data = await this.#send(operation, context, signal); }
      catch (error) {
        if (error instanceof Unauthorized) context.rejectAuthentication(signal);
        throw error;
      }
    }
    context.assertCurrent(signal);
    return data;
  }

  async #send(operation: GraphQLOperation, context: SessionContext, signal: AbortSignal) {
    const response = await context.transport.request(context.transport.endpoints.graphql, signal, {
      ...operation, variables: { ...operation.variables, identityId: context.identityId },
    }, {
      ...context.headers, 'x-ws-profile': 'trade', 'x-ws-api-version': '12',
      'x-ws-locale': 'en-CA', 'x-platform-os': 'web',
    });
    checkStatus(response.status);
    const body = json(response.text);
    if (authFailure(body)) throw new Unauthorized();
    if (body.errors !== undefined) {
      if (!Array.isArray(body.errors)) throw new WealthsimpleError('INVALID_RESPONSE');
      for (const entry of body.errors) {
        const error = object(entry);
        const extensions = error.extensions == null ? {} : object(error.extensions);
        if (extensions.code === 'UNAUTHENTICATED' || authFailure(error)) throw new Unauthorized();
      }
      if (body.errors.length) throw new WealthsimpleError('UPSTREAM_FAILURE');
    }
    return object(body.data);
  }
}
