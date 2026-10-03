import { GraphQLError } from 'graphql';
import { createSchema } from 'graphql-yoga';
import type { ProviderContext, ProviderDefinition } from '../../providers.js';
import { createAccounts, type AccountPageArguments } from './accounts.js';
import { WealthsimpleApiClient } from './client.js';
import { WealthsimpleConnection, type ConnectInput, type WealthsimpleOptions } from './connection.js';
import { WealthsimpleError, type ErrorCode } from './errors.js';
export type { WealthsimpleOptions, Clock } from './connection.js';

const instructions = {
  login: { method: 'POST', required: ['email', 'password'], outcomes: ['connected', 'mfa_required'] },
  completeMfa: {
    method: 'POST', required: ['attemptId', 'email', 'password', 'otp'],
    description: 'Use the attemptId from the login response and the same email. Resubmit the password with one OTP. Attempts expire after five minutes; a rejected OTP requires a new login.',
  },
  disconnect: { method: 'DELETE', description: 'Clear the local session. This does not revoke the remote Wealthsimple session.' },
};

export function wealthsimpleProvider(options: WealthsimpleOptions = {}): ProviderDefinition {
  const connection = new WealthsimpleConnection(options);
  const api = new WealthsimpleApiClient(connection, options.operationTimeoutMs);
  const accounts = createAccounts(api);
  return {
    id: 'wealthsimple', name: 'Wealthsimple', description: 'Read Wealthsimple account metadata.',
    schema: createSchema<ProviderContext>({
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
      resolvers: { Query: { accounts: async (_parent, args: AccountPageArguments, { signal }) => {
        try {
          if (args.first < 1 || args.first > 100) {
            throw new WealthsimpleError('INVALID_PAGINATION');
          }
          return await accounts.getPage(args, signal);
        }
        catch (error) {
          const safe = publicError(error);
          throw new GraphQLError(safe.message, { extensions: { code: safe.code } });
        }
      } } },
    }),
    connectionRoutes: async (app) => {
      // Abort provider work before Fastify waits for in-flight requests to finish.
      app.addHook('preClose', async () => { connection.close(); });
      app.addHook('onClose', async () => { connection.close(); });
      app.setErrorHandler((error, _req, reply) => {
        const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
        const safe = error instanceof WealthsimpleError ? error :
          typeof status === 'number' && status >= 400 && status < 500
            ? new WealthsimpleError('INVALID_REQUEST') : publicError(error);
        reply.code(httpStatus[safe.kind]).send({ error: { code: safe.code, message: safe.message } });
      });
      app.get('/', { prefixTrailingSlash: 'both' }, async () => ({ status: connection.getStatus(), instructions }));
      app.post('/', { prefixTrailingSlash: 'both', bodyLimit: 16 * 1024 }, async (req, reply) => {
        const input = loginInput(req.body);
        const controller = new AbortController();
        const abort = () => controller.abort();
        const close = () => { if (!reply.raw.writableFinished) abort(); };
        req.raw.once('aborted', abort);
        reply.raw.once('close', close);
        try { return await connection.connect(input, controller.signal); }
        finally {
          req.raw.removeListener('aborted', abort);
          reply.raw.removeListener('close', close);
        }
      });
      app.delete('/', { prefixTrailingSlash: 'both' }, async (_req, reply) => {
        connection.disconnect();
        return reply.code(204).send();
      });
    },
  };
}

// Validate caller-owned data once, before invoking the client.
function loginInput(value: unknown): ConnectInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['email', 'password', 'attemptId', 'otp'].includes(key)) ||
      typeof input.email !== 'string' || !input.email.trim() || input.email.length > 320 ||
      typeof input.password !== 'string' || !input.password || input.password.length > 4096) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  const credentials = { email: input.email.trim(), password: input.password };
  if (input.attemptId === undefined && input.otp === undefined) return credentials;
  if (typeof input.attemptId !== 'string' || !input.attemptId || input.attemptId.length > 128 ||
      typeof input.otp !== 'string' || !/^\d{1,32}$/.test(input.otp)) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  return { ...credentials, attemptId: input.attemptId, otp: input.otp };
}

const httpStatus: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400, INVALID_PAGINATION: 400, LOGIN_FAILED: 401,
  CONNECTION_CONFLICT: 409, NOT_CONNECTED: 409, RECONNECT_REQUIRED: 401,
  RATE_LIMITED: 429, TIMEOUT: 504, CANCELLED: 409,
  INVALID_RESPONSE: 502, UPSTREAM_FAILURE: 502,
};

function publicError(error: unknown): WealthsimpleError {
  return error instanceof WealthsimpleError ? error : new WealthsimpleError('UPSTREAM_FAILURE');
}
