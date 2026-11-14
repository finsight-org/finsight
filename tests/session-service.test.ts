import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, credentials, query, sessionFixture } from './session-fixtures.js';

test('independent identities and cookies restore, with encrypted storage and native financial results', async t => {
  const f = sessionFixture(t);
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'disconnected' });
  const accounts = [[f.a1, 'first'], [f.a2, 'second'], [f.b1, 'third']] as const;
  for (const [record, owner] of accounts) {
    assert.deepEqual(await f.service.login(record, credentials(owner), f.signal), { status: 'connected' });
  }
  assert.doesNotMatch(JSON.stringify([...f.store.rows.values()]), /ACCESS_SENTINEL|REFRESH_SENTINEL|COOKIE_SENTINEL|PASSWORD_SENTINEL/);
  await f.restart();
  for (const [record, owner] of accounts) {
    const result = await f.service.graphql(record, query, f.signal);
    assert.deepEqual(JSON.parse(result.text), { data: { identityId: owner, balance: '765.43', currency: 'CAD' } });
    const call = f.calls.at(-1)!;
    assert.ok(call.bearer.startsWith('ACCESS_SENTINEL-' + owner));
    assert.ok(call.cookies.includes('auth=COOKIE_SENTINEL-' + owner));
    assert.equal(f.calls.at(-2)!.path, '/info');
  }
  await f.service.disconnect(f.a1, f.signal);
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'disconnected' });
  assert.equal((await f.service.graphql(f.a2, query, f.signal)).status, 200);
});

test('connected login validates first, including on outage, and unchanged material avoids writes', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  await assert.rejects(f.service.login(f.a1, credentials('replacement'), f.signal),
    { code: 'CONNECTION_ALREADY_CONNECTED', statusCode: 409 });
  assert.equal(f.calls.at(-1)!.path, '/info');
  f.controls.infoOutage = true;
  for (const op of [() => f.service.status(f.a1, f.signal), () => f.service.login(f.a1, credentials(), f.signal)]) {
    await assert.rejects(op(), { statusCode: 502 });
  }
  assert.equal(f.passwordGrants(), 1);
  f.controls.infoOutage = false;
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'connected' });
  f.controls.queryStatus = 503;
  assert.deepEqual(await f.service.graphql(f.a1, query, f.signal), { status: 503,
    text: '{"data":{"identityId":"a1@example.test","balance":"765.43","currency":"CAD"}}' });
  assert.equal(f.store.saves, 1);
});

test('restoration retries provider validation after an outage before querying', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  await f.restart();
  f.controls.infoOutage = true;
  await assert.rejects(f.service.graphql(f.a1, query, f.signal), { statusCode: 502 });
  await assert.rejects(f.service.graphql(f.a1, query, f.signal), { statusCode: 502 });
  assert.equal(f.calls.filter(call => call.path === '/graphql').length, 0);
  f.controls.infoOutage = false;
  assert.equal((await f.service.graphql(f.a1, query, f.signal)).status, 200);
  assert.equal(f.store.saves, 1);
});

test('expired marker survives MFA/restart and failed login, and OTP is isolated by record', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  f.controls.rejectAccess.add(f.snapshot().session.accessToken);
  f.controls.rejectRefresh = true;
  f.controls.requireOtp = true;
  assert.deepEqual(await f.service.login(f.a1, credentials(), f.signal), { status: 'mfa_required' });
  assert.deepEqual(f.store.rows.get(f.a1.binding.connectionId), { state: 'expired', envelope: null });
  assert.deepEqual(await f.service.status(f.a2, f.signal), { status: 'disconnected' });
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'mfa_required' });
  const firstDevice = f.calls.at(-1)!.device;
  await f.service.login(f.a2, credentials('second'), f.signal);
  assert.notEqual(f.calls.at(-1)!.device, firstDevice);
  await f.service.login(f.a1, { ...credentials(), otp: 'OTP_SENTINEL' }, f.signal);
  assert.equal(f.snapshot().session.deviceId, firstDevice);
  assert.doesNotMatch(JSON.stringify(f.snapshot()), /PASSWORD_SENTINEL|OTP_SENTINEL/);
  f.controls.rejectAccess.add(f.snapshot().session.accessToken);
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'expired' });
  await assert.rejects(f.service.graphql(f.a1, query, f.signal), { code: 'WEALTHSIMPLE_NOT_CONNECTED' });
  await f.service.login(f.a1, credentials(), f.signal);
  await f.restart();
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'expired' });
  assert.deepEqual(await f.service.status(f.a2, f.signal), { status: 'disconnected' });
  await assert.rejects(f.service.login(f.a1, { ...credentials(), password: 'bad' }, f.signal), { code: 'WEALTHSIMPLE_LOGIN_FAILED' });
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'expired' });
  assert.deepEqual(await f.service.login(f.a1, { ...credentials(), otp: 'OTP_SENTINEL' }, f.signal), { status: 'connected' });
});

