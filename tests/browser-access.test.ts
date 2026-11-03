import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { authConfig } from './auth-fixtures.js';
import { libraryProvider } from './fixtures.js';

test('allowed application origins receive CORS on success and auth errors; preflight does no Auth work', async t => {
  let calls = 0;
  const app = createApp([], { auth: authConfig, verifyAccessToken: async token => {
    calls++;
    return token === 'outage' ? { status: 'unavailable' } : { status: 'authenticated', user: { id: 'user-a', email: null } };
  } }); t.after(() => app.close());
  const origin = 'http://127.0.0.1:5173';
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/me', headers: {
    origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'Authorization',
  } });
  assert.equal(preflight.statusCode, 204); assert.equal(calls, 0);
  assert.equal(preflight.headers['access-control-allow-methods'], 'GET');
  assert.equal(preflight.headers['access-control-allow-headers'], 'Authorization');
  for (const [authorization, status] of [['', 401], ['Bearer ok', 200], ['Bearer outage', 503]] as const) {
    const r = await app.inject({ url: '/api/me', headers: { origin, authorization } });
    assert.equal(r.statusCode, status);
    assert.equal(r.headers['access-control-allow-origin'], origin);
    assert.match(String(r.headers.vary), /Origin/);
    assert.equal(r.headers['access-control-allow-credentials'], undefined);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal((await app.inject({ url: '/api/me', headers: { authorization: 'Bearer ok' } })).statusCode, 200);
});

test('untrusted origins, hosts, preflight methods and headers are rejected without Auth work', async t => {
  let calls = 0;
  const app = createApp([], { auth: authConfig, verifyAccessToken: async () => { calls++; return { status: 'unavailable' }; } });
  t.after(() => app.close());
  for (const origin of ['', 'null', 'https://evil.test', 'http://127.0.0.1:5173.evil.test', 'http://localhost:5173']) {
    const r = await app.inject({ url: '/api/me', headers: { origin } });
    assert.equal(r.statusCode, 403); assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  for (const [method, headers] of [['POST', 'Authorization'], ['GET', 'X-User-Id'], ['GET', 'Authorization, X-User-Id']]) {
    assert.equal((await app.inject({ method: 'OPTIONS', url: '/api/me', headers: {
      origin: authConfig.webOrigins[0], 'access-control-request-method': method, 'access-control-request-headers': headers,
    } })).statusCode, 403);
  }
  assert.equal((await app.inject({ url: '/api/me', headers: { host: 'evil.test', authorization: 'Bearer ok' } })).statusCode, 403);
  assert.equal(calls, 0);
});

test('frontend origins never unlock legacy routes or unknown API paths', async t => {
  const { provider, state } = libraryProvider();
  const app = createApp([provider], { auth: authConfig }); t.after(() => app.close());
  for (const url of ['/providers', '/providers/library/graphql', '/providers/library/connection', '/mcp', '/healthz', '/api/me-extra', '/api/missing']) {
    const r = await app.inject({ url, headers: { origin: authConfig.webOrigins[0] } });
    assert.equal(r.statusCode, 403, url);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(state.calls, 0);
  assert.equal((await app.inject('/providers/library/graphql')).statusCode, 200);
});
