import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Kind, parse } from 'graphql';
import { createApp, MAX_REQUEST_BODY_SIZE } from '../src/app.js';
import { wealthsimpleProvider } from '../src/providers/wealthsimple/index.js';
import { WealthsimpleClient } from '../src/providers/wealthsimple/client.js';
import { libraryProvider } from './fixtures.js';
import { accountQuery, credentials, deferred, endpoint, fixture, graphql, page, respond, tokens } from './wealthsimple-fixtures.js';

const secret = /PASSWORD_SENTINEL|ACCESS_SENTINEL|REFRESH_SENTINEL|COOKIE_SENTINEL|DEVICE_SENTINEL|IDENTITY_SENTINEL|UPSTREAM_SECRET/;
function code(response: { json(): any }, expected: string) {
  assert.equal(response.json().error.code, `WEALTHSIMPLE_${expected}`);
}

test('discovery and connection instructions need no upstream and expose all nine reference documents', async t => {
  const f = await fixture(t);
  const catalog = (await f.app.inject('/providers')).json().providers;
  assert.deepEqual(catalog, [f.provider.metadata]);
  const status = await f.app.inject(endpoint);
  assert.equal(status.json().status, 'disconnected');
  assert.deepEqual(status.json().instructions.completeMfa.required, ['email', 'password', 'otp']);
  const docs = await f.app.inject(`${graphql}?query=mutation%20%7B%20anything%20%7D`);
  assert.match(docs.json().description, /introspection is disabled/);
  assert.equal(docs.headers['cache-control'], 'no-store');
  assert.equal(docs.headers['access-control-allow-origin'], undefined);
  const references = docs.json().references as { file: string; query: string }[];
  assert.deepEqual(references.map(reference => reference.file), [
    'account-details.graphql', 'accounts.graphql', 'activities.graphql', 'income.graphql',
    'performance-history.graphql', 'portfolio.graphql', 'positions.graphql',
    'security-research.graphql', 'security-search.graphql',
  ]);
  assert.ok(references.length <= 10);
  const operationNames = new Set<string>();
  for (const reference of references) {
    assert.equal(reference.query, await readFile(new URL(`../src/providers/wealthsimple/reference/${reference.file}`, import.meta.url), 'utf8'));
    const document = parse(reference.query);
    const operations = document.definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION);
    assert.ok(operations.length >= 1);
    for (const operation of operations) {
      assert.equal(operation.operation, 'query');
      assert.ok(operation.name);
      assert.ok(!operationNames.has(operation.name.value));
      operationNames.add(operation.name.value);
    }
    assert.match(reference.query, /Independently reconstructed and live tested through FinSight/);
  }
  assert.ok(operationNames.has('PortfolioSnapshot'));
  assert.ok(operationNames.has('InvestmentPerformance'));
  code(await f.query(), 'NOT_CONNECTED');
  assert.equal(f.calls.length, 0);
  assert.doesNotMatch(status.body + docs.body, secret);
  for (const url of ['/graphql', '/accounts', '/providers/wealthsimple/accounts']) {
    assert.equal((await f.app.inject(url)).statusCode, 404);
  }
});

test('connect, cache canonical identity, reuse session, forward native data and disconnect', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.login()).json(), { status: 'connected' });
  const login = f.calls.find(call => call.path === '/token')!;
  assert.deepEqual(login.body, {
    grant_type: 'password', username: credentials.email, password: credentials.password, skip_provision: 'true',
    scope: 'invest.read trade.read tax.read', client_id: 'fixture-client', otp_claim: null,
  });
  assert.equal(login.headers.authorization, undefined);
  assert.equal(login.headers['x-ws-device-id'], 'DEVICE_SENTINEL');
  assert.equal(login.headers['x-ws-profile'], 'undefined');
  assert.match(String(login.headers['x-ws-session-id']), /^[a-f0-9-]{36}$/);
  assert.deepEqual((await f.query()).json(), page());
  assert.deepEqual((await f.query({ first: 500, after: 'cursor +/=' })).json(), page());
  assert.equal(f.calls.filter(call => call.path === '/info').length, 1);
  const reads = f.calls.filter(call => call.path === '/graphql');
  assert.equal(reads[0].body.query, accountQuery);
  assert.deepEqual(reads[1].body.variables, { first: 500, after: 'cursor +/=', identityId: 'IDENTITY_SENTINEL' });
  assert.equal(reads[0].headers['x-ws-api-version'], '12');
  assert.equal(reads[0].headers['x-ws-profile'], 'trade');
  assert.equal(reads[0].headers['x-ws-locale'], 'en-CA');
  assert.equal(reads[0].headers['x-platform-os'], 'web');
  assert.equal(reads[0].headers['x-ws-session-id'], login.headers['x-ws-session-id']);
  assert.equal(reads[0].headers.authorization, `Bearer ${tokens.access_token}`);
  assert.doesNotMatch((await f.app.inject(endpoint)).body, secret);
  assert.deepEqual((await f.login()).json(), { status: 'connected' });
  assert.equal((await f.app.inject({ method: 'DELETE', url: endpoint })).statusCode, 204);
  code(await f.query(), 'NOT_CONNECTED');
  assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
  await f.login();
  const logins = f.calls.filter(call => call.path === '/login');
  assert.equal(logins.length, 2);
  assert.equal(logins[1].headers.cookie, undefined);
});