test('rotated tokens and cookie changes survive a restart', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  const old = f.snapshot().session;
  f.controls.rejectAccess.add(old.accessToken);
  f.controls.queryCookie = 'auth=ROTATED; Path=/; Secure';
  await f.service.graphql(f.a1, query, f.signal);
  const rotated = f.snapshot().session;
  assert.notEqual(rotated.refreshToken, old.refreshToken);
  f.controls.queryCookie = '';
  await f.restart();
  await f.service.graphql(f.a1, query, f.signal);
  assert.equal(f.calls.at(-1)!.bearer, rotated.accessToken);
  assert.match(f.calls.at(-1)!.cookies, /auth=ROTATED/);
  assert.equal(f.store.saves, 2);
});

for (const fault of ['payload version', 'envelope version', 'foreign binding'] as const) {
  test('unreadable ' + fault + ' fails safely before client construction and allows disconnect', async t => {
    const f = sessionFixture(t);
    await f.service.login(f.a1, credentials(), f.signal);
    const snapshot = f.snapshot(), row = f.store.rows.get(f.a1.binding.connectionId)!;
    assert.equal(row.state, 'connected');
    if (fault === 'payload version') row.envelope = f.cipher.encrypt(f.a1.binding, JSON.stringify({ ...snapshot, version: 2 }));
    if (fault === 'envelope version') Object.assign(row.envelope, { version: 2 });
    if (fault === 'foreign binding') row.envelope = f.cipher.encrypt(f.b1.binding, JSON.stringify(snapshot));
    await f.restart();
    await assert.rejects(f.service.status(f.a1, f.signal), { statusCode: 503 });
    assert.equal(f.store.saves, 1);
    assert.equal(f.controls.clients, 1);
    await f.service.disconnect(f.a1, f.signal);
    assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'disconnected' });
  });
}

test('unsupported provider live requests fail closed while record deletion supports it', async t => {
  const f = sessionFixture(t), historical = access(undefined, 'historical');
  await assert.rejects(f.service.status(historical, f.signal), { code: 'CONNECTION_PROVIDER_UNSUPPORTED', statusCode: 409 });
  assert.equal(await f.service.removeRecord(historical, async () => false, f.signal), false);
  assert.equal(f.store.loads, 0);
});

test('cached session cannot serve a different trusted binding', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  const mismatched = { ...f.a1, binding: { ...f.a1.binding, userId: f.b1.binding.userId } };
  await assert.rejects(f.service.graphql(mismatched, query, f.signal), { statusCode: 503 });
  assert.equal(f.calls.filter(call => call.path === '/graphql').length, 0);
});

test('malformed provider identity on a saved session yields safe upstream error and retains its state', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  f.controls.malformedInfo = true;
  await assert.rejects(f.service.status(f.a1, f.signal), { code: 'WEALTHSIMPLE_UPSTREAM_FAILURE', statusCode: 502 });
  assert.equal(f.store.saves, 1);
  f.controls.malformedInfo = false;
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'connected' });
});

for (const [status, body] of [
  [400, 'malformed upstream response'],
  [400, { error: 'invalid_request' }],
  [200, { error: 'temporarily_unavailable' }],
] as const) {
  test('ambiguous refresh failure preserves durable credentials: ' + status + ' ' + JSON.stringify(body), async t => {
    const f = sessionFixture(t);
    await f.service.login(f.a1, credentials(), f.signal);
    const old = f.snapshot().session;
    f.controls.rejectAccess.add(old.accessToken);
    f.controls.refreshResponse = { status, body };
    await assert.rejects(f.service.status(f.a1, f.signal), {
      code: 'WEALTHSIMPLE_UPSTREAM_FAILURE', statusCode: 502, message: 'Wealthsimple could not complete the request.',
    });
    assert.equal(f.store.saves, 1);
    assert.equal(f.snapshot().session.refreshToken, old.refreshToken);
    await f.restart();
    f.controls.refreshResponse = undefined;
    assert.equal((await f.service.graphql(f.a1, query, f.signal)).status, 200);
    assert.equal(f.calls.filter(call => call.grant === 'refresh_token').at(-1)!.refresh, old.refreshToken);
    assert.notEqual(f.snapshot().session.refreshToken, old.refreshToken);
  });
}
