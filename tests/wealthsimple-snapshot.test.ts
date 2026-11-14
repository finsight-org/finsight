import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WealthsimpleClient } from '../src/providers/wealthsimple/client.js';
import { parseWealthsimpleSnapshot } from '../src/providers/wealthsimple/snapshot.js';
import { assertQueryOnly, graphqlInput, loginInput } from '../src/providers/wealthsimple/validation.js';
import { accountQuery, credentials, deferred, fixture, respond, tokens } from './wealthsimple-fixtures.js';

const signal = () => AbortSignal.timeout(5000);

test('restored snapshot sends the original authentication, cookies and canonical identity', async t => {
  const f = await fixture(t);
  const original = new WealthsimpleClient(f.clientOptions);
  const restored = new WealthsimpleClient(f.clientOptions);
  t.after(() => { original.close(); restored.close(); });
  await original.login({ ...credentials, otp: 'OTP_SENTINEL' }, signal());
  const snapshot = original.exportSnapshot()!;
  assert.equal(snapshot.version, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /PASSWORD_SENTINEL|OTP_SENTINEL/);
  restored.restoreSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(restored.getStatus(), 'connected');
  await restored.graphql({ query: accountQuery, variables: { identityId: 'caller' } }, signal());
  const lastRead = f.calls.at(-1)!;
  assert.equal(lastRead.headers.authorization, 'Bearer ACCESS_SENTINEL');
  assert.match(String(lastRead.headers.cookie), /COOKIE_SENTINEL/);
  assert.equal(lastRead.body.variables.identityId, 'IDENTITY_SENTINEL');
  assert.equal(await restored.validateSession(signal()), 'connected');
  assert.equal(f.calls.filter(call => call.path === '/token').length, 1);
});

test('snapshot is detached from mutable client state', async t => {
  const f = await fixture(t);
  const client = new WealthsimpleClient(f.clientOptions);
  t.after(() => client.close());
  await client.login(credentials, signal());
  const exported = client.exportSnapshot()!;
  const parsed = parseWealthsimpleSnapshot(exported);
  parsed.session.accessToken = 'parser-mutation';
  assert.equal(exported.session.accessToken, 'ACCESS_SENTINEL');
  const restored = new WealthsimpleClient(f.clientOptions);
  t.after(() => restored.close());
  restored.restoreSnapshot(exported);
  exported.session.accessToken = 'caller-mutation';
  exported.cookies!.cookies.length = 0;
  await restored.graphql({ query: accountQuery }, signal());
  assert.equal(f.calls.at(-1)!.headers.authorization, 'Bearer ACCESS_SENTINEL');
  assert.match(String(f.calls.at(-1)!.headers.cookie), /COOKIE_SENTINEL/);
  client.disconnect();
  assert.equal(client.exportSnapshot(), null);
  assert.equal(restored.exportSnapshot()!.session.accessToken, 'ACCESS_SENTINEL');
});

test('snapshot round trip preserves cookies with an empty serialized value', async t => {
  const f = await fixture(t, { '/login': (_call, _req, res) => {
    res.setHeader('set-cookie', ['wssdi=DEVICE_SENTINEL; Path=/', 'empty=; Path=/']);
    res.end('<script src="/assets/app-test.js"></script>');
  } });
  const original = new WealthsimpleClient(f.clientOptions);
  const restored = new WealthsimpleClient(f.clientOptions);
  t.after(() => { original.close(); restored.close(); });
  await original.login(credentials, signal());
  restored.restoreSnapshot(original.exportSnapshot());
  await restored.graphql({ query: accountQuery }, signal());
  assert.match(String(f.calls.at(-1)!.headers.cookie), /empty=/);
});

test('MFA cannot export a connected snapshot', async t => {
  const f = await fixture(t, { '/token': (_call, _req, res) => respond(res, { error: 'otp_required' }, 400) });
  const client = new WealthsimpleClient(f.clientOptions);
  t.after(() => client.close());
  assert.equal(client.exportSnapshot(), null);
  await client.login(credentials, signal());
  assert.equal(client.getStatus(), 'mfa_required');
  assert.equal(client.exportSnapshot(), null);
});