test('OTP repeats credential login without attempts, timers or another bootstrap', async t => {
  const f = await fixture(t, { '/token': (call, _req, res) => {
    if (!call.headers['x-wealthsimple-otp']) return respond(res, { error: 'invalid_grant' }, 400);
    assert.equal(call.headers['x-wealthsimple-otp'], '123456;remember=true');
    respond(res, tokens);
  } });
  assert.deepEqual((await f.login()).json(), { status: 'mfa_required' });
  assert.equal((await f.app.inject(endpoint)).json().status, 'mfa_required');
  assert.deepEqual((await f.login({ ...credentials, otp: '123456' })).json(), { status: 'connected' });
  assert.equal(f.calls.filter(call => call.path === '/login').length, 1);
  const logins = f.calls.filter(call => call.path === '/token');
  assert.equal(logins[0].headers['x-ws-session-id'], logins[1].headers['x-ws-session-id']);
});

test('OTP may be supplied initially; a rejected OTP clears the session', async t => {
  const first = await fixture(t);
  assert.equal((await first.login({ ...credentials, otp: '654321' })).json().status, 'connected');
  assert.equal(first.calls.find(call => call.path === '/token')!.headers['x-wealthsimple-otp'], '654321;remember=true');
  const second = await fixture(t, { '/token': (_call, _req, res) => respond(res, { error: 'invalid_grant' }, 400) });
  assert.equal((await second.login()).json().status, 'mfa_required');
  code(await second.login({ ...credentials, otp: '111111' }), 'LOGIN_FAILED');
  assert.equal((await second.app.inject(endpoint)).json().status, 'disconnected');
});

test('connection payload errors and obsolete attempt IDs never disclose submitted values', async t => {
  const f = await fixture(t);
  for (const payload of [
    {}, [], { ...credentials, attemptId: 'obsolete' }, { ...credentials, scope: 'trade.write' },
    { ...credentials, otp: 'UPSTREAM_SECRET' }, { ...credentials, email: '' }, { ...credentials, password: '' },
    { ...credentials, password: 'PASSWORD_SENTINEL'.repeat(2000) },
  ]) {
    const response = await f.login(payload);
    assert.equal(response.statusCode, 400);
    assert.doesNotMatch(response.body, secret);
  }
  const malformed = await f.app.inject({ method: 'POST', url: endpoint, headers: { 'content-type': 'application/json' }, payload: '{"password":"PASSWORD_SENTINEL"' });
  assert.equal(malformed.statusCode, 400);
  assert.doesNotMatch(malformed.body, secret);
  assert.equal(f.calls.length, 0);
});

test('identity lookup must succeed before reporting connected', async t => {
  const f = await fixture(t, { '/info': (_call, _req, res) => respond(res, {}) });
  code(await f.login(), 'UPSTREAM_FAILURE');
  assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
  code(await f.query(), 'NOT_CONNECTED');
});

