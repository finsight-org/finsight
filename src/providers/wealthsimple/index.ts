import type { ProviderDefinition } from '../../providers.js';
import { WealthsimpleConnection, type WealthsimpleOptions } from './connection/connection.js';
import { createConnectionRoutes } from './connection/routes.js';
import { createAccounts } from './operations/accounts.js';
import { createWealthsimpleSchema } from './schema.js';
import { WealthsimpleApiClient } from './upstream/client.js';
export type { WealthsimpleOptions, Clock } from './connection/connection.js';

export function wealthsimpleProvider(options: WealthsimpleOptions = {}): ProviderDefinition {
  const connection = new WealthsimpleConnection(options);
  const client = new WealthsimpleApiClient(connection, options.operationTimeoutMs);
  const operations = { accounts: createAccounts(client) };
  return {
    id: 'wealthsimple', name: 'Wealthsimple', description: 'Read financial data from Wealthsimple.',
    schema: createWealthsimpleSchema(operations),
    connectionRoutes: createConnectionRoutes(connection),
  };
}
