import Fastify, { LogController } from 'fastify';
import { hostHeaderValidation } from '@modelcontextprotocol/fastify';
import { createProviderRegistry, type Provider } from './providers.js';
import { registerMcp } from './mcp.js';
import { registerWebApi, type WebApiOptions } from './web-api.js';
import { registerBrowserAccess } from './browser-access.js';

export const MAX_REQUEST_BODY_SIZE = 1024 * 1024;

export function createApp(providers: readonly Provider[] = [], options: WebApiOptions = {}) {
  const registry = createProviderRegistry(providers);
  const app = Fastify({
    logger: true,
    // Provider requests can contain sensitive credentials and query variables.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: MAX_REQUEST_BODY_SIZE,
  });

  app.addHook('onRequest', hostHeaderValidation(['127.0.0.1', 'localhost', '[::1]', 'finsight']));
  registerBrowserAccess(app, options.auth?.webOrigins ?? []);
  app.setErrorHandler((error, _req, reply) => {
    const code = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ error: status < 500 ? 'Invalid request.' : 'Request failed.' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  registerWebApi(app, options);

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
