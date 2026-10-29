import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { Client, StreamableHTTPClientTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { createApp } from '../src/app.js';
import { MCP_MAX_RESPONSE_BYTES } from '../src/mcp.js';
import { libraryProvider, weatherProvider } from './fixtures.js';
import { accountQuery, deferred, fixture } from './wealthsimple-fixtures.js';

async function connect(t: TestContext, app: FastifyInstance, modern = false) {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = new Client({ name: 'finsight-test', version: '1.0.0' }, modern ? { versionNegotiation: { mode: 'auto' } } : undefined);
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', address)));
  return { client, address };
}

function envelope(result: CallToolResult): { statusCode: number; body: string } {
  const content = result.content?.[0];
  assert.equal(content?.type, 'text');
  return JSON.parse((content as { text: string }).text);
}

test('MCP discovers an empty catalog using legacy and modern SDK clients', async t => {
  for (const modern of [false, true]) await t.test(modern ? 'modern' : 'legacy', async t => {
    const app = createApp();
    t.after(() => app.close());
    const { client, address } = await connect(t, app, modern);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name),
      ['list_providers', 'describe_provider_graphql', 'query_provider_graphql']);
    const result = envelope(await client.callTool({ name: 'list_providers', arguments: {} }));
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, await (await fetch(address + '/providers')).text());
    assert.deepEqual(JSON.parse(result.body), { providers: [] });
    const unknown = await client.callTool({ name: 'query_provider_graphql', arguments: { providerId: 'missing', query: '{x}' } });
    assert.equal(unknown.isError, true);
    assert.equal(envelope(unknown).statusCode, 404);
    await client.close();
  });
});

test('MCP routes two providers using registered endpoints and preserves native bodies', async t => {
  const { provider, state } = libraryProvider();
  const app = createApp([provider, weatherProvider()]);
  t.after(() => app.close());
  const { client } = await connect(t, app);
  const catalog = JSON.parse(envelope(await client.callTool({ name: 'list_providers' })).body);
  assert.deepEqual(catalog.providers.map((p: { id: string }) => p.id), ['library', 'weather']);
  const docs = await client.callTool({ name: 'describe_provider_graphql', arguments: { providerId: 'library' } });
  assert.equal(JSON.parse(envelope(docs).body).description, 'Library documentation.');
  const input = { query: '{ native }', variables: null, operationName: null };
  const books = await client.callTool({ name: 'query_provider_graphql', arguments: { providerId: 'library', ...input } });
  assert.deepEqual(JSON.parse(envelope(books).body), { received: input });
  assert.equal(state.calls, 1);
  const weather = await client.callTool({ name: 'query_provider_graphql', arguments: { providerId: 'weather', query: '{ observation { celsius } }' } });
  assert.equal(JSON.parse(envelope(weather).body).data.observation.celsius, 12.5);
  const invalid = await client.callTool({ name: 'query_provider_graphql', arguments: { providerId: 'library', query: 4 } });
  assert.equal(invalid.isError, true);
  assert.equal(state.calls, 1);
});

test('MCP preserves Wealthsimple validation, identity, partial data, and transport failures', async t => {
  let status = 200;
  let body = ' { "data": {"amount":"1234567890.123456789"}, "errors":[{"message":"partial"}] }\n';
  const f = await fixture(t, { '/graphql': (_call, _req, res) => { res.writeHead(status); res.end(body); } });
  const { client } = await connect(t, f.app);
  const call = (query = accountQuery, variables?: Record<string, unknown>) => client.callTool({
    name: 'query_provider_graphql', arguments: { providerId: 'wealthsimple', query, variables },
  });
  const docs = envelope(await client.callTool({ name: 'describe_provider_graphql', arguments: { providerId: 'wealthsimple' } }));
  assert.equal(JSON.parse(docs.body).references.length, 9);
  assert.equal(envelope(await call()).statusCode, 401);
  await f.login();
  for (const query of ['mutation { trade }', 'subscription { price }', 'query Q { x } mutation M { x }', '{']) {
    const rejected = await call(query);
    assert.equal(rejected.isError, true);
    assert.equal(envelope(rejected).statusCode, 400);
  }
  assert.equal(f.calls.filter(call => call.path === '/graphql').length, 0);
  const partial = await call(accountQuery, { identityId: 'caller-identity' });
  assert.notEqual(partial.isError, true);
  assert.equal(envelope(partial).body, body);
  assert.equal(f.calls.at(-1)!.body.variables.identityId, 'IDENTITY_SENTINEL');
  status = 503;
  body = 'UPSTREAM_SECRET';
  const failed = await call();
  assert.equal(failed.isError, true);
  assert.equal(envelope(failed).statusCode, 502);
  assert.doesNotMatch(JSON.stringify(failed), /UPSTREAM_SECRET/);
});

test('MCP bounds incoming bodies and provider responses, and never follows redirects', async t => {
  let touched = false;
  const provider = libraryProvider().provider;
  const app = createApp([{ ...provider, routes: async routes => {
    routes.get('/graphql', (_req, reply) => reply.redirect('/providers/library/forbidden'));
    routes.get('/forbidden', () => { touched = true; return {}; });
    routes.post('/graphql', () => 'é'.repeat(MCP_MAX_RESPONSE_BYTES / 2 + 1));
  } }]);
  t.after(() => app.close());
  const { client, address } = await connect(t, app);
  const redirect = await client.callTool({ name: 'describe_provider_graphql', arguments: { providerId: 'library' } });
  assert.equal(redirect.isError, true);
  assert.equal(envelope(redirect).statusCode, 302);
  assert.equal(touched, false);
  const oversized = await client.callTool({ name: 'query_provider_graphql', arguments: { providerId: 'library', query: '{x}' } });
  assert.equal(oversized.isError, true);
  assert.match(envelope(oversized).body, /8 MiB/);
  const incoming = await fetch(address + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'x'.repeat(1024 * 1024) }) });
  assert.equal(incoming.status, 413);
});

test('shutdown aborts a pending MCP call before draining', { timeout: 5000 }, async t => {
  const started = deferred();
  let aborted = false;
  const f = await fixture(t, {}, { fetch: async (input, init) => {
    if (new URL(String(input)).pathname !== '/graphql') return fetch(input, init);
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { aborted = true; reject(init!.signal!.reason); }, { once: true });
      started.resolve();
    });
  } });
  await f.login();
  const { client } = await connect(t, f.app);
  const pending = client.callTool({ name: 'query_provider_graphql', arguments: { providerId: 'wealthsimple', query: accountQuery } }).catch(() => undefined);
  await started.promise;
  await f.app.close();
  await pending;
  assert.equal(aborted, true);
});
