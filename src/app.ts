import Fastify, { LogController } from 'fastify';
import { createProviderRegistry, type Provider } from './providers.js';

export const MAX_REQUEST_BODY_SIZE = 1024 * 1024;

export function createApp(providers: readonly Provider[] = []) {
  const registry = createProviderRegistry(providers);
  const app = Fastify({
    logger: true,
    // Provider requests can contain sensitive credentials and query variables.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: MAX_REQUEST_BODY_SIZE,
  });

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

  return app;
}
