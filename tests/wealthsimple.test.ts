import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getIntrospectionQuery } from 'graphql';
import { createApp } from '../src/app.js';
import { wealthsimpleProvider, type Clock } from '../src/providers/wealthsimple/index.js';
import { libraryProvider } from './fixtures.js';
import { accountQuery, credentials, deferred, endpoint, fixture, graphql, page, respond, tokens } from './wealthsimple-fixtures.js';

const secret = /PASSWORD_SENTINEL|ACCESS_SENTINEL|REFRESH_SENTINEL|COOKIE_SENTINEL|DEVICE_SENTINEL|IDENTITY_SENTINEL|UPSTREAM_SECRET/;
function code(response: { json(): any }, expected: string) {
  const body = response.json();
  assert.equal(body.error?.code ?? body.errors?.[0]?.extensions?.code, `WEALTHSIMPLE_${expected}`);
}

test('Wealthsimple discovery, disconnected introspection and control instructions need no upstream', async t => {
  const f = await fixture(t);
  const catalog = (await f.app.inject('/providers')).json().providers;
  assert.deepEqual(catalog, [{ id: 'wealthsimple', name: 'Wealthsimple', description: 'Read Wealthsimple account metadata.', graphqlEndpoint: graphql, connectionEndpoint: endpoint }]);
  const introspection = await f.app.inject({ method: 'POST', url: graphql, payload: { query: getIntrospectionQuery() } });
  const schema = introspection.json().data.__schema;
  assert.equal(schema.mutationType, null);
  assert.equal(schema.subscriptionType, null);
  assert.deepEqual(schema.types.find((x: any) => x.name === 'WealthsimpleAccount').fields.map((x: any) => x.name), ['id', 'nickname', 'unifiedAccountType', 'currency', 'status']);
  const accounts = schema.types.find((x: any) => x.name === 'Query').fields.find((x: any) => x.name === 'accounts');
  assert.equal(accounts.type.name, 'WealthsimpleAccountConnection');
  assert.deepEqual(accounts.args.map((arg: any) => [arg.name, arg.defaultValue]), [['first', '25'], ['after', null]]);
  assert.match(accounts.description, /One account page/);
  assert.deepEqual(schema.types.find((x: any) => x.name === 'WealthsimpleAccountConnection').fields.map((x: any) => x.name), ['edges', 'pageInfo']);
  assert.deepEqual(schema.types.find((x: any) => x.name === 'WealthsimpleAccountEdge').fields.map((x: any) => x.name), ['node']);
  assert.deepEqual(schema.types.find((x: any) => x.name === 'WealthsimpleAccountPageInfo').fields.map((x: any) => x.name), ['hasNextPage', 'endCursor']);
  const status = await f.app.inject(endpoint);
  assert.equal(status.json().status, 'disconnected');
  assert.deepEqual(status.json().instructions.login.required, ['email', 'password']);
  assert.equal(status.headers['cache-control'], 'no-store');
  code(await f.query(), 'NOT_CONNECTED');
  assert.equal(f.calls.length, 0);
});

test('real HTTP upstream: connect, query complete metadata, reuse session, and disconnect', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.login()).json(), { status: 'connected' });
  for (let i = 0; i < 2; i++) {
    const response = await f.query();
    assert.deepEqual(response.json(), { data: { accounts: page().data.identity.accounts } });
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.doesNotMatch(response.body, secret);
  }
  assert.equal(f.calls.filter(c => c.path === '/token').length, 1);
  const token = f.calls.find(c => c.path === '/token')!;
  assert.equal(token.body.grant_type, 'password');
  assert.equal(token.body.scope, 'invest.read trade.read tax.read');
  assert.equal(token.headers.authorization, undefined);
  assert.equal(token.headers['x-ws-device-id'], 'DEVICE_SENTINEL');
  assert.match(token.headers.cookie!, /session_cookie=COOKIE_SENTINEL/);
  const read = f.calls.find(c => c.path === '/graphql')!;
  assert.equal(read.body.variables.identityId, 'IDENTITY_SENTINEL');
  assert.match(read.body.query, /accounts\(filter: \{\}, first: \$first, after: \$after\)/);
  assert.equal(read.body.variables.first, 25);
  assert.equal(read.body.variables.after, null);
  assert.doesNotMatch(read.body.query, /financials|netWorth|accountOwners/);
  assert.equal(read.headers['x-ws-api-version'], '12');
  assert.equal((await f.login()).statusCode, 409);
  assert.equal((await f.app.inject({ method: 'DELETE', url: endpoint })).statusCode, 204);
  code(await f.query(), 'NOT_CONNECTED');
  assert.deepEqual((await f.login()).json(), { status: 'connected' });
});

