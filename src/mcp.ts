import type { FastifyInstance } from 'fastify';
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import type { Provider } from './providers.js';

export const MCP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function result(statusCode: number, body: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ statusCode, body }) }],
    ...(statusCode < 200 || statusCode >= 300 ? { isError: true } : {}),
  };
}

export function registerMcp(app: FastifyInstance, providers: readonly Provider[]) {
  async function dispatch(providerId: string, payload?: object) {
    const provider = providers.find(({ metadata }) => metadata.id === providerId);
    if (!provider) return result(404, 'Unknown provider. Call list_providers first.');
    try {
      const response = await app.inject({
        method: payload === undefined ? 'GET' : 'POST',
        url: provider.metadata.graphqlEndpoint,
        payload,
      });
      // Injection buffers the response; providers must bound their upstream reads.
      if (response.rawPayload.byteLength > MCP_MAX_RESPONSE_BYTES) {
        return result(502, 'Provider response exceeded the 8 MiB limit.');
      }
      return result(response.statusCode, response.body);
    } catch {
      return result(502, 'Provider request failed.');
    }
  }

  const handler = createMcpHandler(() => {
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
    }, async ({ providerId }) => dispatch(providerId));
    server.registerTool('query_provider_graphql', {
      description: 'Submit a native read-only GraphQL query after reading the provider documentation. Returns the HTTP status and unchanged response text, including partial data and errors. Login and MFA must be completed manually.',
      inputSchema: z.object({
        providerId,
        query: z.string(),
        variables: z.record(z.string(), z.unknown()).nullable().optional(),
        operationName: z.string().nullable().optional(),
      }).strict(), annotations,
    }, async ({ providerId, ...payload }) => dispatch(providerId, payload));
    return server;
  }, { legacy: 'stateless', maxRequestBodySize: 1024 * 1024 });
  const node = toNodeHandler(handler);
  app.all('/mcp', async (request, reply) => {
    // The SDK owns the raw response; pass Fastify’s already-parsed body.
    reply.hijack();
    reply.raw.setHeader('Cache-Control', 'no-store');
    await node(request.raw, reply.raw, request.body);
  });
  app.addHook('preClose', () => handler.close());
}
