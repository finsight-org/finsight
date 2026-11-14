import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createMcpHandler, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { bearerToken, type AuthConfig, type RequestIdentity, type VerifyAccessToken } from './auth.js';
import { ConnectionError, parseConnectionId, parseListInput } from './connections/model.js';
import { ownedSessionAccess, withConnectionCancellation } from './connections/session-routes.js';
import type { ConnectionStoreFactory } from './connections/store.js';
import { MCP_MAX_RESPONSE_BYTES, result } from './mcp.js';
import type { Provider } from './providers.js';
import { WealthsimpleError } from './providers/wealthsimple/client.js';
import { describeWealthsimpleGraphql } from './providers/wealthsimple/index.js';
import { assertQueryOnly } from './providers/wealthsimple/validation.js';
import { SessionError } from './sessions/model.js';
import type { WealthsimpleSessionService } from './sessions/wealthsimple-service.js';

export interface McpOAuthConfig {
  resource: string;
  issuer: string;
}

const metadataPath = '/.well-known/oauth-protected-resource/mcp';
const scope = 'openid';
const grantClaims = z.object({
  iss: z.string(),
  aud: z.array(z.string()),
  sub: z.uuid(),
  client_id: z.uuid(),
  session_id: z.uuid().refine(id => id !== '00000000-0000-0000-0000-000000000000'),
  exp: z.number().int(),
  nbf: z.number().int().optional(),
  role: z.literal('authenticated'),
  scope: z.string(),
  finsight_mcp_read: z.literal(true),
});

export function readMcpOAuthConfig(env: NodeJS.ProcessEnv, auth: AuthConfig | undefined): McpOAuthConfig | undefined {
  const host = env.FINSIGHT_PUBLIC_HOST?.trim();
  if (!host) return undefined;
  if (!auth || !auth.supabaseUrl.startsWith('https://') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
    !auth.webOrigins.includes('https://' + host)) {
    throw new Error('HTTPS MCP requires a public DNS host, HTTPS Supabase, and the matching web origin.');
  }
  return { resource: 'https://' + host + '/mcp', issuer: auth.supabaseUrl + '/auth/v1' };
}

