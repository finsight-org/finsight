import Fastify from 'fastify';
import { createYoga } from 'graphql-yoga';
import { schema } from './schema.js';

export function createApp() {
  const app = Fastify({ logger: true });
  const yoga = createYoga({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: true,
    logging: false,
  });

  app.route({
    url: yoga.graphqlEndpoint,
    method: ['GET', 'POST', 'OPTIONS'],
    handler: (req, reply) =>
      yoga.handleNodeRequestAndResponse(req, reply),
  });

  return app;
}