test('OTP challenge binds an attempt, hides state, and reuses bootstrap exactly once', async t => {
  const f = await fixture(t, { '/token': (call, _req, res) => {
    if (!call.headers['x-wealthsimple-otp']) respond(res, { error: 'invalid_grant', error_description: 'UPSTREAM_SECRET' }, 400);
    else { assert.equal(call.headers['x-wealthsimple-otp'], '123456;remember=true'); respond(res, tokens); }
  } });
  const challenge = (await f.login()).json();
  assert.equal(challenge.status, 'mfa_required');
  assert.ok(challenge.attemptId);
  const status = await f.app.inject(endpoint);
  assert.equal(status.json().status, 'mfa_required');
  assert.ok(!status.body.includes(challenge.attemptId));
  assert.doesNotMatch(status.body, secret);
  code(await f.login(), 'CONNECTION_CONFLICT');
  code(await f.login({ ...credentials, attemptId: challenge.attemptId, otp: '123456', email: 'wrong@example.test' }), 'CONNECTION_CONFLICT');
  assert.deepEqual((await f.login({ ...credentials, attemptId: challenge.attemptId, otp: '123456' })).json(), { status: 'connected' });
  assert.equal(f.calls.filter(c => c.path === '/login').length, 1);
});

test('OTP expiry, rejection, and cancellation consume pending attempts', async t => {
  let now = 0;
  let expiry: (() => void) | undefined;
  const clock: Clock = { now: () => now, schedule: callback => { expiry = callback; return () => { expiry = undefined; }; } };
  const f = await fixture(t, { '/token': (_call, _req, res) => respond(res, { error: 'invalid_grant', error_description: 'UPSTREAM_SECRET' }, 400) }, { clock });
  const first = (await f.login()).json();
  now = 300_001; expiry!();
  code(await f.login({ ...credentials, attemptId: first.attemptId, otp: '123456' }), 'CONNECTION_CONFLICT');
  const second = (await f.login()).json();
  const rejected = await f.login({ ...credentials, attemptId: second.attemptId, otp: '123456' });
  code(rejected, 'LOGIN_FAILED');
  assert.equal(rejected.statusCode, 401);
  assert.doesNotMatch(rejected.body, secret);
  code(await f.login({ ...credentials, attemptId: second.attemptId, otp: '123456' }), 'CONNECTION_CONFLICT');
  await f.login();
  await f.app.inject({ method: 'DELETE', url: endpoint });
  assert.equal(expiry, undefined);
});