test('the only document guard rejects syntax errors and every non-query definition', async t => {
  const f = await fixture(t);
  for (const payload of [
    { query: 'mutation { anything }' }, { query: 'subscription { anything }' },
    { query: 'query Read { anything } mutation Write { anything }', operationName: 'Read' },
    { query: 'query Read { anything } subscription Watch { anything }', operationName: 'Read' },
    { query: '{' }, { query: '' },
  ]) {
    const response = await f.app.inject({ method: 'POST', url: graphql, payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.message, payload.query.includes('mutation') || payload.query.includes('subscription')
      ? 'Only GraphQL queries are allowed' : 'Invalid GraphQL syntax.');
  }
  assert.equal(f.calls.length, 0);
});

test('envelope validation rejects invalid shapes, batches, multipart and oversized bodies', async t => {
  const f = await fixture(t);
  for (const payload of [[], {}, { query: 1 }, { query: '{ anything }', variables: [] },
    { query: '{ anything }', variables: 'invalid' }, { query: '{ anything }', operationName: 123 }]) {
    assert.equal((await f.app.inject({ method: 'POST', url: graphql, payload })).statusCode, 400);
  }
  for (const [payload, contentType] of [['null', 'application/json'], ['{}', 'multipart/form-data']]) {
    assert.equal((await f.app.inject({ method: 'POST', url: graphql, payload, headers: { 'content-type': contentType } })).statusCode, 400);
  }
  const large = await f.app.inject({ method: 'POST', url: graphql, payload: { query: 'x'.repeat(MAX_REQUEST_BODY_SIZE) } });
  assert.equal(large.statusCode, 400);
  assert.doesNotMatch(large.body, /xxx/);
  assert.equal(f.calls.length, 0);
});

test('arbitrary raw queries and all graph semantics are forwarded for upstream validation', async t => {
  const upstream = { errors: [{ message: 'Wealthsimple schema hint', locations: [{ line: 1, column: 3 }], extensions: { code: 'GRAPHQL_VALIDATION_FAILED', detail: 'preserved' } }] };
  const f = await fixture(t, { '/graphql': (_call, _req, res) => respond(res, upstream, 400) });
  await f.login();
  const payloads = [
    { query: '{ unknownField(unknownArgument: true) }' },
    { query: 'query Custom($bad: Int!) { alias: unknownField(value: $bad) }', operationName: 'Custom', variables: { bad: 'not an int' } },
    { query: '{ anything { ...MissingFragment } }' },
    { query: 'query A { anything } query B { otherThing }' },
    { query: 'query A { anything }', operationName: 'NotPresent' },
    { query: '{ anything { ... @defer { otherThing } } }' },
    { query: '{ anything @stream(initialCount: 1) }' },
    { query: 'fragment OnlyFragment on UnknownType { field }' },
    { query: 'query Aliases { one: anything { ...Fields } two: anything { ...Fields } } fragment Fields on UnknownType { field }' },
    { query: '# mutation subscription\n{ anything(value: "mutation subscription") }', variables: null, operationName: null },
  ];
  for (const payload of payloads) {
    const response = await f.app.inject({ method: 'POST', url: graphql, payload });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), upstream);
    const sent = f.calls.at(-1)!;
    assert.equal(sent.path, '/graphql');
    assert.equal(sent.body.query, payload.query);
    assert.equal(sent.body.operationName, payload.operationName);
    assert.deepEqual(sent.body.variables, { ...payload.variables, identityId: 'IDENTITY_SENTINEL' });
  }
});

test('connected identity replaces caller identity without rewriting literals or other variables', async t => {
  const f = await fixture(t);
  await f.login();
  const query = 'query Custom($identityId: ID!, $other: ID!) { identity(id: $identityId) { id } literal: identity(id: "literal") { id } another: identity(id: $other) { id } }';
  await f.app.inject({ method: 'POST', url: graphql, payload: { query, operationName: 'Custom', variables: { identityId: 'caller', other: 'caller-other', condition: { arbitrary: true } } } });
  assert.equal(f.calls.at(-1)!.body.query, query);
  assert.deepEqual(f.calls.at(-1)!.body.variables, { identityId: 'IDENTITY_SENTINEL', other: 'caller-other', condition: { arbitrary: true } });
});

test('native partial data, errors, extensions, status and JSON bytes are preserved', async t => {
  const body = '{ "data": { "anything": null, "nested": [1,1,2] }, "errors": [{ "message": "schema hint", "path": ["anything"], "locations": [{"line":1,"column":3}], "extensions": {"custom":true} }], "extensions": {"upstream":true} }\n';
  const f = await fixture(t, { '/graphql': (_call, _req, res) => { res.writeHead(422, { 'content-type': 'application/json' }); res.end(body); } });
  await f.login();
  const response = await f.query();
  assert.equal(response.statusCode, 422);
  assert.equal(response.body, body);
  assert.deepEqual(response.json(), JSON.parse(body));
  assert.equal(f.calls.filter(call => call.path === '/graphql').length, 1);
});

