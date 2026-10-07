import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { accountQuery, credentials, deferred, endpoint, fixture, graphql, respond } from './wealthsimple-fixtures.js';

test('shutdown aborts upstream work before draining real HTTP requests', { timeout: 5000 }, async t => {
  for (const stage of ['bootstrap', 'bundle', 'login', 'identity', 'graphql', 'refresh']) {
    await t.test(stage, async t => {
      const started = deferred();
      const release = deferred();
      t.after(() => release.resolve());
      let aborted = false;
      const f = await fixture(t, stage === 'refresh' ? {
        '/graphql': (_call, _req, res) => respond(res, {}, 401),
      } : {}, { fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        const grant = init?.body ? JSON.parse(String(init.body)).grant_type : undefined;
        const blocked = (stage === 'bootstrap' && path === '/login') ||
          (stage === 'bundle' && path === '/assets/app-test.js') ||
          (stage === 'login' && grant === 'password') ||
          (stage === 'identity' && path === '/info') ||
          (stage === 'graphql' && path === '/graphql') ||
          (stage === 'refresh' && grant === 'refresh_token');
        if (!blocked) return fetch(input, init);
        const signal = init!.signal!;
        return new Promise<Response>((resolve, reject) => {
          const abort = () => { aborted = true; reject(signal.reason); };
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
          // Release blocked work on test failure without waiting for a 30s timeout.
          release.promise.then(() => {
            signal.removeEventListener('abort', abort);
            resolve(Response.json({}, { status: 503 }));
          });
          started.resolve();
        });
      } });
      if (stage === 'graphql' || stage === 'refresh') await f.login();
      const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
      const querying = stage === 'graphql' || stage === 'refresh';
      const pending = fetch(address + (querying ? graphql : endpoint), {
        method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify(querying ? { query: accountQuery } : credentials),
      }).then(async response => ({ status: response.status, body: await response.json() }));
      await started.promise;
      const timer = new AbortController();
      try {
        await Promise.race([
          f.app.close(),
          delay(1000, undefined, { signal: timer.signal }).then(() => {
            throw new Error('Shutdown waited for blocked upstream work');
          }),
        ]);
        assert.equal(aborted, true);
        const result = await pending;
        assert.equal(result.status, 401);
        assert.equal(result.body.error.code, 'WEALTHSIMPLE_NOT_CONNECTED');
      } finally {
        timer.abort();
        release.resolve();
        await pending;
      }
    });
  }
});
