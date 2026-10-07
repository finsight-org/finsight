import type { FastifyPluginAsync } from 'fastify';

export interface ProviderMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly graphqlEndpoint: string;
  readonly connectionEndpoint?: string;
}

/** Core publishes metadata and mounts routes; providers own their HTTP interfaces. */
export interface Provider {
  readonly metadata: ProviderMetadata;
  readonly routes: FastifyPluginAsync;
}

export function createProviderRegistry(definitions: readonly Provider[]): readonly Provider[] {
  const ids = new Set<string>();
  const providers = definitions.map(({ metadata, routes }) => {
    const { id, name, description } = metadata;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error('Provider IDs must contain lowercase alphanumeric segments separated by hyphens.');
    }
    if (ids.has(id)) throw new Error(`Duplicate provider ID: ${id}`);
    if (!name.trim() || !description.trim()) {
      throw new Error(`Provider ${id} requires a name and description.`);
    }
    ids.add(id);
    return Object.freeze({ metadata: Object.freeze({ ...metadata }), routes });
  });
  providers.sort((a, b) => a.metadata.id < b.metadata.id ? -1 : a.metadata.id > b.metadata.id ? 1 : 0);
  return Object.freeze(providers);
}
