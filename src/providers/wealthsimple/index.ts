import type { ProviderDefinition } from '../../providers.js';
import { WealthsimpleConnection, type WealthsimpleOptions } from './connection/connection.js';
import { createConnectionRoutes } from './connection/routes.js';
import { createForwarder } from './forwarding.js';
import { catalog } from './catalog.js';
import { WealthsimpleApiClient } from './upstream/client.js';
export type { WealthsimpleOptions, Clock } from './connection/connection.js';

export function wealthsimpleProvider(options: WealthsimpleOptions = {}): ProviderDefinition {
  const connection = new WealthsimpleConnection(options);
  const client = new WealthsimpleApiClient(connection, options.operationTimeoutMs);
  return {
    id: 'wealthsimple', name: 'Wealthsimple', description: 'Read financial data from Wealthsimple.',
    mode: 'forward', executor: createForwarder(client), catalog,
    connectionRoutes: createConnectionRoutes(connection),
  };
}
