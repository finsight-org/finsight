import type { WealthsimpleApiClient } from '../upstream/client.js';
import { WealthsimpleError } from '../errors.js';
import { object } from '../protocol.js';

export interface AccountPageArguments { first: number; after?: string | null }

const accountsQuery = `query FinSightAccounts($identityId: ID!, $first: Int!, $after: String) {
  identity(id: $identityId) {
    accounts(filter: {}, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { id nickname unifiedAccountType currency status } }
    }
  }
}`;

/** Bind account operations once to this provider instance's shared API client. */
export function createAccounts(api: Pick<WealthsimpleApiClient, 'query'>) {
  return {
    /** Read exactly one upstream page, preserving its order, values and duplicates. */
    async getPage({ first, after }: AccountPageArguments, signal: AbortSignal) {
      const data = await api.query({
        operationName: 'FinSightAccounts', query: accountsQuery, variables: { first, after: after ?? null },
      }, signal);
      const page = object(object(data.identity).accounts);
      const info = object(page.pageInfo);
      if (!Array.isArray(page.edges) || typeof info.hasNextPage !== 'boolean' ||
          (info.endCursor != null && typeof info.endCursor !== 'string') ||
          (info.hasNextPage && !info.endCursor)) {
        throw new WealthsimpleError('INVALID_RESPONSE');
      }
      return page;
    },
  };
}
