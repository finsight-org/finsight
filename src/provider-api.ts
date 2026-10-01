import { GraphQLError, type ValidationRule } from 'graphql';
import { createYoga, useExecutionCancellation, type Plugin } from 'graphql-yoga';
import type { ProviderContext, RegisteredProvider } from './providers.js';

export const MAX_REQUEST_BODY_SIZE = 1024 * 1024;

const readOnlyRule: ValidationRule = (context) => ({
  OperationDefinition(node) {
    if (node.operation !== 'query') {
      context.reportError(new GraphQLError('Only query operations are supported.', { nodes: node }));
    }
  },
  Directive(node) {
    if (node.name.value === 'defer' || node.name.value === 'stream') {
      context.reportError(new GraphQLError('Incremental delivery is not supported.', { nodes: node }));
    }
  },
});

const readOnlyPlugin: Plugin = {
  onValidate: ({ addValidationRule }) => addValidationRule(readOnlyRule),
};

export function createProviderApi(provider: RegisteredProvider) {
  return createYoga({
    schema: provider.schema,
    graphqlEndpoint: provider.metadata.graphqlEndpoint,
    context: ({ request }): ProviderContext => ({ signal: request.signal }),
    graphiql: { endpoint: provider.metadata.graphqlEndpoint },
    logging: false,
    maskedErrors: { isDev: false },
    cors: false,
    batching: false,
    multipart: false,
    maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    plugins: [
      useExecutionCancellation(),
      readOnlyPlugin,
    ],
  });
}
