import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnectionError } from '../src/connections/model.js';
import { access, barrier, credentials, query, sessionFixture } from './session-fixtures.js';

test('overlapping logins issue one password grant, queued caller abort does no upstream work', async t => {
  const f = sessionFixture(t), pause = barrier(), caller = new AbortController();
  f.controls.beforeResponse = async call => { if (call.grant === 'password') await pause.wait(); };
  const first = f.service.login(f.a1, credentials(), f.signal);
  await pause.entered;
  const second = f.service.login(f.a1, credentials(), f.signal);
  const cancelled = f.service.graphql(f.a1, query, caller.signal);
  caller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  pause.release();
  await first;
  await assert.rejects(second, { code: 'CONNECTION_ALREADY_CONNECTED' });
  assert.equal(f.passwordGrants(), 1);
  assert.equal(f.calls.filter(call => call.path === '/graphql').length, 0);
});

test('ownership disappearing inside the slot prevents cache, store and provider use', async t => {
  const f = sessionFixture(t), pause = barrier();
  let owned = true;
  f.a1.checkOwnership = async () => { if (!owned) throw new ConnectionError('CONNECTION_NOT_FOUND'); };
  const removing = f.service.removeRecord(f.a1, async () => { await pause.wait(); owned = false; return true; }, f.signal);
  await pause.entered;
  const waiting = f.service.status(f.a1, f.signal);
  pause.release();
  assert.equal(await removing, true);
  await assert.rejects(waiting, { code: 'CONNECTION_NOT_FOUND' });
  assert.equal(f.store.loads, 0);
  assert.equal(f.controls.clients, 0);
  assert.equal(f.calls.length, 0);
});

test('caller abort after refresh response waits for service-owned save and withholds data', async t => {
  const f = sessionFixture(t), caller = new AbortController(), pause = barrier();
  await f.service.login(f.a1, credentials(), f.signal);
  const old = f.snapshot().session;
  f.controls.rejectAccess.add(old.accessToken);
  f.store.saveBarrier = pause;
  const request = f.service.graphql(f.a1, query, caller.signal);
  await pause.entered;
  caller.abort();
  assert.equal(f.store.saveSignal!.aborted, false);
  pause.release();
  await assert.rejects(request, { name: 'AbortError' });
  assert.notEqual(f.snapshot().session.refreshToken, old.refreshToken);
  assert.equal((await f.service.graphql(f.a1, query, f.signal)).status, 200);
});

test('caller abort during refresh waits for fetch to settle before the next disconnect', async t => {
  const f = sessionFixture(t), caller = new AbortController(), pause = barrier();
  await f.service.login(f.a1, credentials(), f.signal);
  f.controls.rejectAccess.add(f.snapshot().session.accessToken);
  f.controls.beforeResponse = async call => { if (call.grant === 'refresh_token') await pause.wait(); };
  const active = f.service.graphql(f.a1, query, caller.signal);
  await pause.entered;
  caller.abort();
  const next = f.service.disconnect(f.a1, f.signal);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.store.removals, 0);
  pause.release();
  await assert.rejects(active, { name: 'AbortError' });
  await next;
  assert.equal(f.store.rows.size, 0);
});

test('commit-then-fail forces next request to restore the committed rotation', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  const old = f.snapshot().session;
  f.controls.rejectAccess.add(old.accessToken);
  f.store.saveMode = 'commit-then-fail';
  await assert.rejects(f.service.graphql(f.a1, query, f.signal), { code: 'SESSION_STORAGE_UNAVAILABLE' });
  const committed = f.snapshot().session;
  assert.notEqual(old.refreshToken, committed.refreshToken);
  f.controls.rejectAccess.add(committed.accessToken);
  f.store.saveMode = 'ok';
  await f.service.graphql(f.a1, query, f.signal);
  assert.equal(f.controls.clients, 2);
  assert.equal(f.calls.filter(call => call.grant === 'refresh_token').at(-1)!.refresh, committed.refreshToken);
});

test('failed login save or failed cookie save on malformed upstream response evicts the live client', async t => {
  const f = sessionFixture(t);
  f.store.saveMode = 'fail';
  await assert.rejects(f.service.login(f.a1, credentials(), f.signal), { code: 'SESSION_STORAGE_UNAVAILABLE' });
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'disconnected' });
  f.store.saveMode = 'ok';
  await f.service.login(f.a1, credentials(), f.signal);
  f.controls.queryCookie = 'auth=unsaved; Path=/';
  f.controls.malformed = true;
  f.store.saveMode = 'fail';
  await assert.rejects(f.service.graphql(f.a1, query, f.signal), { code: 'SESSION_STORAGE_UNAVAILABLE' });
  f.controls.queryCookie = '';
  f.controls.malformed = false;
  f.store.saveMode = 'ok';
  await f.service.graphql(f.a1, query, f.signal);
  assert.doesNotMatch(f.calls.at(-1)!.cookies, /unsaved/);
});

test('failed durable disconnect reports 503 and reloads on subsequent authorized access', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  f.store.failRemove = true;
  await assert.rejects(f.service.disconnect(f.a1, f.signal), { code: 'SESSION_STORAGE_UNAVAILABLE' });
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'connected' });
  assert.equal(f.controls.clients, 2);
});