test('incomplete identity lookup cannot export a connected snapshot', async t => {
  const started = deferred(); const release = deferred();
  t.after(() => release.resolve());
  const f = await fixture(t, { '/info': async (_call, _req, res) => {
    started.resolve(); await release.promise; respond(res, { identity_canonical_id: 'IDENTITY_SENTINEL' });
  } });
  const client = new WealthsimpleClient(f.clientOptions);
  t.after(() => client.close());
  const pending = client.login(credentials, signal());
  await started.promise;
  assert.equal(client.exportSnapshot(), null);
  release.resolve(); await pending;
  assert.notEqual(client.exportSnapshot(), null);
});

test('restore rejects extra/invalid fields and broken cookie jars', async t => {
  const f = await fixture(t);
  const client = new WealthsimpleClient(f.clientOptions);
  t.after(() => client.close());
  await client.login(credentials, signal());
  const valid = client.exportSnapshot()!;
  const invalid: unknown[] = [null, [], {}, { ...valid, version: 2 }, { ...valid, extra: 'secret' },
    { ...valid, session: { ...valid.session, password: 'secret' } },
    { ...valid, cookies: {} },
    { ...valid, cookies: { ...valid.cookies, prefixSecurity: ['silent'] } },
    { ...valid, cookies: { ...valid.cookies, cookies: [{ ...valid.cookies!.cookies[0], sameSite: ['lax'] }] } }, { ...valid, cookies: { ...valid.cookies, cookies: 'broken' } },
    { ...valid, cookies: { ...valid.cookies, cookies: [null] } },
    { ...valid, cookies: { ...valid.cookies, cookies: [{}] } },
    { ...valid, cookies: { ...valid.cookies, cookies: [{ key: 42, value: 'bad', domain: '127.0.0.1', path: '/' }] } },
  ];
  for (const key of Object.keys(valid.session)) {
    invalid.push({ ...valid, session: { ...valid.session, [key]: '' } });
    invalid.push({ ...valid, session: { ...valid.session, [key]: 42 } });
  }
  for (const value of invalid) {
    assert.throws(() => parseWealthsimpleSnapshot(value), { code: 'WEALTHSIMPLE_INVALID_REQUEST' });
    assert.throws(() => client.restoreSnapshot(value), { code: 'WEALTHSIMPLE_INVALID_REQUEST' });
  }
  // Rejected restore does not damage an already working connection.
  await client.graphql({ query: accountQuery }, signal());
  assert.equal(f.calls.at(-1)!.headers.authorization, 'Bearer ACCESS_SENTINEL');
});

test('info 401 refreshes once and persists rotated tokens', async t => {
  let expired = false;
  const f = await fixture(t, {
    '/info': (call, _req, res) => expired && call.headers.authorization === 'Bearer ACCESS_SENTINEL'
      ? respond(res, {}, 401) : respond(res, { identity_canonical_id: 'IDENTITY_SENTINEL' }),
    '/token': (call, _req, res) => respond(res, call.body.grant_type === 'password' ? tokens :
      { access_token: 'ROTATED_ACCESS', refresh_token: 'ROTATED_REFRESH' }),
  });
  const client = new WealthsimpleClient(f.clientOptions);
  t.after(() => client.close());
  await client.login(credentials, signal());
  expired = true;
  assert.equal(await client.validateSession(signal()), 'connected');
  assert.equal(client.exportSnapshot()!.session.accessToken, 'ROTATED_ACCESS');
  assert.equal(client.exportSnapshot()!.session.refreshToken, 'ROTATED_REFRESH');
  assert.equal(f.calls.filter(call => call.path === '/info').length, 3);
  assert.equal(f.calls.filter(call => call.path === '/token' && call.body.grant_type === 'refresh_token').length, 1);
});

test('terminal token-info rejection expires and clears snapshot after one refresh', async t => {
  for (const refreshRejected of [true, false]) await t.test(String(refreshRejected), async t => {
    let expired = false;
    const f = await fixture(t, {
      '/info': (_call, _req, res) => expired ? respond(res, {}, 401) : respond(res, { identity_canonical_id: 'IDENTITY_SENTINEL' }),
      '/token': (call, _req, res) => call.body.grant_type === 'password' ? respond(res, tokens) :
        respond(res, refreshRejected ? { error: 'invalid_grant' } : tokens, refreshRejected ? 400 : 200),
    });
    const terminallyRejected = new WealthsimpleClient(f.clientOptions);
    t.after(() => terminallyRejected.close());
    await terminallyRejected.login(credentials, signal());
    expired = true;
    assert.equal(await terminallyRejected.validateSession(signal()), 'expired');
    assert.equal(terminallyRejected.exportSnapshot(), null);
    assert.equal(await terminallyRejected.validateSession(signal()), 'expired');
    assert.equal(f.calls.filter(call => call.path === '/token').length, 2);
    assert.equal(f.calls.filter(call => call.path === '/info').length, refreshRejected ? 2 : 3);
  });
});