test('HTTP and GraphQL authentication errors rotate both tokens and retry the same request once', async t => {
  for (const kind of ['http', 'graphql', 'message']) await t.test(kind, async t => {
    let refreshes = 0;
    let expiredAccess = tokens.access_token;
    const f = await fixture(t, {
      '/token': (call, _req, res) => {
        if (call.body.grant_type === 'password') return respond(res, tokens);
        assert.equal(call.body.refresh_token, refreshes ? 'refresh-rotated' : tokens.refresh_token);
        assert.equal(call.headers.authorization, undefined);
        assert.equal(call.headers['x-ws-profile'], 'invest');
        refreshes++;
        respond(res, { access_token: `rotated-${refreshes}`, refresh_token: 'refresh-rotated' });
      },
      '/graphql': (call, _req, res) => {
        if (refreshes && call.headers.authorization !== `Bearer ${expiredAccess}`) return respond(res, page());
        if (kind === 'http') respond(res, {}, 401);
        else if (kind === 'graphql') respond(res, { errors: [{ message: 'Expired', extensions: { code: 'UNAUTHENTICATED' } }] });
        else respond(res, { message: 'Not Authorized.' });
      },
    });
    await f.login();
    assert.deepEqual((await f.query({ first: 7, after: 'retry +/cursor=' })).json(), page());
    assert.equal(refreshes, 1);
    const reads = f.calls.filter(call => call.path === '/graphql');
    assert.equal(reads.length, 2);
    assert.deepEqual(reads[0].body, reads[1].body);
    // A later expiry must refresh with the rotated refresh token, not the original.
    expiredAccess = 'rotated-1';
    assert.deepEqual((await f.query()).json(), page());
    assert.equal(refreshes, 2);
    assert.equal(f.calls.filter(call => call.path === '/graphql').length, 4);
    assert.equal(f.calls.at(-1)!.headers.authorization, 'Bearer rotated-2');
  });
});

test('concurrent expired reads share one token rotation', async t => {
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
  for (const response of results) assert.deepEqual(response.json(), page());
  assert.equal(refreshes, 1);
});

test('a late stale authentication response reuses the token another reader refreshed', async t => {
  const slow = deferred(); const release = deferred();
  let reads = 0; let refreshes = 0;
  const f = await fixture(t, {
    '/token': (call, _req, res) => {
      if (call.body.grant_type === 'password') return respond(res, tokens);
      refreshes++; respond(res, { access_token: 'rotated', refresh_token: 'rotated-refresh' });
    },
    '/graphql': async (call, _req, res) => {
      if (call.headers.authorization !== `Bearer ${tokens.access_token}`) return respond(res, page());
      if (++reads === 1) { slow.resolve(); await release.promise; }
      respond(res, {}, 401);
    },
  });
  await f.login();
  const first = f.query();
  await slow.promise;
  assert.deepEqual((await f.query()).json(), page());
  release.resolve();
  assert.deepEqual((await first).json(), page());
  assert.equal(refreshes, 1);
});

test('refresh rejection or second unauthorized response clears authentication and bounds retries', async t => {
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
    code(await f.query(), 'NOT_CONNECTED');
    assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
    const count = f.calls.length;
    code(await f.query(), 'NOT_CONNECTED');
    assert.equal(f.calls.length, count);
    assert.equal(refreshes, 1);
    assert.equal(reads, rejected ? 1 : 2);
  });
});

test('a rejected refresh requires login even when its response is not JSON', async t => {
  const f = await fixture(t, {
    '/token': (call, _req, res) => {
      if (call.body.grant_type === 'password') return respond(res, tokens);
      res.writeHead(401); res.end('Authentication rejected');
    },
    '/graphql': (_call, _req, res) => respond(res, {}, 401),
  });
  await f.login();
  const response = await f.query();
  assert.equal(response.statusCode, 401);
  code(response, 'NOT_CONNECTED');
  assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
});

test('connection remains unavailable until identity lookup completes', async t => {
  const started = deferred(); const release = deferred();
  const f = await fixture(t, {
    '/info': async (_call, _req, res) => {
      started.resolve(); await release.promise;
      respond(res, { identity_canonical_id: 'IDENTITY_SENTINEL' });
    },
  });
  const login = f.login();
  await started.promise;
  assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
  code(await f.query(), 'NOT_CONNECTED');
  release.resolve();
  assert.deepEqual((await login).json(), { status: 'connected' });
  assert.equal(f.calls.filter(call => call.path === '/info').length, 1);
  assert.equal(f.calls.filter(call => call.path === '/token').length, 1);
});

