import type { FastifyInstance } from 'fastify';
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import type { Provider } from './providers.js';

export const MCP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MCP_BRIDGE_TIMEOUT_MS = 95_000;

function result(statusCode: number, body: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ statusCode, body }) }],
    ...(statusCode < 200 || statusCode >= 300 ? { isError: true } : {}),
  };
}

export function registerMcp(app: FastifyInstance, providers: readonly Provider[]) {
  const shutdown = new AbortController();
  const byId = new Map(providers.map(provider => [provider.metadata.id, provider.metadata]));

  async function dispatch(providerId: string, signal: AbortSignal, payload?: unknown) {
    const provider = byId.get(providerId);
    if (!provider) return result(404, 'Unknown provider. Call list_providers first.');
    const address = app.server.address();
    if (!address || typeof address === 'string') return result(503, 'Finsight is not listening.');
    const host = address.family === 'IPv6' ? '[::1]' : '127.0.0.1';
    const requestSignal = AbortSignal.any([signal, shutdown.signal, AbortSignal.timeout(MCP_BRIDGE_TIMEOUT_MS)]);
    try {
      const response = await fetch(`http://${host}:${address.port}${provider.graphqlEndpoint}`, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: { accept: 'application/json', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        redirect: 'error',
        signal: requestSignal,
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MCP_MAX_RESPONSE_BYTES) {
              await reader.cancel();
              return result(502, 'Provider response exceeded the 8 MiB limit.');
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      requestSignal.throwIfAborted();
      return result(response.status, Buffer.concat(chunks).toString('utf8'));
    } catch {
      // Neither transport diagnostics nor provider input belong in logs or errors.
      return result(requestSignal.aborted ? 504 : 502,
        requestSignal.aborted ? 'Provider request cancelled or timed out.' : 'Provider request failed.');
    }
  }

  const handler = createMcpHandler(({ requestInfo }) => {
    const callSignal = (signal: AbortSignal) => AbortSignal.any([signal, ...(requestInfo ? [requestInfo.signal] : [])]);
    const server = new McpServer({ name: 'finsight', version: '0.1.0' }, {
      instructions: 'First call list_providers, then describe_provider_graphql for the selected provider, then query_provider_graphql. Reference queries are examples, not executable IDs. Use native queries and handle pagination yourself. Connect providers manually outside MCP.',
    });
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
    const providerId = z.string().describe('An exact provider ID returned by list_providers.');
    server.registerTool('list_providers', {
      description: 'Discover available providers before requesting their GraphQL documentation. Registration does not imply a connected or healthy provider.',
      inputSchema: z.object({}).strict(), annotations,
    }, async () => result(200, JSON.stringify({ providers: providers.map(({ metadata }) => metadata) })));
    server.registerTool('describe_provider_graphql', {
      description: 'Read a provider’s GraphQL documentation and reference queries before constructing a native query. Documentation is available while disconnected.',
      inputSchema: z.object({ providerId }).strict(), annotations,
    }, async ({ providerId }, context) => dispatch(providerId, callSignal(context.mcpReq.signal)));
    server.registerTool('query_provider_graphql', {
      description: 'Submit a native read-only GraphQL query after reading the provider documentation. Returns the HTTP status and unchanged response text, including partial data and errors. Login and MFA must be completed manually.',
      inputSchema: z.object({
        providerId,
        query: z.string(),
        variables: z.record(z.string(), z.unknown()).nullable().optional(),
        operationName: z.string().nullable().optional(),
      }).strict(), annotations,
    }, async ({ providerId, ...payload }, context) => dispatch(providerId, callSignal(context.mcpReq.signal), payload));
    return server;
  }, { legacy: 'stateless', maxRequestBodySize: 1024 * 1024 });
  const node = toNodeHandler(handler);
  app.all('/mcp', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    // The SDK owns the raw response; pass Fastify’s already-parsed body.
    reply.hijack();
    reply.raw.setHeader('Cache-Control', 'no-store');
    await node(request.raw, reply.raw, request.body);
  });
  app.addHook('preClose', async () => {
    shutdown.abort();
    await handler.close();
  });
}
