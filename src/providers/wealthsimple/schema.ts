import { GraphQLError } from 'graphql';
import { createSchema } from 'graphql-yoga';
import type { ProviderContext } from '../../providers.js';
import { createAccounts, type AccountPageArguments } from './operations/accounts.js';
import type { WealthsimpleApiClient } from './upstream/client.js';
import { publicError, WealthsimpleError } from './errors.js';

/** FinSight-facing schema; resolvers use provider operations only. */
export function createWealthsimpleSchema(client: WealthsimpleApiClient) {
  const accounts = createAccounts(client);
  return createSchema<ProviderContext>({
    typeDefs: `
      "An account reported by Wealthsimple; types and statuses retain Wealthsimple's meanings."
      type WealthsimpleAccount {
        "The Wealthsimple account identifier."
        id: ID!
        "The upstream nickname, or null when unavailable."
        nickname: String
        "Wealthsimple's unified account type, without normalization."
        unifiedAccountType: String
        "The account currency reported by Wealthsimple."
        currency: String
        "Wealthsimple's account status, without normalization."
        status: String
      }
      "One page from Wealthsimple's direct account collection."
      type WealthsimpleAccountConnection {
        "Account edges in upstream order; duplicates are preserved."
        edges: [WealthsimpleAccountEdge!]!
        "Upstream continuation information for this page."
        pageInfo: WealthsimpleAccountPageInfo!
      }
      type WealthsimpleAccountEdge {
        node: WealthsimpleAccount!
      }
      type WealthsimpleAccountPageInfo {
        "Whether another page is available."
        hasNextPage: Boolean!
        "Supply this cursor as after in the next request."
        endCursor: String
      }
      type Query {
        "One account page for the connected identity, including non-open statuses. Requires a connection. Call again with pageInfo.endCursor when hasNextPage is true."
        accounts(
          "Page size from 1 through 100; defaults to 25."
          first: Int! = 25
          "Upstream cursor, passed unchanged; omit or use null for the first page."
          after: String
        ): WealthsimpleAccountConnection
      }
    `,
    resolvers: {
      Query: {
        accounts: async (_parent, args: AccountPageArguments, { signal }) => {
          try {
            if (args.first < 1 || args.first > 100) {
              throw new WealthsimpleError('INVALID_PAGINATION');
            }
            return await accounts.getPage(args, signal);
          } catch (error) {
            const safe = publicError(error);
            throw new GraphQLError(safe.message, { extensions: { code: safe.code } });
          }
        },
      },
    },
  });
}