test('connection validation, parse errors and oversized bodies never disclose submitted data', async t => {
  const f = await fixture(t);
  for (const payload of [{ ...credentials, otp: '123456' }, { ...credentials, attemptId: 'id' }, { ...credentials, extra: 'UPSTREAM_SECRET' }, { email: 'x', password: 123 }, { ...credentials, attemptId: 'id', otp: '123\r\n456' }]) {
    const response = await f.login(payload);
    assert.equal(response.statusCode, 400);
    assert.doesNotMatch(response.body, secret);
  }
  for (const payload of ['{"password":"UPSTREAM_SECRET"', JSON.stringify({ ...credentials, password: 'PASSWORD_SENTINEL'.repeat(2000) })]) {
    const response = await f.app.inject({ method: 'POST', url: endpoint, headers: { 'content-type': 'application/json' }, payload });
    assert.equal(response.statusCode, 400);
    assert.doesNotMatch(response.body, secret);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(f.calls.length, 0);
});

test('identity lookup must complete before reporting connected', async t => {
  const f = await fixture(t, { '/info': (_call, _req, res) => respond(res, { identity_canonical_id: null, message: 'UPSTREAM_SECRET' }) });
  const response = await f.login();
  code(response, 'INVALID_RESPONSE');
  assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
  code(await f.query(), 'NOT_CONNECTED');
});

test('clients request pages explicitly; edge order and duplicate IDs are preserved', async t => {
  const firstNodes = [
    { id: 'b', nickname: null, status: 'closed', unifiedAccountType: 'future-type' },
    { id: 'a', status: 'archived' }, { id: 'b', nickname: 'Duplicate' },
  ];
  const f = await fixture(t, { '/graphql': (call, _req, res) => respond(res,
    call.body.variables.after === null ? page(firstNodes, true, 'next') : page([{ id: 'c' }])) });
  await f.login();
  const first = (await f.query()).json();
  assert.deepEqual(first, { data: { accounts: {
    edges: [
      { node: { id: 'b', nickname: null, status: 'closed', unifiedAccountType: 'future-type', currency: null } },
      { node: { id: 'a', nickname: null, status: 'archived', unifiedAccountType: null, currency: null } },
      { node: { id: 'b', nickname: 'Duplicate', status: null, unifiedAccountType: null, currency: null } },
    ], pageInfo: { hasNextPage: true, endCursor: 'next' },
  } } });
  assert.equal(f.calls.filter(c => c.path === '/graphql').length, 1);
  const second = (await f.query({ first: 10, after: first.data.accounts.pageInfo.endCursor })).json();
  assert.deepEqual(second.data.accounts.edges.map((edge: any) => edge.node.id), ['c']);
  assert.deepEqual(second.data.accounts.pageInfo, { hasNextPage: false, endCursor: null });
  assert.deepEqual(f.calls.filter(c => c.path === '/graphql').map(c => [c.body.variables.first, c.body.variables.after]), [[25, null], [10, 'next']]);
});

test('empty pages succeed; malformed envelopes and upstream errors fail the field safely', async t => {
  for (const [name, body, expected] of [
    ['empty', page([]), null],
    ['missing identity', { data: { identity: null } }, 'INVALID_RESPONSE'],
    ['missing edges', { data: { identity: { accounts: { pageInfo: { hasNextPage: false } } } } }, 'INVALID_RESPONSE'],
    ['missing page info', { data: { identity: { accounts: { edges: [] } } } }, 'INVALID_RESPONSE'],
    ['bad page flag', { data: { identity: { accounts: { edges: [], pageInfo: { hasNextPage: 'yes' } } } } }, 'INVALID_RESPONSE'],
    ['missing cursor', page([{ id: 'a' }], true, null), 'INVALID_RESPONSE'],
    ['empty continuation cursor', page([], true, ''), 'INVALID_RESPONSE'],
    ['invalid cursor', page([], false, 3), 'INVALID_RESPONSE'],
    ['partial upstream', { ...page(), errors: [{ message: 'UPSTREAM_SECRET' }] }, 'UPSTREAM_FAILURE'],
  ] as const) {
    await t.test(name, async t => {
      const f = await fixture(t, { '/graphql': (_call, _req, res) => respond(res, body) });
      await f.login();
      const response = await f.query();
      if (expected) { code(response, expected); assert.equal(response.json().data.accounts, null); }
      else assert.deepEqual(response.json(), { data: { accounts: page([]).data.identity.accounts } });
      assert.doesNotMatch(response.body, secret);
    });
  }
});

test('later client page failures do not invalidate earlier responses', async t => {
  const f = await fixture(t, { '/graphql': (call, _req, res) => {
    if (call.body.variables.after !== null) respond(res, { message: 'UPSTREAM_SECRET' }, 503);
    else respond(res, page([{ id: 'a' }], true, 'next'));
  } });
  await f.login();
  const first = await f.query();
  const before = first.body;
  const second = await f.query({ after: 'next' });
  code(second, 'UPSTREAM_FAILURE');
  assert.equal(second.json().data.accounts, null);
  assert.equal(first.body, before);
  assert.equal(first.json().data.accounts.edges[0].node.id, 'a');
  assert.equal(f.calls.filter(c => c.path === '/graphql').length, 2);
});

test('page sizes are bounded before upstream calls; valid cursors are passed unchanged', async t => {
  const f = await fixture(t);
  await f.login();
  const callsBefore = f.calls.length;
  for (const first of [0, -1, 101]) code(await f.query({ first }), 'INVALID_PAGINATION');
  for (const first of [null, 1.5]) {
    const response = await f.query({ first });
    assert.ok(response.json().errors.length);
    assert.equal(response.json().data, undefined);
  }
  assert.equal(f.calls.length, callsBefore);
  for (const first of [1, 100]) {
    assert.ok((await f.query({ first, after: 'opaque +/cursor=' })).json().data.accounts);
    const read = f.calls.at(-1)!;
    assert.deepEqual(read.body.variables, { identityId: 'IDENTITY_SENTINEL', first, after: 'opaque +/cursor=' });
  }
  await f.query({ after: null });
  assert.equal(f.calls.at(-1)!.body.variables.after, null);
});

test('aliases, fragments and variables execute through the paginated local schema', async t => {
  const f = await fixture(t);
  await f.login();
  const response = await f.app.inject({ method: 'POST', url: graphql, payload: {
    query: `query Read($size: Int!, $cursor: String) {
      chosen: accounts(first: $size, after: $cursor) {
        edges { node { ...Details } }
        continuation: pageInfo { hasNextPage endCursor }
      }
    } fragment Details on WealthsimpleAccount { identifier: id nickname }`,
    variables: { size: 7, cursor: 'chosen-cursor' }, operationName: 'Read',
  } });
  assert.deepEqual(response.json(), { data: { chosen: {
    edges: [{ node: { identifier: 'a', nickname: 'Savings' } }],
    continuation: { hasNextPage: false, endCursor: null },
  } } });
  assert.equal(f.calls.at(-1)!.body.variables.first, 7);
  assert.equal(f.calls.at(-1)!.body.variables.after, 'chosen-cursor');
  assert.equal(f.calls.filter(c => c.path === '/graphql').length, 1);
});

test('cursor progress belongs to the caller, with no tracking between requests', async t => {
  const f = await fixture(t, { '/graphql': (_call, _req, res) => respond(res, page([], true, 'same')) });
  await f.login();
  for (let i = 0; i < 2; i++) {
    const response = await f.query({ after: 'same' });
    assert.deepEqual(response.json(), { data: { accounts: page([], true, 'same').data.identity.accounts } });
  }
  assert.equal(f.calls.filter(c => c.path === '/graphql').length, 2);
});

test('nested completion errors obey nullability without leaking upstream values', async t => {
  for (const [name, node, fieldNullable] of [
    ['missing id', {}, false], ['null node', null, false],
    ['invalid id', { id: { detail: 'UPSTREAM_SECRET' } }, false],
    ['invalid nickname', { id: 'a', nickname: { detail: 'UPSTREAM_SECRET' } }, true],
  ] as const) await t.test(name, async t => {
    const f = await fixture(t, { '/graphql': (_call, _req, res) => respond(res, page([node])) });
    await f.login();
    const response = await f.query();
    const body = response.json();
    assert.ok(body.errors.length);
    assert.equal(body.errors[0].message, 'Unexpected error.');
    if (fieldNullable) {
      assert.equal(body.data.accounts.edges[0].node.nickname, null);
      assert.deepEqual(body.errors[0].path, ['accounts', 'edges', 0, 'node', 'nickname']);
    } else assert.equal(body.data.accounts, null);
    assert.doesNotMatch(response.body, secret);
  });
});

test('HTTP and GraphQL authentication errors refresh once and rotate both tokens', async t => {
  for (const kind of ['http', 'graphql', 'message']) await t.test(kind, async t => {
    let refreshes = 0;
    const f = await fixture(t, {
      '/token': (call, _req, res) => {
        if (call.body.grant_type === 'password') return respond(res, tokens);
        assert.equal(call.body.refresh_token, refreshes ? 'refresh-rotated' : tokens.refresh_token);
        assert.equal(call.headers.authorization, undefined);
        refreshes++;
        respond(res, { access_token: `rotated-${refreshes}`, refresh_token: 'refresh-rotated' });
      },
      '/graphql': (call, _req, res) => {
        if (call.headers.authorization === `Bearer rotated-${refreshes}` && refreshes) return respond(res, page());
        if (kind === 'http') respond(res, {}, 401);
        else if (kind === 'graphql') respond(res, { errors: [{ message: 'UPSTREAM_SECRET', extensions: { code: 'UNAUTHENTICATED' } }] });
        else respond(res, { message: 'Not Authorized.' });
      },
    });
    await f.login();
    assert.ok((await f.query({ first: 7, after: 'retry +/cursor=' })).json().data.accounts);
    assert.equal(refreshes, 1);
    const reads = f.calls.filter(call => call.path === '/graphql');
    assert.equal(reads.length, 2);
    for (const read of reads) {
      assert.deepEqual(read.body.variables, { identityId: 'IDENTITY_SENTINEL', first: 7, after: 'retry +/cursor=' });
    }
  });
});

test('concurrent expired reads share one refresh rotation', async t => {
  let stale = 0; let refreshes = 0;
  const ready = deferred();
  const f = await fixture(t, {
    '/token': (call, _req, res) => {
      if (call.body.grant_type === 'password') return respond(res, tokens);
      refreshes++; respond(res, { access_token: 'rotated', refresh_token: 'rotated-refresh' });
    },
    '/graphql': async (call, _req, res) => {
      if (call.headers.authorization === `Bearer ${tokens.access_token}`) {
        if (++stale === 4) ready.resolve();
        await ready.promise;
        respond(res, {}, 401);
      } else respond(res, page());
    },
  });
  await f.login();
  const results = await Promise.all(Array.from({ length: 4 }, () => f.query()));
  for (const response of results) assert.ok(response.json().data.accounts);
  assert.equal(refreshes, 1);
});

test('refresh rejection or a second unauthorized read requires reconnect and no further calls', async t => {
  for (const rejected of [true, false]) await t.test(String(rejected), async t => {
    let refreshes = 0; let reads = 0;
    const f = await fixture(t, {
      '/token': (call, _req, res) => {
        if (call.body.grant_type === 'password') return respond(res, tokens);
        refreshes++;
        if (rejected) respond(res, { error: 'invalid_grant' }, 400);
        else respond(res, { access_token: 'rotated', refresh_token: 'rotated-refresh' });
      },
      '/graphql': (_call, _req, res) => { reads++; respond(res, {}, 401); },
    });
    await f.login();
    code(await f.query(), 'RECONNECT_REQUIRED');
    assert.equal((await f.app.inject(endpoint)).json().status, 'reconnect_required');
    const count = f.calls.length;
    code(await f.query(), 'RECONNECT_REQUIRED');
    assert.equal(f.calls.length, count);
    assert.equal(refreshes, 1);
    assert.equal(reads, rejected ? 1 : 2);
  });
});

test('non-authentication failures never trigger refresh and preserve safe errors', async t => {
  for (const [status, body, expected] of [
    [403, '{}', 'UPSTREAM_FAILURE'], [429, '<html>Cloudflare UPSTREAM_SECRET</html>', 'RATE_LIMITED'],
    [503, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'], [200, '<html>UPSTREAM_SECRET</html>', 'INVALID_RESPONSE'],
    [200, '{invalid UPSTREAM_SECRET', 'INVALID_RESPONSE'],
  ] as const) await t.test(String(status) + body.slice(0, 8), async t => {
    const f = await fixture(t, { '/graphql': (_call, _req, res) => { res.writeHead(status); res.end(body); } });
    await f.login();
    const response = await f.query();
    code(response, expected);
    assert.doesNotMatch(response.body, secret);
    assert.equal(f.calls.filter(c => c.path === '/token').length, 1);
  });
});

test('login operation deadlines cancel upstream and clear state', { timeout: 5000 }, async t => {
  const cancelled = deferred();
  const f = await fixture(t, { '/token': (_call, _req, res) => { res.once('close', () => cancelled.resolve()); } }, { operationTimeoutMs: 40 });
  const response = await f.login();
  code(response, 'TIMEOUT');
  await cancelled.promise;
  assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
});

test('overlapping login is rejected and disconnect prevents stale login completion', async t => {
  const started = deferred(); const release = deferred();
  const f = await fixture(t, { '/token': async (_call, _req, res) => { started.resolve(); await release.promise; respond(res, tokens); } });
  const pending = f.login();
  const running = pending.then(x => x);
  await started.promise;
  assert.equal((await f.app.inject(endpoint)).json().status, 'connecting');
  code(await f.login(), 'CONNECTION_CONFLICT');
  await f.app.inject({ method: 'DELETE', url: endpoint });
  release.resolve();
  code(await running, 'CONNECTION_CONFLICT');
  assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
});

test('real client disconnect aborts login and account requests', { timeout: 5000 }, async t => {
  for (const login of [true, false]) await t.test(String(login), async t => {
    const started = deferred(); const cancelled = deferred();
    const f = await fixture(t, { [login ? '/token' : '/graphql']: (_call, _req, res) => {
      res.once('close', () => cancelled.resolve()); started.resolve();
    } });
    if (!login) await f.login();
    const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const request = fetch(address + (login ? endpoint : graphql), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(login ? credentials : { query: accountQuery }), signal: controller.signal,
    }).catch(error => error);
    await started.promise;
    controller.abort();
    await request;
    await cancelled.promise;
    if (login) assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
    assert.equal(f.calls.filter(c => c.path === '/graphql').length, login ? 0 : 1);
  });
});

test('shutdown cancels pending provider work before waiting for requests', { timeout: 5000 }, async t => {
  const started = deferred(); const cancelled = deferred();
  const f = await fixture(t, { '/graphql': (_call, _req, res) => { res.once('close', () => cancelled.resolve()); started.resolve(); } });
  await f.login();
  const request = f.query().then(response => response);
  await started.promise;
  await f.app.close();
  await cancelled.promise;
  assert.equal((await request).json().data.accounts, null);
});

test('connections are isolated across app instances and unrelated providers stay independent', async t => {
  const first = await fixture(t); const second = await fixture(t);
  await first.login();
  code(await second.query(), 'NOT_CONNECTED');
  assert.equal(second.calls.length, 0);
  const app = createApp([wealthsimpleProvider(), libraryProvider().provider]);
  t.after(() => app.close());
  const catalog = (await app.inject('/providers')).json().providers;
  assert.equal(catalog[0].connectionEndpoint, undefined);
  assert.equal((await app.inject('/providers/library/connection')).statusCode, 404);
  assert.equal((await app.inject('/graphql')).statusCode, 404);
});

test('cancelling one reader does not cancel a refresh needed by another', { timeout: 5000 }, async t => {
  const refreshStarted = deferred(); const secondStale = deferred(); const release = deferred();
  let stale = 0; let refreshes = 0;
  const f = await fixture(t, {
    '/token': async (call, _req, res) => {
      if (call.body.grant_type === 'password') return respond(res, tokens);
      refreshes++; refreshStarted.resolve(); await release.promise;
      respond(res, { access_token: 'rotated', refresh_token: 'rotated-refresh' });
    },
    '/graphql': (call, _req, res) => {
      if (call.headers.authorization === `Bearer ${tokens.access_token}`) {
        if (++stale === 2) secondStale.resolve();
        respond(res, {}, 401);
      } else respond(res, page());
    },
  });
  await f.login();
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const first = fetch(address + graphql, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: accountQuery }), signal: controller.signal }).catch(error => error);
  await refreshStarted.promise;
  const second = f.query().then(response => response);
  await secondStale.promise;
  controller.abort();
  await first;
  release.resolve();
  assert.ok((await second).json().data.accounts);
  assert.equal(refreshes, 1);
  assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
});

