import { assertValidSchema, type GraphQLSchema } from 'graphql';
import type { FastifyPluginAsync } from 'fastify';

/** Providers own their schemas and private dependencies. Resolvers must perform
 * financial reads only; GraphQL query validation cannot enforce upstream intent.
 * Treat schemas as immutable after registration.
 */
export interface ProviderDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: GraphQLSchema;
  /** Provider-owned HTTP interface, mounted beneath its connection endpoint. */
  readonly connectionRoutes?: FastifyPluginAsync;
}

/** The supported resolver context. Pass signal to asynchronous provider work. */
export interface ProviderContext {
  readonly signal: AbortSignal;
}

export interface ProviderMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly graphqlEndpoint: string;
  readonly connectionEndpoint?: string;
}

export interface RegisteredProvider {
  readonly metadata: Readonly<ProviderMetadata>;
  readonly schema: GraphQLSchema;
  readonly connectionRoutes?: FastifyPluginAsync;
}

export function createProviderRegistry(
  definitions: readonly ProviderDefinition[],
): readonly RegisteredProvider[] {
  const ids = new Set<string>();
  const providers = definitions.map(({ id, name, description, schema, connectionRoutes }) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error('Provider IDs must contain lowercase alphanumeric segments separated by hyphens.');
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate provider ID: ${id}`);
    }
    if (!name.trim() || !description.trim()) {
      throw new Error(`Provider ${id} requires a name and description.`);
    }
    ids.add(id);
    assertValidSchema(schema);
    if (schema.getMutationType() || schema.getSubscriptionType()) {
      throw new Error(`Provider ${id} must expose only a query root.`);
    }
    return Object.freeze({
      metadata: Object.freeze({
        id, name, description, graphqlEndpoint: `/providers/${id}/graphql`,
        ...(connectionRoutes ? { connectionEndpoint: `/providers/${id}/connection` } : {}),
      }),
      schema,
      connectionRoutes,
    });
  });
  providers.sort((a, b) => a.metadata.id < b.metadata.id ? -1 : a.metadata.id > b.metadata.id ? 1 : 0);
  return Object.freeze(providers);
}
