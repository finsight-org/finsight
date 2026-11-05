import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticateRequest, RequestIdentity } from '../auth.js';
import { WealthsimpleError } from '../providers/wealthsimple/client.js';
import { assertQueryOnly, graphqlInput, loginInput } from '../providers/wealthsimple/validation.js';
import { SessionError } from '../sessions/model.js';
import type { SessionAccess, WealthsimpleSessionService } from '../sessions/wealthsimple-service.js';
import { ConnectionError, parseConnectionId } from './model.js';
import type { ConnectionStoreFactory } from './store.js';

// The first lookup runs before touching the process-wide connection queue.
export async function ownedSessionAccess(
  connectionId: string, identity: RequestIdentity, createStore: ConnectionStoreFactory | undefined, signal: AbortSignal,
): Promise<SessionAccess> {
  if (!createStore) throw new ConnectionError('CONNECTION_STORAGE_UNAVAILABLE');
  const record = await createStore(identity, signal).get(connectionId);
  if (!record) throw new ConnectionError('CONNECTION_NOT_FOUND');
  return {
    binding: { userId: identity.user.id, connectionId: record.id, providerId: record.providerId },
    async checkOwnership(operationSignal) {
      const current = await createStore(identity, operationSignal).get(record.id);
      if (!current || current.providerId !== record.providerId) throw new ConnectionError('CONNECTION_NOT_FOUND');
    },
  };
}

export async function withConnectionCancellation<T>(
  request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const close = () => { if (!reply.raw.writableFinished) cancel(); };
  request.raw.once('aborted', cancel);
  reply.raw.once('close', close);
  try { return await work(controller.signal); }
  finally {
    request.raw.removeListener('aborted', cancel);
    reply.raw.removeListener('close', close);
  }
}

export function registerConnectionSessionRoutes(app: FastifyInstance, options: {
  authenticate: AuthenticateRequest;
  createStore?: ConnectionStoreFactory;
  sessions?: WealthsimpleSessionService;
}): void {
  app.register(async routes => {
    routes.setErrorHandler((error, _request, reply) => {
      const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 500;
      const safe = error instanceof ConnectionError || error instanceof SessionError || error instanceof WealthsimpleError
        ? error : new WealthsimpleError([400, 413, 415].includes(status) ? 'INVALID_REQUEST' : 'UPSTREAM_FAILURE');
      reply.code([413, 415].includes(status) ? status : safe.statusCode)
        .send({ error: { code: safe.code, message: safe.message } });
    });
    const session = { browserApi: true as const, browserMethods: ['GET', 'POST', 'DELETE'], browserHeaders: ['Authorization', 'Content-Type'] };
    const graphql = { ...session, browserMethods: ['POST'] };
    for (const [url, config] of [
      ['/api/connections/:connectionId/session', session], ['/api/connections/:connectionId/graphql', graphql],
    ] as const) routes.options(url, { config }, async (_req, reply) => reply.code(204).send());

    async function handle<T>(request: FastifyRequest, reply: FastifyReply, parse: () => T,
      work: (sessions: WealthsimpleSessionService, access: SessionAccess, input: T, signal: AbortSignal) => Promise<unknown>) {
      return withConnectionCancellation(request, reply, async signal => {
        const identity = await options.authenticate(request, reply);
        if (!identity || signal.aborted || request.raw.aborted || reply.raw.destroyed) return;
        const key = parseConnectionId((request.params as { connectionId: unknown }).connectionId);
        if (Object.keys(request.query as object).length) throw new ConnectionError('CONNECTION_INPUT_INVALID');
        const input = parse();
        const access = await ownedSessionAccess(key, identity, options.createStore, signal);
        if (access.binding.providerId !== 'wealthsimple') throw new SessionError('CONNECTION_PROVIDER_UNSUPPORTED');
        if (!options.sessions) throw new SessionError('SESSION_NOT_CONFIGURED');
        signal.throwIfAborted();
        return work(options.sessions, access, input, signal);
      });
    }
    function noBody(request: FastifyRequest) {
      if (request.body !== undefined) throw new WealthsimpleError('INVALID_REQUEST');
    }
    routes.get('/api/connections/:connectionId/session', { config: session, exposeHeadRoute: false }, (req, reply) =>
      handle(req, reply, () => noBody(req), (service, access, _input, signal) => service.status(access, signal)));
    routes.post('/api/connections/:connectionId/session', { config: session, bodyLimit: 16 * 1024 }, (req, reply) =>
      handle(req, reply, () => loginInput(req.body), (service, access, input, signal) => service.login(access, input, signal)));
    routes.delete('/api/connections/:connectionId/session', { config: session }, (req, reply) =>
      handle(req, reply, () => noBody(req), async (service, access, _input, signal) => {
        await service.disconnect(access, signal);
        return reply.code(204).send();
      }));
    routes.post('/api/connections/:connectionId/graphql', { config: graphql, bodyLimit: 1024 * 1024 }, (req, reply) =>
      handle(req, reply, () => { const input = graphqlInput(req.body); assertQueryOnly(input.query); return input; },
        async (service, access, input, signal) => {
          const response = await service.graphql(access, input, signal);
          return reply.code(response.status).type('application/json').send(response.text);
        }));
  });
}