test('disconnect and shutdown abort refresh and cannot revive an old session', { timeout: 5000 }, async t => {
  for (const shutdown of [false, true]) await t.test(String(shutdown), async t => {
    const started = deferred(); const cancelled = deferred();
    let refreshed = false;
    const f = await fixture(t, {
      '/token': (call, _req, res) => {
        if (call.body.grant_type === 'password') return respond(res, tokens);
        res.once('close', () => cancelled.resolve()); started.resolve();
      },
      '/graphql': (_call, _req, res) => { if (refreshed) respond(res, page()); else respond(res, {}, 401); },
    });
    await f.login();
    const read = f.query().then(response => response);
    await started.promise;
    if (shutdown) await f.app.close();
    else await f.app.inject({ method: 'DELETE', url: endpoint });
    await cancelled.promise;
    assert.equal((await read).json().data.accounts, null);
    if (!shutdown) {
      refreshed = true;
      await f.login();
      assert.ok((await f.query()).json().data.accounts);
    }
  });
});

test('read and upstream request timeouts preserve the established connection', { timeout: 5000 }, async t => {
  for (const options of [{ requestTimeoutMs: 40 }, { operationTimeoutMs: 40 }]) await t.test(JSON.stringify(options), async t => {
    let stall = true;
    const f = await fixture(t, { '/graphql': (_call, _req, res) => { if (!stall) respond(res, page()); } }, options);
    await f.login();
    code(await f.query(), 'TIMEOUT');
    assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
    stall = false;
    assert.ok((await f.query()).json().data.accounts);
  });
});