test('temporary token-info and refresh failures preserve snapshot', async t => {
  for (const duringRefresh of [false, true]) await t.test(String(duringRefresh), async t => {
    let unavailable = false;
    const f = await fixture(t, {
      '/info': (_call, _req, res) => unavailable ? respond(res, {}, duringRefresh ? 401 : 503) :
        respond(res, { identity_canonical_id: 'IDENTITY_SENTINEL' }),
      '/token': (call, _req, res) => respond(res, tokens, call.body.grant_type === 'password' ? 200 : 503),
    });
    const temporarilyUnavailable = new WealthsimpleClient(f.clientOptions);
    t.after(() => temporarilyUnavailable.close());
    await temporarilyUnavailable.login(credentials, signal());
    unavailable = true;
    await assert.rejects(temporarilyUnavailable.validateSession(signal()), { code: 'WEALTHSIMPLE_UPSTREAM_FAILURE' });
    assert.notEqual(temporarilyUnavailable.exportSnapshot(), null);
    unavailable = false;
    assert.equal(await temporarilyUnavailable.validateSession(signal()), 'connected');
  });
});

test('identity mismatch expires', async t => {
  let mismatch = false;
  const f = await fixture(t, { '/info': (_call, _req, res) => respond(res, {
    identity_canonical_id: mismatch ? 'OTHER_IDENTITY' : 'IDENTITY_SENTINEL',
  }) });
  const client = new WealthsimpleClient(f.clientOptions);
  t.after(() => client.close());
  await client.login(credentials, signal()); mismatch = true;
  assert.equal(await client.validateSession(signal()), 'expired');
  assert.equal(client.exportSnapshot(), null);
  await assert.rejects(client.graphql({ query: accountQuery }, signal()), { code: 'WEALTHSIMPLE_NOT_CONNECTED' });
});

test('abortUpstream preserves completed session material', { timeout: 5000 }, async t => {
  const started = deferred();
  const f = await fixture(t, { '/graphql': () => { started.resolve(); } });
  const client = new WealthsimpleClient(f.clientOptions);
  t.after(() => client.close());
  await client.login(credentials, signal());
  const pending = client.graphql({ query: accountQuery }, signal());
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started.promise;
  client.abortUpstream(); await rejected;
  assert.equal(client.exportSnapshot()!.session.accessToken, 'ACCESS_SENTINEL');
  assert.match(JSON.stringify(client.exportSnapshot()!.cookies), /COOKIE_SENTINEL/);
  client.close();
  assert.equal(client.exportSnapshot(), null);
});

test('login/token-info 5xx is an upstream failure', async t => {
  for (const path of ['/token', '/info']) await t.test(path, async t => {
    const f = await fixture(t, { [path]: (_call, _req, res) => respond(res, { error: 'invalid_grant' }, 503) });
    const client = new WealthsimpleClient(f.clientOptions);
    t.after(() => client.close());
    await assert.rejects(client.login(credentials, signal()), { code: 'WEALTHSIMPLE_UPSTREAM_FAILURE' });
    assert.equal(client.exportSnapshot(), null);
  });
});

test('shared request validation preserves credential checks and guards mixed documents', () => {
  assert.equal(loginInput({ ...credentials, email: ' person@example.test ' }).email, 'person@example.test');
  for (const value of [null, [], {}, { ...credentials, otp: 'secret' }, { ...credentials, endpoints: {} }]) {
    assert.throws(() => loginInput(value), { code: 'WEALTHSIMPLE_INVALID_REQUEST' });
  }
  for (const operation of ['mutation', 'subscription']) {
    const input = graphqlInput({ query: `query Read { anything } ${operation} Write { anything }`, operationName: 'Read' });
    assert.throws(() => assertQueryOnly(input.query), { code: 'WEALTHSIMPLE_INVALID_REQUEST' });
  }
  assert.doesNotThrow(() => assertQueryOnly(graphqlInput({ query: accountQuery }).query));
  assert.throws(() => assertQueryOnly('{'), { code: 'WEALTHSIMPLE_INVALID_REQUEST' });
  assert.throws(() => graphqlInput({ query: 42 }), { code: 'WEALTHSIMPLE_INVALID_REQUEST' });
});
