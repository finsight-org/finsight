import type { ProviderDefinition } from '../../providers.js';
import { WealthsimpleConnection, type WealthsimpleOptions } from './connection/connection.js';
import { createConnectionRoutes } from './connection/routes.js';
import { createWealthsimpleSchema } from './schema.js';
import { WealthsimpleApiClient } from './upstream/client.js';
export type { WealthsimpleOptions, Clock } from './connection/connection.js';

export function wealthsimpleProvider(options: WealthsimpleOptions = {}): ProviderDefinition {
  const connection = new WealthsimpleConnection(options);
  const client = new WealthsimpleApiClient(connection, options.operationTimeoutMs);
  return {
    id: 'wealthsimple', name: 'Wealthsimple', description: 'Read Wealthsimple account metadata.',
    schema: createWealthsimpleSchema(client),
    connectionRoutes: createConnectionRoutes(connection),
  };
}
