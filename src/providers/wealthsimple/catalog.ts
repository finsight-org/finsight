import type { QueryCatalog } from '../../providers.js';

export const accountsQuery = `query Accounts($identityId: ID!, $first: Int = 25, $after: String) {
  identity(id: $identityId) {
    accounts(filter: {}, first: $first, after: $after) {
      edges {
        cursor
        node {
          id nickname unifiedAccountType currency supportedCurrencies status createdAt
          custodianAccounts { id custodian status }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export const catalog: QueryCatalog = {
  introspection: 'disabled',
  queries: [{
    id: 'accounts',
    description: 'One native account page. Pass pageInfo.endCursor as after to request the next page. FinSight supplies identityId; Wealthsimple validates fields and pagination.',
    operationName: 'Accounts',
    query: accountsQuery,
    variables: { first: 25, after: null },
    injectedVariables: ['identityId'],
  }],
};
