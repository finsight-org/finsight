import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { getIntrospectionQuery } from 'graphql';
import { createSchema } from 'graphql-yoga';
import { createApp } from '../src/app.js';
import { MAX_REQUEST_BODY_SIZE } from '../src/provider-api.js';
import type { ProviderContext, ProviderDefinition } from '../src/providers.js';
import { libraryProvider, weatherProvider } from './fixtures.js';

function appFor(t: TestContext, providers: readonly ProviderDefinition[] = []) {
  const app = createApp(providers);
  t.after(() => app.close());
  return app;
}

test('default application exposes an empty catalog and no legacy or fixture endpoints', async (t) => {
  const app = appFor(t);
  const response = await app.inject('/providers');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { providers: [] });
  for (const url of ['/graphql', '/providers/library/graphql', '/providers/unknown/graphql']) {
    assert.equal((await app.inject(url)).statusCode, 404);
  }
});

test('discover, introspect and query two unrelated provider schemas over HTTP', async (t) => {
  const app = appFor(t, [weatherProvider(), libraryProvider().provider]);
  const catalog = (await app.inject('/providers')).json();
  assert.deepEqual(catalog.providers, [
    { id: 'library', mode: 'schema', name: 'Library', description: 'Synthetic books and publication dates.', graphqlEndpoint: '/providers/library/graphql' },
    { id: 'weather', mode: 'schema', name: 'Weather', description: 'Synthetic weather observations.', graphqlEndpoint: '/providers/weather/graphql' },
  ]);
  for (const provider of catalog.providers) {
    const response = await app.inject({ method: 'POST', url: provider.graphqlEndpoint, payload: { query: getIntrospectionQuery() } });
    assert.equal(response.statusCode, 200);
    const { data, errors } = response.json();
    assert.equal(errors, undefined);
    const record = data.__schema.types.find((type: { name: string }) => type.name === 'Record');
    assert.deepEqual(record.fields.map((field: { name: string }) => field.name), provider.id === 'library' ? ['title', 'published'] : ['celsius', 'station']);
    assert.equal(data.__schema.mutationType, null);
    assert.equal(data.__schema.subscriptionType, null);
    if (provider.id === 'library') {
      const query = data.__schema.types.find((type: { name: string }) => type.name === 'Query');
      assert.equal(query.fields.find((field: { name: string }) => field.name === 'book').description, 'Find a synthetic book by title.');
    }
  }
  const response = await app.inject({
    method: 'POST', url: catalog.providers[0].graphqlEndpoint,
    payload: {
      query: 'query Unused { __typename } query Read($title: String!) { chosen: book(title: $title) { ...Details } } fragment Details on Record { title published }',
      operationName: 'Read', variables: { title: 'A book' },
    },
  });
  assert.deepEqual(response.json(), { data: { chosen: { title: 'A book', published: '2001-02-03' } } });
  const weather = await app.inject({ method: 'POST', url: catalog.providers[1].graphqlEndpoint, payload: { query: '{ observation { celsius station } }' } });
  assert.deepEqual(weather.json(), { data: { observation: { celsius: 12.5, station: 'north' } } });
  for (const [id, query] of [
    ['library', '{ observation { celsius } }'],
    ['weather', '{ book(title: "x") { title } }'],
    ['library', '{ book(title: "x") { celsius } }'],
    ['weather', '{ observation { title } }'],
  ]) {
    const invalid = await app.inject({ method: 'POST', url: `/providers/${id}/graphql`, payload: { query } });
    assert.ok(invalid.json().errors.length);
    assert.equal(invalid.json().data, undefined);
  }
});

