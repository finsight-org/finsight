import type { FastifyInstance } from 'fastify';
import type { AuthenticateRequest } from './auth.js';

export function registerWebApi(app: FastifyInstance, authenticate: AuthenticateRequest): void {
  app.options('/api/me', { config: { browserApi: true } }, async (_request, reply) => reply.code(204).send());
  app.get('/api/me', { exposeHeadRoute: false, config: { browserApi: true } }, async (request, reply) => {
    const identity = await authenticate(request, reply);
    if (identity) return { user: identity.user };
  });
}
