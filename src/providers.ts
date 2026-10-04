import { assertValidSchema, type GraphQLSchema } from 'graphql';
import type { FastifyPluginAsync } from 'fastify';

export interface ForwardingRequest {
  readonly query: string;
  readonly operationName?: string;
  readonly variables?: Record<string, unknown>;
}
export interface ForwardingResponse { status: number; text: string }
export type ForwardingExecutor = (request: ForwardingRequest, signal: AbortSignal) => Promise<ForwardingResponse>;
export interface QueryCatalog {
  readonly introspection: 'disabled' | 'available' | 'unknown';
  readonly queries: readonly {
    readonly id: string;
    readonly description: string;
    readonly operationName: string;
    readonly query: string;
    readonly variables: Record<string, unknown>;
    readonly injectedVariables: readonly string[];
  }[];
}
interface ProviderBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly connectionRoutes?: FastifyPluginAsync;
}
type ProviderMode =
  | { readonly mode: 'schema'; readonly schema: GraphQLSchema; readonly executor?: never; readonly catalog?: never }
  | { readonly mode: 'forward'; readonly executor: ForwardingExecutor; readonly catalog?: QueryCatalog; readonly schema?: never };
export type ProviderDefinition = ProviderBase & ProviderMode;
export interface ProviderContext { readonly signal: AbortSignal }
export interface ProviderMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly mode: ProviderMode['mode'];
  readonly graphqlEndpoint: string;
  readonly connectionEndpoint?: string;
}
export type RegisteredProvider = {
  readonly metadata: Readonly<ProviderMetadata>;
  readonly connectionRoutes?: FastifyPluginAsync;
} & ProviderMode;

export function createProviderRegistry(definitions: readonly ProviderDefinition[]): readonly RegisteredProvider[] {
  const ids = new Set<string>();
  const providers = definitions.map((definition): RegisteredProvider => {
    const { id, name, description, connectionRoutes, mode } = definition;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Provider IDs must contain lowercase alphanumeric segments separated by hyphens.');
    if (ids.has(id)) throw new Error(`Duplicate provider ID: ${id}`);
    if (!name.trim() || !description.trim()) throw new Error(`Provider ${id} requires a name and description.`);
    ids.add(id);
    const base = {
      metadata: Object.freeze({ id, name, description, mode, graphqlEndpoint: `/providers/${id}/graphql`,
        ...(connectionRoutes ? { connectionEndpoint: `/providers/${id}/connection` } : {}) }),
      connectionRoutes,
    };
    if (mode === 'schema') {
      if (definition.executor !== undefined || definition.catalog !== undefined) throw new Error('Schema providers cannot configure forwarding.');
      assertValidSchema(definition.schema);
      if (definition.schema.getMutationType() || definition.schema.getSubscriptionType()) throw new Error(`Provider ${id} must expose only a query root.`);
      return Object.freeze({ ...base, mode, schema: definition.schema });
    }
    if (mode !== 'forward' || typeof definition.executor !== 'function' || definition.schema !== undefined) throw new Error('Invalid provider mode configuration.');
    const catalog = definition.catalog === undefined ? undefined : structuredClone(definition.catalog);
    if (catalog !== undefined && (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) || !['disabled', 'available', 'unknown'].includes(catalog.introspection) || !Array.isArray(catalog.queries) || catalog.queries.some(q =>
      !q || typeof q.id !== 'string' || typeof q.description !== 'string' || typeof q.operationName !== 'string' || typeof q.query !== 'string' ||
      !q.variables || typeof q.variables !== 'object' || Array.isArray(q.variables) || !Array.isArray(q.injectedVariables) || q.injectedVariables.some((v: unknown) => typeof v !== 'string')))) {
      throw new Error('Invalid query catalog.');
    }
    return Object.freeze({ ...base, mode, executor: definition.executor, catalog });
  });
  providers.sort((a, b) => a.metadata.id < b.metadata.id ? -1 : a.metadata.id > b.metadata.id ? 1 : 0);
  return Object.freeze(providers);
}