test('query-only validation rejects entire mixed documents before calling resolvers', async (t) => {
  const { provider, state } = libraryProvider();
  const app = appFor(t, [provider]);
  for (const payload of [
    { query: 'mutation { book(title: "x") { title } }' },
    { query: 'subscription { book(title: "x") { title } }' },
    { query: 'query Read { book(title: "x") { title } } mutation Write { __typename }', operationName: 'Read' },
    { query: 'query Read { book(title: "x") { title } } subscription Watch { __typename }', operationName: 'Read' },
    { query: '{' },
    { query: '{ book(title: "x") { missing } }' },
    { query: 'query Read($title: String!) { book(title: $title) { title } }', variables: { title: 5 } },
    { query: 'query A { __typename } query B { __typename }' },
    { query: 'query A { __typename }', operationName: 'B' },
    { query: '{ book(title: "x") { ... @defer { title } } }' },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/providers/library/graphql', payload });
    assert.ok(response.json().errors.length, JSON.stringify(payload));
    if (payload.query.includes('mutation') || payload.query.includes('subscription')) {
      assert.ok(response.json().errors.some((error: { message: string }) => error.message === 'Only query operations are supported.'));
    }
  }
  assert.equal(state.calls, 0);
});

test('standard partial results preserve safe errors and mask unexpected diagnostics', async (t) => {
  const app = appFor(t, [libraryProvider().provider]);
  const response = await app.inject({
    method: 'POST', url: '/providers/library/graphql',
    payload: { query: '{ book(title: "x") { title } absent: unavailable broken }' },
  });
  assert.equal(response.statusCode, 200);
  const result = response.json();
  assert.deepEqual(result.data, { book: { title: 'x' }, absent: null, broken: null });
  const safe = result.errors.find((error: { message: string }) => error.message === 'Book temporarily unavailable.');
  assert.deepEqual(safe.path, ['absent']);
  assert.deepEqual(safe.extensions, { code: 'BOOK_UNAVAILABLE' });
  assert.equal(safe.locations[0].line, 1);
  const masked = result.errors.find((error: { path: string[] }) => error.path[0] === 'broken');
  assert.equal(masked.message, 'Unexpected error.');
  assert.equal(masked.locations[0].line, 1);
  assert.doesNotMatch(response.body, /PRIVATE|diagnostic|token|stack|originalError/);
});

test('transport supports GET and GraphiQL, disables CORS, and never caches provider responses', async (t) => {
  const app = appFor(t, [libraryProvider().provider]);
  const endpoint = '/providers/library/graphql';
  const get = await app.inject(`${endpoint}?query=${encodeURIComponent('{ __typename }')}`);
  assert.deepEqual(get.json(), { data: { __typename: 'Query' } });
  const ide = await app.inject({ url: endpoint, headers: { accept: 'text/html' } });
  assert.equal(ide.statusCode, 200);
  assert.match(ide.body, /GraphiQL/);
  assert.ok(ide.body.includes(endpoint));
  const preflight = await app.inject({ method: 'OPTIONS', url: endpoint, headers: { origin: 'https://example.org', 'access-control-request-method': 'POST' } });
  const crossOrigin = await app.inject({ method: 'POST', url: endpoint, headers: { origin: 'https://example.org' }, payload: { query: '{ __typename }' } });
  for (const response of [get, ide, preflight, crossOrigin]) {
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('transport rejects oversized, batched, multipart and malformed requests before execution', async (t) => {
  const { provider, state } = libraryProvider();
  const app = appFor(t, [provider]);
  const url = '/providers/library/graphql';
  const oversized = await app.inject({ method: 'POST', url, payload: { query: ' '.repeat(MAX_REQUEST_BODY_SIZE) } });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.headers['cache-control'], 'no-store');
  const batch = await app.inject({ method: 'POST', url, payload: [{ query: '{ book(title: "x") { title } }' }] });
  assert.ok(batch.statusCode >= 400);
  const malformed = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: '{invalid' });
  assert.equal(malformed.statusCode, 400);
  const multipart = await app.inject({ method: 'POST', url, headers: { 'content-type': 'multipart/form-data; boundary=test' }, payload: '--test--\r\n' });
  assert.ok(multipart.statusCode >= 400);
  assert.equal(state.calls, 0);
});

test('concurrent requests receive separate contexts and cancellation signals', async (t) => {
  const { provider, state } = libraryProvider();
  const app = appFor(t, [provider]);
  const responses = await Promise.all(['one', 'two'].map((title) => app.inject({
    method: 'POST', url: '/providers/library/graphql', payload: { query: 'query($title: String!) { book(title: $title) { title } }', variables: { title } },
  })));
  assert.deepEqual(responses.map((response) => response.json().data.book.title), ['one', 'two']);
  assert.equal(state.contexts.length, 2);
  assert.notEqual(state.contexts[0], state.contexts[1]);
  assert.notEqual(state.contexts[0].signal, state.contexts[1].signal);
});

test('disconnecting a real HTTP request cancels cooperative provider work', { timeout: 5000 }, async (t) => {
  let markStarted!: () => void;
  let markCancelled!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const cancelled = new Promise<void>((resolve) => { markCancelled = resolve; });
  const provider: ProviderDefinition = {
    id: 'slow', name: 'Slow', description: 'Cancellation fixture.',
    mode: 'schema',
    schema: createSchema<ProviderContext>({
      typeDefs: 'type Query { wait: String }',
      resolvers: { Query: { wait: (_parent, _args, { signal }) => new Promise((resolve) => {
        const cancel = () => { markCancelled(); resolve(null); };
        if (signal.aborted) cancel();
        else signal.addEventListener('abort', cancel, { once: true });
        markStarted();
      }) } },
    }),
  };
  const app = appFor(t, [provider]);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const request = fetch(`${address}/providers/slow/graphql`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ wait }' }), signal: controller.signal,
  }).catch((error: unknown) => error);
  await started;
  controller.abort();
  await cancelled;
  assert.ok((await request) instanceof Error);
});