for (const method of ['disconnect', 'removeRecord'] as const) {
  test(method + ' follows refresh save in its slot while another record proceeds independently', async t => {
    const f = sessionFixture(t), save = barrier(), deleting = barrier();
    await f.service.login(f.a1, credentials(), f.signal);
    await f.service.login(f.b1, credentials('other'), f.signal);
    f.controls.rejectAccess.add(f.snapshot().session.accessToken);
    f.store.saveBarrier = save;
    f.store.removeBarrier = deleting;
    const active = f.service.graphql(f.a1, query, f.signal);
    await save.entered;
    const remove = method === 'disconnect' ? f.service.disconnect(f.a1, f.signal) :
      f.service.removeRecord(f.a1, async () => {
        await deleting.wait();
        f.store.rows.delete(f.a1.binding.connectionId); // Simulate metadata FK cascade.
        f.a1.checkOwnership = async () => { throw new ConnectionError('CONNECTION_NOT_FOUND'); };
        return true;
      }, f.signal);
    const waiting = f.service.graphql(f.a1, query, f.signal);
    assert.equal((await f.service.graphql(f.b1, query, f.signal)).status, 200);
    save.release();
    await active;
    await deleting.entered;
    assert.equal(f.store.rows.has(f.a1.binding.connectionId), true);
    deleting.release();
    await remove;
    await assert.rejects(waiting, { code: method === 'disconnect' ? 'WEALTHSIMPLE_NOT_CONNECTED' : 'CONNECTION_NOT_FOUND' });
    assert.equal(await f.store.load(f.a1.binding.connectionId, f.signal), null);
    assert.equal(f.store.removals, method === 'disconnect' ? 1 : 0);
  });
}

test('close rejects queued and new work, drains an active save and retains durable state', async t => {
  const f = sessionFixture(t), save = barrier();
  f.store.saveBarrier = save;
  const active = f.service.login(f.a1, credentials(), f.signal);
  await save.entered;
  const queued = f.service.status(f.a1, f.signal);
  let closed = false;
  const close = f.service.close().then(() => { closed = true; });
  await assert.rejects(queued, { code: 'SESSION_SERVICE_CLOSED' });
  await assert.rejects(f.service.status(f.b1, f.signal), { code: 'SESSION_SERVICE_CLOSED' });
  assert.equal(closed, false);
  assert.equal(f.store.saveSignal!.aborted, false);
  save.release();
  await Promise.allSettled([active, close]);
  assert.equal(closed, true);
  assert.equal(f.store.removals, 0);
  assert.equal(f.store.rows.size, 1);
  await f.restart();
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'connected' });
});

test('inactive MFA expires by age or cache pressure, connected records can reload and active records survive', async t => {
  const f = sessionFixture(t), pause = barrier();
  await f.service.login(f.a1, credentials(), f.signal);
  f.controls.requireOtp = true;
  await f.service.login(f.a2, credentials('second'), f.signal);
  f.controls.beforeResponse = async call => { if (call.path === '/graphql') await pause.wait(); };
  const active = f.service.graphql(f.a1, query, f.signal);
  await pause.entered;
  f.controls.now += 15 * 60 * 1000;
  assert.deepEqual(await f.service.status(f.a2, f.signal), { status: 'disconnected' });
  await f.service.login(f.a2, credentials('second'), f.signal);
  for (let i = 0; i < 256; i++) {
    f.controls.now++;
    await f.service.login(access(), credentials(), f.signal);
  }
  assert.deepEqual(await f.service.status(f.a2, f.signal), { status: 'disconnected' });
  pause.release();
  assert.equal((await active).status, 200);
  const clients = f.controls.clients;
  f.controls.now += 15 * 60 * 1000;
  assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'connected' });
  assert.equal(f.controls.clients, clients + 1);
});

test('disconnect completes while another record has a query in flight', async t => {
  const f = sessionFixture(t), pause = barrier();
  await f.service.login(f.a1, credentials(), f.signal);
  await f.service.login(f.b1, credentials('other'), f.signal);
  f.controls.beforeResponse = async call => { if (call.path === '/graphql') await pause.wait(); };
  const activeB = f.service.graphql(f.b1, query, f.signal);
  await pause.entered;
  await f.service.disconnect(f.a1, f.signal);
  assert.equal(await f.store.load(f.a1.binding.connectionId, f.signal), null);
  pause.release();
  assert.equal((await activeB).status, 200);
});

test('successful persistence of cookies on upstream error survives restart', async t => {
  const f = sessionFixture(t);
  await f.service.login(f.a1, credentials(), f.signal);
  f.controls.queryCookie = 'auth=changed; Path=/; HttpOnly';
  f.controls.malformed = true;
  await assert.rejects(f.service.graphql(f.a1, query, f.signal), { code: 'WEALTHSIMPLE_UPSTREAM_FAILURE' });
  await f.restart();
  f.controls.malformed = false;
  f.controls.queryCookie = '';
  await f.service.graphql(f.a1, query, f.signal);
  assert.match(f.calls.at(-1)!.cookies, /auth=changed/);
});
