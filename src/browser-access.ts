import type { FastifyInstance } from 'fastify';

declare module 'fastify' { interface FastifyContextConfig { browserApi?: true; browserMethods?: readonly string[]; browserHeaders?: readonly string[] } }

export function registerBrowserAccess(app: FastifyInstance, origins: readonly string[]): void {
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const browserApi = request.routeOptions.config.browserApi === true;
    if (browserApi) reply.header('Cache-Control', 'no-store');
    if (origin === undefined) return;
    if (!browserApi || !origins.includes(origin)) {
      return reply.code(403).send({ error: 'Browser request is not allowed.' });
    }
    const methods = request.routeOptions.config.browserMethods ?? ['GET'];
    const allowedHeaders = request.routeOptions.config.browserHeaders ?? ['Authorization'];
    if (request.method !== 'OPTIONS' && !methods.includes(request.method)) return reply.code(403).send({ error: 'Browser request is not allowed.' });
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const headers = request.headers['access-control-request-headers'];
      if (typeof method !== 'string' || !methods.includes(method) || (headers !== undefined && (typeof headers !== 'string' ||
          headers.split(',').some(header => !allowedHeaders.some(allowed => allowed.toLowerCase() === header.trim().toLowerCase()))))) {
        return reply.code(403).send({ error: 'Browser request is not allowed.' });
      }
      reply.header('Access-Control-Allow-Methods', methods.join(', '));
      reply.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));
    }
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
  });
}
