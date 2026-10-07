import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, MAX_REQUEST_BODY_SIZE } from '../src/app.js';
import { libraryProvider, weatherProvider } from './fixtures.js';

test('default app has an empty catalog and no financial or fixture endpoints', async t => {
  const app = createApp();
  t.after(() => app.close());
  assert.deepEqual((await app.inject('/providers')).json(), { providers: [] });
  for (const url of ['/graphql', '/accounts', '/providers/library/graphql', '/providers/wealthsimple/connection']) {
    assert.equal((await app.inject(url)).statusCode, 404);
  }
});

test('core mounts isolated provider-owned routes and publishes only metadata', async t => {
  const { provider, state } = libraryProvider();
  const app = createApp([weatherProvider(), provider]);
  t.after(() => app.close());
  const catalog = (await app.inject('/providers')).json().providers;
  assert.deepEqual(catalog, [provider.metadata, weatherProvider().metadata]);
  assert.deepEqual((await app.inject('/providers/library/books')).json(), { title: 'Example' });
  assert.equal((await app.inject('/providers/weather/books')).statusCode, 404);
  assert.equal((await app.inject('/providers/library/connection')).statusCode, 404);
  assert.equal((await app.inject('/providers/library/graphql')).json().description, 'Library documentation.');
  // Core does not inspect provider payloads or impose GraphQL modes/policy.
  const payload = { custom: ['request'] };
  assert.deepEqual((await app.inject({ method: 'POST', url: '/providers/library/graphql', payload })).json(), { received: payload });
  assert.equal(state.calls, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/providers/weather/graphql', payload })).json().data.observation.celsius, 12.5);
});

test('provider routes are never cached, do not enable CORS, and respect the body ceiling', async t => {
  const { provider, state } = libraryProvider();
  const app = createApp([provider]);
  t.after(() => app.close());
  const response = await app.inject({ url: '/providers/library/books', headers: { origin: 'https://example.test' } });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  const oversized = await app.inject({ method: 'POST', url: '/providers/library/graphql', payload: { value: 'x'.repeat(MAX_REQUEST_BODY_SIZE) } });
  assert.equal(oversized.statusCode, 413);
  assert.equal(state.calls, 0);
});
