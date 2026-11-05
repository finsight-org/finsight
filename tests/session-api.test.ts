import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { authConfig } from './auth-fixtures.js';
import { barrier, credentials, query, sessionFixture } from './session-fixtures.js';
import type { ConnectionRecord } from '../src/connections/model.js';
import type { ConnectionStoreFactory } from '../src/connections/store.js';

function fixture(t: TestContext, enabled = true) {
  const f = sessionFixture(t);
  const records = new Map<string, { owner: string; record: ConnectionRecord }>();
  for (const access of [f.a1, f.a2, f.b1]) records.set(access.binding.connectionId, {
    owner: access.binding.userId,
    record: { id: access.binding.connectionId, providerId: access.binding.providerId, label: null,
      createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' },
  });
  let recordLookups = 0, storeCreations = 0, queueCalls = 0, removed = 0;
  let afterLookup = (_id: string) => {};
  const factory: ConnectionStoreFactory = (identity, signal) => {
    storeCreations++;
    const owned = (id: string) => { signal.throwIfAborted(); const row = records.get(id.toLowerCase()); return row?.owner === identity.user.id ? row.record : null; };
    return {
      async get(id) { recordLookups++; const result = owned(id); afterLookup(id); return result; },
      async remove(id) { removed++; return owned(id) !== null && records.delete(id.toLowerCase()); },
      async list() { return { connections: [], nextCursor: null }; },
      async rename() { return null; }, async create() { throw Error('unused'); },
    };
  };
  for (const method of ['status', 'login', 'graphql', 'disconnect', 'removeRecord'] as const) {
    const original = f.service[method].bind(f.service);
    Object.assign(f.service, { [method]: (...args: unknown[]) => { queueCalls++; return Reflect.apply(original, f.service, args); } });
  }
  const app = createApp([], { auth: authConfig, createConnectionStore: factory,
    connectionSessions: enabled ? f.service : undefined,
    verifyAccessToken: async token => ({ status: 'authenticated', user: { id: token, email: null } }),
  });
  t.after(() => app.close());
  const headers = { authorization: `Bearer ${f.a1.binding.userId}` };
  const url = `/api/connections/${f.a1.binding.connectionId}`;
  return { ...f, app, records, headers, url,
    counters: () => [queueCalls, f.store.loads, f.calls.length],
    recordCounters: () => [storeCreations, recordLookups, removed],
    onLookup(fn: typeof afterLookup) { afterLookup = fn; },
  };
}

test('scoped sessions require auth and owned metadata before service work, including a foreign busy ID', async t => {
  const f = fixture(t);
  assert.equal((await f.app.inject(`${f.url}/session`)).statusCode, 401);
  const gate = barrier();
  f.controls.beforeResponse = async call => { if (call.path === '/token') await gate.wait(); };
  const active = f.app.inject({ method: 'POST', url: `${f.url}/session`, headers: f.headers, payload: credentials() });
  await gate.entered;
  const before = f.counters();
  const denied = await f.app.inject({ url: `${f.url}/session`, headers: { authorization: `Bearer ${f.b1.binding.userId}` } });
  assert.equal(denied.statusCode, 404);
  assert.deepEqual(f.counters().map((v, i) => v - before[i]!), [0, 0, 0]);
  const missing = await f.app.inject({ url: `/api/connections/${crypto.randomUUID()}/session`, headers: f.headers });
  assert.equal(missing.body, denied.body);
  for (const [method, path, payload] of [
    ['POST', '/session', credentials()], ['DELETE', '/session', undefined],
    ['POST', '/graphql', query], ['DELETE', '', undefined],
  ] as const) {
    const r = await f.app.inject({ method, url: f.url + path, payload,
      headers: { authorization: `Bearer ${f.b1.binding.userId}` } });
    assert.equal(r.statusCode, 404);
    assert.deepEqual(f.counters().map((v, i) => v - before[i]!), [0, 0, 0]);
  }
  gate.release();
  assert.equal((await active).statusCode, 200);
});

test('status, login conflict, native GraphQL bytes and disconnect use isolated sessions', async t => {
  const f = fixture(t);
  const send = (method: 'GET' | 'POST' | 'DELETE', path: string, payload?: Record<string, unknown>) => f.app.inject({ method, url: f.url + path, headers: f.headers, payload });
  const status = await send('GET', '/session');
  assert.equal(status.statusCode, 200);
  assert.equal(status.headers['cache-control'], 'no-store');
  assert.deepEqual(status.json(), { status: 'disconnected' });
  assert.equal((await send('POST', '/session', credentials())).statusCode, 200);
  assert.equal((await send('POST', '/session', credentials())).json().error.code, 'CONNECTION_ALREADY_CONNECTED');
  f.controls.queryStatus = 500;
  const native = await send('POST', '/graphql', query);
  assert.equal(native.statusCode, 500);
  assert.equal(native.body, '{"data":{"identityId":"a1@example.test","balance":"765.43","currency":"CAD"}}');
  // Identity fields in authorized native financial results are intentionally preserved.
  assert.equal((await send('DELETE', '/session')).statusCode, 204);
  assert.deepEqual((await send('GET', '/session')).json(), { status: 'disconnected' });
  assert.doesNotMatch(status.body, /password|otp|token|identityId|PASSWORD_SENTINEL/);
});

test('malformed scoped IDs, body and queries never load session storage', async t => {
  const f = fixture(t);
  for (const [method, url, payload] of [
    ['GET', '/api/connections/not-a-uuid/session', undefined],
    ['GET', `${f.url}/session?userId=foreign`, undefined],
    ['DELETE', `${f.url}/session`, { unexpected: true }],
    ['POST', `${f.url}/session`, { ...credentials(), userId: 'foreign' }],
    ['POST', `${f.url}/graphql`, { query: 'mutation { steal }' }],
    ['POST', `${f.url}/graphql`, { query: '{' }],
    ['POST', `${f.url}/graphql?connectionId=foreign`, query],
  ] as const) {
    const r = await f.app.inject({ method, url, payload, headers: f.headers });
    assert.equal(r.statusCode, 400, url);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(f.counters(), [0, 0, 0]);
  for (const [payload, type, status] of [
    ['{', 'application/json', 400], ['x'.repeat(16385), 'application/json', 413], ['x', 'application/unknown', 415],
  ] as const) {
    const r = await f.app.inject({ method: 'POST', url: `${f.url}/session`, headers: { ...f.headers, 'content-type': type }, payload });
    assert.equal(r.statusCode, status);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal((await f.app.inject({ method: 'POST', url: `${f.url}/graphql`, headers: { ...f.headers, 'content-type': 'application/json' }, payload: 'x'.repeat(1024 * 1024 + 1) })).statusCode, 413);
  assert.deepEqual(f.counters(), [0, 0, 0]);
});

test('disabled and unsupported sessions fail safely after ownership checks', async t => {
  const f = fixture(t, false);
  const r = await f.app.inject({ url: `${f.url}/session`, headers: f.headers });
  assert.equal(r.statusCode, 503);
  assert.equal(r.json().error.code, 'SESSION_NOT_CONFIGURED');
  assert.equal((await f.app.inject({ url: `/api/connections/${f.b1.binding.connectionId}/session`, headers: f.headers })).statusCode, 404);
  const g = fixture(t);
  g.records.get(g.a1.binding.connectionId)!.record.providerId = 'removed-provider';
  assert.equal((await g.app.inject({ url: `${g.url}/session`, headers: g.headers })).statusCode, 409);
  assert.deepEqual(g.counters(), [0, 0, 0]);
});

test('ownership is checked again inside the queue and record removal never decrypts', async t => {
  const f = fixture(t);
  f.onLookup(id => f.records.delete(id));
  const r = await f.app.inject({ url: `${f.url}/session`, headers: f.headers });
  assert.equal(r.statusCode, 404);
  assert.deepEqual(f.recordCounters().slice(1), [2, 0]);
  assert.equal(f.store.loads, 0);
  const g = fixture(t);
  const gate = barrier();
  g.controls.beforeResponse = async call => { if (call.path === '/token') await gate.wait(); };
  const active = g.app.inject({ method: 'POST', url: `${g.url}/session`, headers: g.headers, payload: credentials() });
  await gate.entered;
  let completed = false;
  const deletion = g.app.inject({ method: 'DELETE', url: g.url, headers: g.headers }).then(r => { completed = true; return r; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(g.counters()[0], 2);
  assert.equal(g.recordCounters()[2], 0);
  gate.release();
  assert.equal((await active).statusCode, 200);
  assert.equal((await deletion).statusCode, 204);
  assert.equal((await g.app.inject({ url: `${g.url}/session`, headers: g.headers })).statusCode, 404);
  assert.equal(g.store.loads, 1);
});

test('local errors and logger output omit submitted credentials and secret diagnostics', async t => {
  const f = fixture(t);
  let logs = '';
  const stream = (f.app.log as unknown as Record<symbol, { write: (line: string) => void }>)[Object.getOwnPropertySymbols(f.app.log).find(symbol => symbol.description === 'pino.stream')!]!;
  const originalWrite = stream.write;
  stream.write = line => { logs += line; };
  t.after(() => { stream.write = originalWrite; });
  f.controls.beforeResponse = async () => { throw Error('PASSWORD_SENTINEL OTP_SENTINEL TOKEN_SENTINEL KEY_SENTINEL'); };
  f.app.log.info('capture active');
  const response = await f.app.inject({ method: 'POST', url: `${f.url}/session`, headers: f.headers,
    payload: { ...credentials(), otp: '123456' } });
  assert.equal(response.statusCode, 502);
  assert.match(logs, /capture active/);
  assert.doesNotMatch(response.body + logs, /PASSWORD_SENTINEL|OTP_SENTINEL|TOKEN_SENTINEL|KEY_SENTINEL|123456|identityId/);
});


test('app preClose aborts active session work before waiting for the HTTP drain', { timeout: 5000 }, async t => {
  const f = fixture(t);
  let aborted = false;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  f.controls.beforeResponse = async (call, signal) => {
    if (call.path !== '/token') return;
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
      started();
    });
  };
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const pending = fetch(address + f.url + '/session', { method: 'POST',
    headers: { ...f.headers, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(credentials()),
  });
  await ready;
  await f.app.close();
  assert.equal(aborted, true);
  assert.equal((await pending).status, 503);
  assert.equal(f.store.saves, 0);
});


test('mixed-case login uses canonical storage and AAD when the client is restored', async t => {
  const f = fixture(t);
  const upper = `/api/connections/${f.a1.binding.connectionId.toUpperCase()}`;
  assert.notEqual(upper, f.url);
  assert.equal((await f.app.inject({ method: 'POST', url: upper + '/session', headers: f.headers, payload: credentials() })).statusCode, 200);
  // Sweep the original client so a canonical request must decrypt the saved row.
  f.controls.now += 16 * 60 * 1000;
  assert.equal((await f.app.inject({ url: `/api/connections/${f.a2.binding.connectionId}/session`, headers: f.headers })).statusCode, 200);
  const restored = await f.app.inject({ method: 'POST', url: f.url + '/graphql', headers: f.headers, payload: query });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().data.identityId, 'a1@example.test');
});

test('mixed-case disconnect evicts the canonical cached session and prevents later saves', async t => {
  const f = fixture(t);
  assert.equal((await f.app.inject({ method: 'POST', url: f.url + '/session', headers: f.headers, payload: credentials() })).statusCode, 200);
  const upper = `/api/connections/${f.a1.binding.connectionId.toUpperCase()}`;
  assert.equal((await f.app.inject({ method: 'DELETE', url: upper + '/session', headers: f.headers })).statusCode, 204);
  f.controls.queryCookie = 'auth=late; Path=/';
  const result = await f.app.inject({ method: 'POST', url: f.url + '/graphql', headers: f.headers, payload: query });
  assert.equal(result.statusCode, 401);
  assert.equal(f.store.rows.size, 0);
  assert.equal(f.calls.filter(call => call.path === '/graphql').length, 0);
});

test('mixed-case metadata DELETE waits for a canonical in-flight operation', { timeout: 5000 }, async t => {
  const f = fixture(t), gate = barrier();
  t.after(() => gate.release());
  f.controls.beforeResponse = async call => { if (call.path === '/token') await gate.wait(); };
  const active = f.app.inject({ method: 'POST', url: f.url + '/session', headers: f.headers, payload: credentials() });
  await gate.entered;
  let completed = false;
  const deletion = f.app.inject({ method: 'DELETE', url: `/api/connections/${f.a1.binding.connectionId.toUpperCase()}`, headers: f.headers })
    .then(response => { completed = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  const queuedBeforeRelease = f.counters()[0];
  const finishedBeforeRelease = completed;
  const removalsBeforeRelease = f.recordCounters()[2];
  gate.release();
  assert.equal(queuedBeforeRelease, 2);
  assert.equal(finishedBeforeRelease, false);
  assert.equal(removalsBeforeRelease, 0);
  assert.equal((await active).statusCode, 200);
  assert.equal((await deletion).statusCode, 204);
  assert.equal((await f.app.inject({ method: 'POST', url: f.url + '/graphql', headers: f.headers, payload: query })).statusCode, 404);
});

for (const field of ['identity', 'access_token', 'refresh_token'] as const) {
  test('blank provider ' + field + ' returns safe 502 while preserving the connected ciphertext', async t => {
    const f = fixture(t);
    assert.equal((await f.app.inject({ method: 'POST', url: f.url + '/session', headers: f.headers, payload: credentials() })).statusCode, 200);
    const saved = structuredClone(f.store.rows.get(f.a1.binding.connectionId));
    const old = f.snapshot().session;
    if (field === 'identity') f.controls.infoIdentity = ' \t\r\n ';
    else {
      f.controls.rejectAccess.add(old.accessToken);
      f.controls.refreshResponse = { status: 200, body: { access_token: 'NEW_ACCESS_SENTINEL', refresh_token: 'NEW_REFRESH_SENTINEL', [field]: ' \t\r\n ' } };
    }
    const result = await f.app.inject({ url: f.url + '/session', headers: f.headers });
    assert.equal(result.statusCode, 502);
    assert.deepEqual(result.json(), { error: { code: 'WEALTHSIMPLE_UPSTREAM_FAILURE', message: 'Wealthsimple could not complete the request.' } });
    assert.deepEqual(f.store.rows.get(f.a1.binding.connectionId), saved);
    f.controls.infoIdentity = undefined;
    f.controls.refreshResponse = undefined;
    f.controls.rejectAccess.clear();
    assert.deepEqual((await f.app.inject({ url: f.url + '/session', headers: f.headers })).json(), { status: 'connected' });
    assert.deepEqual(f.snapshot().session, old);
    f.controls.now += 16 * 60 * 1000;
    await f.app.inject({ url: `/api/connections/${f.a2.binding.connectionId}/session`, headers: f.headers });
    assert.equal((await f.app.inject({ method: 'POST', url: f.url + '/graphql', headers: f.headers, payload: query })).statusCode, 200);
  });
}
