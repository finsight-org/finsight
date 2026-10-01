import Fastify, { LogController } from 'fastify';
import { createProviderApi, MAX_REQUEST_BODY_SIZE } from './provider-api.js';
import { createProviderRegistry, type ProviderDefinition } from './providers.js';

export function createApp(providers: readonly ProviderDefinition[] = []) {
  const registry = createProviderRegistry(providers);
  const app = Fastify({
    logger: true,
    // GraphQL GET requests can contain sensitive variables in their URLs.
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
      const yoga = createProviderApi(provider);
      providerRoutes.route({
        url: yoga.graphqlEndpoint,
        method: ['GET', 'POST', 'OPTIONS'],
        handler: (req, reply) => yoga.handleNodeRequestAndResponse(req, reply),
      });
    }
  });

  return app;
}
