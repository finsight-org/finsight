import type { FastifyInstance } from 'fastify';

declare module 'fastify' { interface FastifyContextConfig { browserApi?: true } }

export function registerBrowserAccess(app: FastifyInstance, origins: readonly string[]): void {
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const browserApi = request.routeOptions.config.browserApi === true;
    if (browserApi) reply.header('Cache-Control', 'no-store');
    if (origin === undefined) return;
    if (!browserApi || !origins.includes(origin)) {
      return reply.code(403).send({ error: 'Browser request is not allowed.' });
    }
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const headers = request.headers['access-control-request-headers'];
      if (method !== 'GET' || (headers !== undefined && (typeof headers !== 'string' ||
          headers.split(',').some(header => header.trim().toLowerCase() !== 'authorization')))) {
        return reply.code(403).send({ error: 'Browser request is not allowed.' });
      }
      reply.header('Access-Control-Allow-Methods', 'GET');
      reply.header('Access-Control-Allow-Headers', 'Authorization');
    }
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
  });
}