test('non-GraphQL upstream failures are safe and never cause refresh', async t => {
  for (const [status, body, expected] of [
    [403, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'], [429, '<html>UPSTREAM_SECRET</html>', 'UPSTREAM_FAILURE'],
    [503, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'], [200, '{invalid UPSTREAM_SECRET', 'UPSTREAM_FAILURE'],
  ] as const) await t.test(`${status} ${expected}`, async t => {
    const f = await fixture(t, { '/graphql': (_call, _req, res) => { res.writeHead(status); res.end(body); } });
    await f.login();
    const response = await f.query();
    code(response, expected);
    assert.doesNotMatch(response.body, secret);
    assert.equal(f.calls.filter(call => call.path === '/token').length, 1);
    assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
  });
});

test('non-authentication refresh failures preserve the session without recursive retries', async t => {
  for (const [status, body, expected] of [
    [429, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'], [503, 'UPSTREAM_SECRET', 'UPSTREAM_FAILURE'],
    [200, '{}', 'UPSTREAM_FAILURE'],
  ] as const) await t.test(`${status} ${expected}`, async t => {
    let expired = true;
    const f = await fixture(t, {
      '/token': (call, _req, res) => {
        if (call.body.grant_type === 'password') respond(res, tokens);
        else { res.writeHead(status); res.end(body); }
      },
      '/graphql': (_call, _req, res) => expired ? respond(res, {}, 401) : respond(res, page()),
    });
    await f.login();
    const response = await f.query();
    code(response, expected);
    assert.doesNotMatch(response.body, secret);
    assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
    assert.equal(f.calls.filter(call => call.path === '/token').length, 2);
    expired = false;
    assert.deepEqual((await f.query()).json(), page());
  });
});

test('HTTP caller abort cancels login and GraphQL requests', { timeout: 5000 }, async t => {
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
    assert.equal((await f.app.inject(endpoint)).json().status, login ? 'disconnected' : 'connected');
  });
});

test('cancelling one reader leaves the shared refresh available to another', { timeout: 5000 }, async t => {
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
  const second = f.query();
  await secondStale.promise;
  controller.abort();
  await first;
  release.resolve();
  assert.deepEqual((await second).json(), page());
  assert.equal(refreshes, 1);
});

test('an aborted caller is not retried after a shared refresh completes', async t => {
  const started = deferred(); const release = deferred();
  const client = new WealthsimpleClient({ fetch: async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/app/login') {
      const response = new Response('<script src="/assets/app-test.js"></script>', {
        headers: { 'set-cookie': 'wssdi=device; Secure; Path=/' },
      });
      Object.defineProperty(response, 'url', { value: String(url) });
      return response;
    }
    if (path === '/assets/app-test.js') return new Response('config={environment:"production",clientId:"fixture"}');
    if (path.endsWith('/token/info')) return Response.json({ identity_canonical_id: 'identity' });
    if (path.endsWith('/token')) {
      if (JSON.parse(String(init?.body)).grant_type === 'password') return Response.json(tokens);
      started.resolve(); await release.promise;
      return Response.json({ access_token: 'rotated', refresh_token: 'rotated-refresh' });
    }
    return Response.json({}, { status: 401 });
  } });
  t.after(() => { release.resolve(); client.disconnect(); });
  await client.login(credentials, new AbortController().signal);
  const controller = new AbortController();
  const request = client.graphql({ query: '{ anything }' }, controller.signal);
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await started.promise;
  controller.abort();
  release.resolve();
  await rejected;
  assert.equal(client.getStatus(), 'connected');
});

test('app instances and unrelated providers remain independent', async t => {
  const first = await fixture(t); const second = await fixture(t);
  await first.login();
  code(await second.query(), 'NOT_CONNECTED');
  assert.equal(second.calls.length, 0);
  const app = createApp([wealthsimpleProvider(), libraryProvider().provider]);
  t.after(() => app.close());
  assert.equal((await app.inject('/providers/library/books')).statusCode, 200);
  assert.equal((await app.inject(endpoint)).json().status, 'disconnected');
  assert.equal((await app.inject('/providers/library/connection')).statusCode, 404);
});

test('unknown errors, malformed input and credentials stay out of real process logs', async () => {
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
    await fetch(address + '${graphql}?query=' + encodeURIComponent('{ UPSTREAM_SECRET }'));
    console.log(await (await fetch(address + '${graphql}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"UPSTREAM_SECRET"' })).text());
    await app.close();
  `], { timeout: 5000 });
  assert.doesNotMatch(stdout + stderr, secret);
  assert.match(stdout, /WEALTHSIMPLE_UPSTREAM_FAILURE/);
  assert.match(stdout, /WEALTHSIMPLE_INVALID_REQUEST/);
});