export function registerMcpOAuth(app: FastifyInstance, options: {
  config: McpOAuthConfig;
  verify: VerifyAccessToken;
  providers: readonly Provider[];
  createStore?: ConnectionStoreFactory;
  sessions?: WealthsimpleSessionService;
}): void {
  const { config } = options;
  const metadataUrl = new URL(metadataPath, config.resource).href;
  const challenge = `Bearer resource_metadata="${metadataUrl}", scope="${scope}"`;
  const providers = options.providers.filter(provider => provider.metadata.id === 'wealthsimple');
  const oauth = {
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: [scope] }] },
  };

  async function verify(token: string | undefined) {
    if (!token) return { status: 'unauthenticated' } as const;
    const verification = await options.verify(token).catch(() => ({ status: 'unavailable' } as const));
    if (verification.status !== 'authenticated') return verification;
    const parsed = grantClaims.safeParse(verification.claims);
    if (!parsed.success) return { status: 'unauthenticated' } as const;
    const claims = parsed.data;
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== config.issuer || !claims.aud.includes(config.resource) ||
      claims.sub !== verification.user.id || !claims.scope.split(' ').includes(scope) ||
      claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now))
      return { status: 'unauthenticated' } as const;
    const authInfo: AuthInfo = {
      token, clientId: claims.client_id, scopes: [scope], expiresAt: claims.exp,
      resource: new URL(config.resource), resourceMetadataUrl: metadataUrl,
    };
    const identity: RequestIdentity = { user: verification.user, accessToken: token };
    return { status: 'authenticated', authInfo, identity } as const;
  }

  type Authorized = Extract<Awaited<ReturnType<typeof verify>>, { status: 'authenticated' }>;
  const authorizedRequests = new WeakMap<AuthInfo, { grant: Authorized; signal: AbortSignal }>();
  const authRequired = () => ({
    ...result(401, 'FinSight authorization is required. Reconnect FinSight to continue.'),
    _meta: { 'mcp/www_authenticate': [challenge + ', error="invalid_token", error_description="FinSight authorization is required"'] },
  });
  const unavailable = () => result(503, 'FinSight authorization is temporarily unavailable.');

  const handler = createMcpHandler(({ authInfo }) => {
    const request = authInfo && authorizedRequests.get(authInfo);
    const server = new McpServer({ name: 'finsight', version: '0.1.0' }, {
      instructions: 'List providers and connections, then describe the provider before querying. Use an explicit connectionId from list_connections. Connect or reconnect Wealthsimple in the FinSight web app.',
    });
    const providerId = z.string();
    server.registerTool('list_providers', {
      ...oauth, description: 'List providers supported by FinSight.', inputSchema: z.object({}).strict(),
    }, async () => request
      ? result(200, JSON.stringify({ providers: providers.map(({ metadata }) => ({ id: metadata.id, name: metadata.name, description: metadata.description })) }))
      : authRequired());
    server.registerTool('describe_provider_graphql', {
      ...oauth, description: 'Read GraphQL documentation and reference queries for a provider.',
      inputSchema: z.object({ providerId }).strict(),
    }, async ({ providerId }) => {
      if (!request) return authRequired();
      if (!providers.some(provider => provider.metadata.id === providerId)) return result(404, 'Unknown provider.');
      return result(200, JSON.stringify(await describeWealthsimpleGraphql()));
    });
    server.registerTool('list_connections', {
      ...oauth, description: 'List your FinSight connections. Use their labels and IDs to select a connection.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional() }).strict(),
    }, async ({ limit, cursor }) => {
      if (!request) return authRequired();
      if (!options.createStore) return result(503, 'Connection storage is temporarily unavailable.');
      try {
        const input = parseListInput({ limit: limit?.toString(), cursor });
        const page = await options.createStore(request.grant.identity, request.signal).list(input);
        const live = await verify(request.grant.identity.accessToken);
        if (live.status !== 'authenticated') return live.status === 'unavailable' ? unavailable() : authRequired();
        return result(200, JSON.stringify({
          connections: page.connections.map(({ id, providerId, label }) => ({ id, providerId, label })),
          nextCursor: page.nextCursor,
        }));
      } catch (error) { return toolFailure(error); }
    });
    server.registerTool('query_provider_graphql', {
      ...oauth, description: 'Run a native read-only GraphQL query against the selected FinSight connection.',
      inputSchema: z.object({
        connectionId: z.uuid(),
        query: z.string(),
        variables: z.record(z.string(), z.unknown()).nullable().optional(),
        operationName: z.string().nullable().optional(),
      }).strict(),
    }, async ({ connectionId, ...input }) => {
      if (!request) return authRequired();
      const { grant: { identity }, signal } = request;
      try {
        assertQueryOnly(input.query);
        const access = await ownedSessionAccess(parseConnectionId(connectionId), identity, options.createStore, signal);
        if (!providers.some(p => p.metadata.id === access.binding.providerId))
          throw new SessionError('CONNECTION_PROVIDER_UNSUPPORTED');
        if (!options.sessions) throw new SessionError('SESSION_NOT_CONFIGURED');
        const response = await options.sessions.graphql(access, input, signal);
        const live = await verify(identity.accessToken);
        if (live.status !== 'authenticated') return live.status === 'unavailable' ? unavailable() : authRequired();
        await access.checkOwnership(signal);
        if (response.status >= 500) return result(502, 'Provider request failed.');
        if (Buffer.byteLength(response.text) > MCP_MAX_RESPONSE_BYTES)
          return result(502, 'Provider response exceeded the 8 MiB limit.');
        return result(response.status, response.text);
      } catch (error) { return toolFailure(error); }
    });
    return server;
  }, { legacy: 'stateless', maxRequestBodySize: 1024 * 1024 });

  function toolFailure(error: unknown) {
    if (error instanceof ConnectionError && error.code === 'UNAUTHENTICATED') return authRequired();
    if (error instanceof WealthsimpleError && error.code === 'WEALTHSIMPLE_NOT_CONNECTED')
      return result(409, 'Reconnect this Wealthsimple connection in FinSight before querying.');
    if (error instanceof ConnectionError || error instanceof SessionError || error instanceof WealthsimpleError)
      return result(error.statusCode, error.message);
    return result(502, 'Provider request failed.');
  }

  app.get(metadataPath, async (_request, reply) => reply.header('Cache-Control', 'no-store').send({
    resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [scope],
  }));
  const node = toNodeHandler(handler);
  app.all('/mcp', async (request: FastifyRequest, reply) => {
    reply.header('Cache-Control', 'no-store');
    const token = bearerToken(request.headers.authorization);
    const grant = await verify(token);
    if (grant.status === 'unavailable')
      return reply.code(503).send({ error: 'FinSight authorization is temporarily unavailable.' });
    if (grant.status !== 'authenticated')
      return reply.header('WWW-Authenticate', token ? challenge + ', error="invalid_token"' : challenge)
        .code(401).send({ error: 'FinSight authorization is required.' });
    return withConnectionCancellation(request, reply, async signal => {
      authorizedRequests.set(grant.authInfo, { grant, signal });
      const raw: typeof request.raw & { auth?: AuthInfo } = request.raw;
      raw.auth = grant.authInfo;
      reply.hijack();
      reply.raw.setHeader('Cache-Control', 'no-store');
      try { await node(raw, reply.raw, request.body); }
      finally {
        authorizedRequests.delete(grant.authInfo);
        delete raw.auth;
      }
    });
  });
  app.addHook('preClose', () => handler.close());
}
