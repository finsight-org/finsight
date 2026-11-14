import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionError } from '../src/sessions/model.js';
import { ConnectionQueue } from '../src/sessions/queue.js';
import { deferred } from './wealthsimple-fixtures.js';

const signal = () => new AbortController().signal;
const isClosed = (error: unknown) => error instanceof SessionError && error.code === 'SESSION_SERVICE_CLOSED';

test('runs each connection in FIFO order while other connections run independently', async () => {
  const queue = new ConnectionQueue();
  const releaseA = deferred();
  const releaseB = deferred();
  const started: string[] = [];
  const aFirst = queue.run('a', signal(), async () => {
    started.push('a-first');
    await releaseA.promise;
    return 1;
  });
  const aSecond = queue.run('a', signal(), async () => { started.push('a-second'); return 2; });
  const aThird = queue.run('a', signal(), async () => { started.push('a-third'); return 3; });
  const bFirst = queue.run('b', signal(), async () => {
    started.push('b-first');
    await releaseB.promise;
    return 4;
  });
  assert.deepEqual(started, ['a-first', 'b-first']);
  releaseA.resolve();
  assert.deepEqual(await Promise.all([aFirst, aSecond, aThird]), [1, 2, 3]);
  assert.deepEqual(started, ['a-first', 'b-first', 'a-second', 'a-third']);
  releaseB.resolve();
  assert.equal(await bFirst, 4);
  await queue.close();
});

test('aborting waiting work rejects it immediately and preserves the following slot', async () => {
  const queue = new ConnectionQueue();
  const release = deferred();
  const active = queue.run('a', signal(), () => release.promise);
  const abortWaiting = new AbortController();
  const reason = new Error('request cancelled');
  let cancelledWorkCalls = 0;
  const cancelledJob = queue.run('a', abortWaiting.signal, async () => { cancelledWorkCalls++; });
  const rejected = assert.rejects(cancelledJob, error => error === reason);
  let followingWorkCalls = 0;
  const following = queue.run('a', signal(), async () => { followingWorkCalls++; return 'next'; });
  abortWaiting.abort(reason);
  await rejected;
  assert.equal(cancelledWorkCalls, 0);
  assert.equal(followingWorkCalls, 0);
  release.resolve();
  await active;
  assert.equal(await following, 'next');
  assert.equal(followingWorkCalls, 1);
  await queue.close();
});

test('rejected jobs release the next slot, including synchronous work failures', async () => {
  const queue = new ConnectionQueue();
  for (const synchronous of [false, true]) {
    const release = deferred();
    const failure = new Error('provider failed');
    const active = queue.run('a', signal(), () => release.promise);
    const failed = queue.run('a', signal(), synchronous
      ? () => { throw failure; }
      : async () => { throw failure; });
    const rejected = assert.rejects(failed, error => error === failure);
    const following = queue.run('a', signal(), async () => 'recovered');
    release.resolve();
    await active;
    await rejected;
    assert.equal(await following, 'recovered');
  }
  await queue.close();
});

test('closing rejects waiting work but waits for all active work without aborting it', async () => {
  const queue = new ConnectionQueue();
  const releaseA = deferred();
  const releaseB = deferred();
  const activeSignal = new AbortController();
  const a = queue.run('a', activeSignal.signal, async () => { await releaseA.promise; return 'a'; });
  const b = queue.run('b', signal(), () => releaseB.promise);
  let waitingWorkCalls = 0;
  const waiting = ['a', 'b'].map(key => queue.run(key, signal(), async () => { waitingWorkCalls++; }));
  const rejected = waiting.map(job => assert.rejects(job, isClosed));
  let closed = false;
  const closing = queue.close().then(() => { closed = true; });
  await Promise.all(rejected);
  assert.equal(closed, false);
  assert.equal(waitingWorkCalls, 0);
  assert.equal(activeSignal.signal.aborted, false);
  await assert.rejects(queue.run('new', signal(), async () => { throw new Error('must never run'); }), isClosed);
  releaseA.resolve();
  assert.equal(await a, 'a');
  assert.equal(closed, false);
  releaseB.resolve();
  await b;
  await closing;
  await queue.close();
  await assert.rejects(queue.run('a', signal(), async () => undefined), isClosed);
});

test('already aborted jobs never run on either idle or occupied connections', async () => {
  const queue = new ConnectionQueue();
  const release = deferred();
  const active = queue.run('occupied', signal(), () => release.promise);
  const aborted = new AbortController();
  aborted.abort();
  let workCalls = 0;
  for (const key of ['idle', 'occupied']) {
    await assert.rejects(queue.run(key, aborted.signal, async () => { workCalls++; }), error => error === aborted.signal.reason);
  }
  assert.equal(workCalls, 0);
  release.resolve();
  await active;
  assert.equal(await queue.run('idle', signal(), async () => 'available'), 'available');
  await queue.close();
});

test('aborting active work leaves the slot occupied until that work settles', async () => {
  const queue = new ConnectionQueue();
  const release = deferred();
  const controller = new AbortController();
  const active = queue.run('a', controller.signal, async () => { await release.promise; return 'completed'; });
  let followingWorkCalls = 0;
  const following = queue.run('a', signal(), async () => { followingWorkCalls++; });
  controller.abort();
  await Promise.resolve();
  assert.equal(followingWorkCalls, 0);
  release.resolve();
  assert.equal(await active, 'completed');
  await following;
  assert.equal(followingWorkCalls, 1);
  await queue.close();
});

test('completed connections can be reused repeatedly without blocked queue state', async () => {
  const queue = new ConnectionQueue();
  for (const key of ['a', '']) {
    for (let iteration = 0; iteration < 50; iteration++) {
      assert.equal(await queue.run(key, signal(), async () => iteration), iteration);
    }
  }
  await queue.close();
});

test('closing an idle queue is repeatable and stops admission', async () => {
  const queue = new ConnectionQueue();
  await queue.close();
  await queue.close();
  await assert.rejects(queue.run('a', signal(), async () => 'unreachable'), isClosed);
});
