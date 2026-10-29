import Fastify, { LogController } from 'fastify';
import type { Socket } from 'node:net';
import { hostHeaderValidation } from '@modelcontextprotocol/fastify';
import { createProviderRegistry, type Provider } from './providers.js';
import { registerMcp } from './mcp.js';

export const MAX_REQUEST_BODY_SIZE = 1024 * 1024;

export function createApp(providers: readonly Provider[] = []) {
  const registry = createProviderRegistry(providers);
  const app = Fastify({
    logger: true,
    // Provider requests can contain sensitive credentials and query variables.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: MAX_REQUEST_BODY_SIZE,
  });

  // Aborted fetches may preconnect a replacement TCP socket. Node's HTTP
  // close() does not reap sockets still awaiting their first request.
  const unstarted = new Set<Socket>();
  let closing = false;
  app.server.on('connection', socket => {
    if (closing) { socket.destroy(); return; }
    unstarted.add(socket);
    socket.once('close', () => unstarted.delete(socket));
  });
  app.server.prependListener('request', request => { unstarted.delete(request.socket); });
  app.addHook('preClose', async () => {
    closing = true;
    for (const socket of unstarted) socket.destroy();
    unstarted.clear();
  });

  app.addHook('onRequest', hostHeaderValidation(['127.0.0.1', 'localhost', '[::1]', 'finsight']));
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin !== undefined) await reply.code(403).send({ error: 'Browser requests are not supported.' });
  });
  app.setErrorHandler((error, _req, reply) => {
    const code = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ error: status < 500 ? 'Invalid request.' : 'Request failed.' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/providers', async () => ({
    providers: registry.map(({ metadata }) => metadata),
  }));

  app.register(async (providerRoutes) => {
    providerRoutes.addHook('onRequest', async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
    });
    for (const provider of registry) {
      providerRoutes.register(provider.routes, { prefix: `/providers/${provider.metadata.id}` });
    }
  });

  registerMcp(app, registry);

  return app;
}