test('bootstrap and token failures are safe, and token requests are never retried', async t => {
  for (const [path, status, body, expected] of [
    ['/login', 429, 'Cloudflare error 1015 UPSTREAM_SECRET', 'RATE_LIMITED'],
    ['/login', 200, '<html>UPSTREAM_SECRET</html>', 'INVALID_RESPONSE'],
    ['/token', 403, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'],
    ['/token', 429, 'UPSTREAM_SECRET', 'RATE_LIMITED'],
    ['/token', 503, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'],
    ['/token', 200, '{}', 'INVALID_RESPONSE'],
    ['/token', 400, '{"error":"invalid_client","error_description":"UPSTREAM_SECRET"}', 'LOGIN_FAILED'],
  ] as const) await t.test(`${path} ${status} ${expected}`, async t => {
    const f = await fixture(t, { [path]: (_call, _req, res) => { res.writeHead(status); res.end(body); } });
    const response = await f.login();
    code(response, expected);
    assert.doesNotMatch(response.body, secret);
    assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
    assert.ok(f.calls.filter(c => c.path === '/token').length <= 1);
  });
});

test('unknown provider exceptions and submitted secrets are absent from real process logs', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { createApp } from './src/app.ts';
    import { wealthsimpleProvider } from './src/providers/wealthsimple/index.ts';
    const app = createApp([wealthsimpleProvider({ fetch: async () => { throw new Error('UPSTREAM_SECRET'); } })]);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    for (const body of [JSON.stringify({ email: 'person@example.test', password: 'PASSWORD_SENTINEL' }), '{"password":"PASSWORD_SENTINEL"']) {
      const response = await fetch(address + '${endpoint}', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      console.log(await response.text());
    }
    const response = await fetch(address + '${graphql}?query=' + encodeURIComponent('{ UPSTREAM_SECRET }'));
    await response.text();
    await app.close();
  `], { timeout: 5000 });
  assert.doesNotMatch(stdout + stderr, secret);
  assert.match(stdout, /WEALTHSIMPLE_UPSTREAM_FAILURE/);
  assert.match(stdout, /WEALTHSIMPLE_INVALID_REQUEST/);
});

test('a rejected shared refresh remains visible after its only reader cancels', { timeout: 5000 }, async t => {
  const started = deferred(); const release = deferred();
  const f = await fixture(t, {
    '/token': async (call, _req, res) => {
      if (call.body.grant_type === 'password') return respond(res, tokens);
      started.resolve(); await release.promise; respond(res, { error: 'invalid_grant' }, 400);
    },
    '/graphql': (_call, _req, res) => respond(res, {}, 401),
  });
  await f.login();
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const read = fetch(address + graphql, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: accountQuery }), signal: controller.signal }).catch(error => error);
  await started.promise;
  controller.abort();
  await read;
  release.resolve();
  const { setTimeout: delay } = await import('node:timers/promises');
  let status = 'connected';
  for (let i = 0; i < 100 && status === 'connected'; i++) {
    status = (await f.app.inject(endpoint)).json().status;
    if (status === 'connected') await delay(5);
  }
  assert.equal(status, 'reconnect_required');
  code(await f.query(), 'RECONNECT_REQUIRED');
});

test('delayed old-session responses cannot change a replacement connection', { timeout: 5000 }, async t => {
  for (const operation of ['login', 'refresh', 'read']) await t.test(operation, async t => {
    const started = deferred(); const release = deferred();
    t.after(() => release.resolve());
    let held = false;
    let logins = 0;
    const f = await fixture(t, {
      '/token': (call, _req, res) => {
        if (call.body.grant_type === 'password') {
          logins++;
          respond(res, { access_token: `access-${logins}`, refresh_token: `refresh-${logins}` });
        } else respond(res, { access_token: 'stale-rotation', refresh_token: 'stale-refresh' });
      },
      '/graphql': (call, _req, res) => {
        if (operation === 'refresh' && call.headers.authorization === 'Bearer access-1') {
          respond(res, {}, 401);
        } else respond(res, page([{ id: call.headers.authorization }]));
      },
    }, {
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        const path = new URL(String(input)).pathname;
        const grant = init?.body ? JSON.parse(String(init.body)).grant_type : undefined;
        const hold = operation === 'read' ? path === '/graphql' :
          path === '/token' && grant === (operation === 'login' ? 'password' : 'refresh_token');
        if (held || !hold) return response;
        held = true;
        // Deliver a completed upstream response late, even though its signal was aborted.
        const body = await response.text();
        started.resolve();
        await release.promise;
        return new Response(body, { status: response.status, headers: response.headers });
      },
    });
    if (operation !== 'login') await f.login();
    const oldRequest = (operation === 'login' ? f.login() : f.query()).then(response => response);
    await started.promise;
    await f.app.inject({ method: 'DELETE', url: endpoint });
    assert.equal((await f.login()).json().status, 'connected');
    release.resolve();
    code(await oldRequest, operation === 'login' ? 'CONNECTION_CONFLICT' : 'CANCELLED');
    const accounts = (await f.query()).json().data.accounts;
    assert.equal(accounts.edges[0].node.id, 'Bearer access-2');
    assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
  });
});

test('identity lookup preserves one refresh and retry before connecting', async t => {
  for (const outcome of ['http', 'message', 'refresh rejected', 'retry rejected']) await t.test(outcome, async t => {
    let refreshes = 0;
    let identityReads = 0;
    const f = await fixture(t, {
      '/token': (call, _req, res) => {
        if (call.body.grant_type === 'password') return respond(res, tokens);
        refreshes++;
        assert.equal(call.headers.authorization, undefined);
        assert.equal(call.body.refresh_token, tokens.refresh_token);
        if (outcome === 'refresh rejected') return respond(res, { error: 'invalid_grant' }, 400);
        respond(res, { access_token: 'identity-rotated', refresh_token: 'identity-refresh' });
      },
      '/info': (call, _req, res) => {
        identityReads++;
        if (call.headers.authorization === `Bearer ${tokens.access_token}` || outcome === 'retry rejected') {
          if (outcome === 'message') respond(res, { message: 'Not Authorized.' });
          else respond(res, {}, 401);
        } else {
          assert.equal(call.headers.authorization, 'Bearer identity-rotated');
          respond(res, { identity_canonical_id: 'IDENTITY_SENTINEL' });
        }
      },
    });
    const response = await f.login();
    if (outcome.endsWith('rejected')) {
      code(response, 'RECONNECT_REQUIRED');
      assert.equal(response.statusCode, 401);
      assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
      code(await f.query(), 'NOT_CONNECTED');
    } else {
      assert.equal(response.json().status, 'connected');
      assert.ok((await f.query()).json().data.accounts);
      const read = f.calls.find(call => call.path === '/graphql');
      assert.equal(read?.headers.authorization, 'Bearer identity-rotated');
      assert.equal(read?.body.variables.identityId, 'IDENTITY_SENTINEL');
    }
    assert.equal(refreshes, 1);
    assert.equal(identityReads, outcome === 'refresh rejected' ? 1 : 2);
    assert.equal(f.calls.filter(call => call.body.grant_type === 'password').length, 1);
  });
});

test('a late authentication rejection reuses the token another reader already refreshed', { timeout: 5000 }, async t => {
  const delayed = deferred(); const release = deferred();
  t.after(() => release.resolve());
  let staleReads = 0;
  let refreshes = 0;
  const f = await fixture(t, {
    '/token': (call, _req, res) => {
      if (call.body.grant_type === 'password') return respond(res, tokens);
      refreshes++;
      respond(res, { access_token: 'rotated', refresh_token: 'rotated-refresh' });
    },
    '/graphql': async (call, _req, res) => {
      if (call.headers.authorization === `Bearer ${tokens.access_token}`) {
        if (++staleReads === 1) { delayed.resolve(); await release.promise; }
        respond(res, {}, 401);
      } else {
        assert.equal(call.headers.authorization, 'Bearer rotated');
        respond(res, page());
      }
    },
  });
  await f.login();
  const first = f.query({ first: 3, after: 'delayed-page' }).then(response => response);
  await delayed.promise;
  assert.ok((await f.query({ first: 7, after: 'other-page' })).json().data.accounts);
  release.resolve();
  assert.ok((await first).json().data.accounts);
  assert.equal(refreshes, 1);
  const reads = f.calls.filter(call => call.path === '/graphql');
  assert.equal(reads.length, 4);
  for (const [cursor, size] of [['delayed-page', 3], ['other-page', 7]] as const) {
    const attempts = reads.filter(call => call.body.variables.after === cursor);
    assert.equal(attempts.length, 2);
    for (const attempt of attempts) assert.equal(attempt.body.variables.first, size);
  }
});

test('non-authentication refresh failures preserve the session without recursive retries', async t => {
  for (const [status, body, expected] of [
    [403, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'],
    [429, '<html>UPSTREAM_SECRET</html>', 'RATE_LIMITED'],
    [503, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'],
    [200, '<html>UPSTREAM_SECRET</html>', 'INVALID_RESPONSE'],
    [200, '{invalid UPSTREAM_SECRET', 'INVALID_RESPONSE'],
    [200, '{"access_token":"incomplete-rotation"}', 'INVALID_RESPONSE'],
  ] as const) await t.test(`${status} ${expected} ${body.slice(0, 16)}`, async t => {
    let recover = false;
    let refreshes = 0;
    const f = await fixture(t, {
      '/token': (call, _req, res) => {
        if (call.body.grant_type === 'password') return respond(res, tokens);
        refreshes++;
        assert.equal(call.body.refresh_token, tokens.refresh_token);
        assert.equal(call.headers.authorization, undefined);
        if (recover) respond(res, { access_token: 'rotated', refresh_token: 'rotated-refresh' });
        else { res.writeHead(status); res.end(body); }
      },
      '/graphql': (call, _req, res) => {
        if (call.headers.authorization === 'Bearer rotated') respond(res, page());
        else {
          assert.equal(call.headers.authorization, `Bearer ${tokens.access_token}`);
          respond(res, {}, 401);
        }
      },
    });
    await f.login();
    const response = await f.query();
    code(response, expected);
    assert.doesNotMatch(response.body, secret);
    assert.equal(refreshes, 1);
    assert.equal(f.calls.filter(call => call.path === '/graphql').length, 1);
    assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
    recover = true;
    assert.ok((await f.query()).json().data.accounts);
    assert.equal(refreshes, 2);
    assert.equal(f.calls.filter(call => call.body.grant_type === 'password').length, 1);
  });
});
