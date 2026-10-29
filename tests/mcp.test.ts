import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { Client, StreamableHTTPClientTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { createApp } from '../src/app.js';
import { MCP_MAX_RESPONSE_BYTES } from '../src/mcp.js';
import { libraryProvider, weatherProvider } from './fixtures.js';
import { accountQuery, deferred, fixture, page, respond, tokens } from './wealthsimple-fixtures.js';

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
    routes.post('/graphql', () => 'x'.repeat(MCP_MAX_RESPONSE_BYTES + 1));
  } }]);
  t.after(() => app.close());
  const { client, address } = await connect(t, app);
  const redirect = envelope(await client.callTool({ name: 'describe_provider_graphql', arguments: { providerId: 'library' } }));
  assert.equal(redirect.statusCode, 502);
  assert.equal(touched, false);
  const oversized = await client.callTool({ name: 'query_provider_graphql', arguments: { providerId: 'library', query: '{x}' } });
  assert.equal(oversized.isError, true);
  assert.match(envelope(oversized).body, /8 MiB/);
  const incoming = await fetch(address + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'x'.repeat(1024 * 1024) }) });
  assert.equal(incoming.status, 413);
});

test('MCP cancellation and HTTP transport closure cancel provider work', { timeout: 15000 }, async t => {
  for (const modern of [false, true]) await t.test(modern ? 'modern' : 'legacy', async t => {
    const started = deferred();
    const aborted = deferred();
    const f = await fixture(t, {}, { fetch: async (input, init) => {
      if (new URL(String(input)).pathname !== '/graphql') return fetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { aborted.resolve(); reject(init!.signal!.reason); }, { once: true });
        started.resolve();
      });
    } });
    await f.login();
    const { client, address } = await connect(t, f.app, modern);
    const controller = new AbortController();
    const params = { name: 'query_provider_graphql', arguments: { providerId: 'wealthsimple', query: accountQuery } };
    // Modern clients cancel their per-request HTTP stream. Legacy stateless
    // cancellation must close that stream; a separate notification has no session.
    const pending = modern ? client.callTool(params, { signal: controller.signal }) : fetch(address + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params }),
      signal: controller.signal,
    }).then(response => response.text());
    const rejection = assert.rejects(pending);
    await started.promise;
    controller.abort();
    await Promise.all([aborted.promise, rejection]);
    await client.close();
  });
});

test('MCP readers share refresh; cancelling one leaves refresh and another reader alive', { timeout: 5000 }, async t => {
  const refreshing = deferred();
  const secondReading = deferred();
  const release = deferred();
  let rotations = 0;
  let staleReads = 0;
  const f = await fixture(t, {
    '/graphql': (call, _req, res) => {
      if (call.headers.authorization === 'Bearer rotated') return respond(res, page());
      if (++staleReads === 2) secondReading.resolve();
      respond(res, {}, 401);
    },
    '/token': async (call, _req, res) => {
      if (call.body.grant_type !== 'refresh_token') return respond(res, tokens);
      rotations++;
      refreshing.resolve();
      await release.promise;
      respond(res, { access_token: 'rotated', refresh_token: 'rotated-refresh' });
    },
  });
  t.after(() => release.resolve());
  await f.login();
  const { client } = await connect(t, f.app, true);
  const args = { name: 'query_provider_graphql', arguments: { providerId: 'wealthsimple', query: accountQuery } };
  const controller = new AbortController();
  const first = client.callTool(args, { signal: controller.signal });
  const rejected = assert.rejects(first);
  await refreshing.promise;
  const second = client.callTool(args);
  await secondReading.promise;
  controller.abort();
  await rejected;
  release.resolve();
  assert.equal(envelope(await second).statusCode, 200);
  assert.equal(rotations, 1);
  await client.close();
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
