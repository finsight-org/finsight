import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { WealthsimpleClient, WealthsimpleError } from '../src/providers/wealthsimple/client.js';
import { credentials, deferred, endpoint, fixture, page, respond, tokens } from './wealthsimple-fixtures.js';

test('disconnect prevents late bootstrap, token and identity completions from reconnecting', { timeout: 5000 }, async t => {
  for (const path of ['/login', '/assets/app-test.js', '/token', '/info']) {
    await t.test(path, async t => {
      const started = deferred();
      const release = deferred();
      t.after(() => release.resolve());
      const f = await fixture(t, { [path]: async (_call, _req, res) => {
        started.resolve();
        await release.promise;
        if (path === '/login') {
          res.setHeader('set-cookie', 'wssdi=old-device; Path=/');
          res.end('<script src="/assets/app-test.js"></script>');
        } else if (path === '/assets/app-test.js') {
          res.end('config={environment:"production",clientId:"old-client"}');
        } else if (path === '/token') respond(res, tokens);
        else respond(res, { identity_canonical_id: 'old-identity' });
      } });
      const pending = f.login();
      await started.promise;
      await f.app.inject({ method: 'DELETE', url: endpoint });
      release.resolve();
      const result = await pending;
      assert.equal(result.statusCode, 401);
      assert.equal(result.json().error.code, 'WEALTHSIMPLE_NOT_CONNECTED');
      assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
      assert.equal(f.calls.at(-1)!.path, path, 'stale work must not start the next authentication request');
    });
  }
});

test('overlapping logins preserve the newer connection after an old success, challenge or failure', { timeout: 5000 }, async t => {
  for (const outcome of ['success', 'challenge', 'failure']) {
    await t.test(outcome, async t => {
      const started = deferred();
      const release = deferred();
      t.after(() => release.resolve());
      const f = await fixture(t, {
        '/token': async (call, _req, res) => {
          if (call.body.username === credentials.email) {
            started.resolve();
            await release.promise;
            if (outcome === 'success') respond(res, tokens);
            else respond(res, { error: 'invalid_grant' }, 400);
          } else respond(res, { access_token: 'new-access', refresh_token: 'new-refresh' });
        },
        '/info': (_call, _req, res) => respond(res, { identity_canonical_id: 'new-identity' }),
      });
      const pending = f.login({ ...credentials, ...(outcome === 'failure' ? { otp: '123456' } : {}) });
      await started.promise;
      assert.equal((await f.login({ ...credentials, email: 'new@example.test' })).json().status, 'connected');
      release.resolve();
      assert.equal((await pending).json().error.code, 'WEALTHSIMPLE_NOT_CONNECTED');
      assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
      assert.equal((await f.query()).statusCode, 200);
      assert.equal(f.calls.at(-1)!.headers.authorization, 'Bearer new-access');
      assert.equal(f.calls.at(-1)!.body.variables.identityId, 'new-identity');
    });
  }
});

test('late bootstrap cookies cannot enter a replacement login jar', { timeout: 5000 }, async t => {
  for (const disconnect of [false, true]) {
    await t.test(disconnect ? 'disconnect and reconnect' : 'overlapping login', async t => {
      const started = deferred();
      const release = deferred();
      t.after(() => release.resolve());
      let logins = 0;
      const f = await fixture(t, { '/login': async (_call, _req, res) => {
        if (++logins === 1) {
          started.resolve();
          await release.promise;
          res.setHeader('set-cookie', ['wssdi=old-device; Path=/', 'stale_cookie=old; Path=/']);
        } else res.setHeader('set-cookie', 'wssdi=new-device; Path=/');
        res.end('<script src="/assets/app-test.js"></script>');
      } });
      const pending = f.login();
      await started.promise;
      if (disconnect) await f.app.inject({ method: 'DELETE', url: endpoint });
      await f.login({ ...credentials, email: 'new@example.test' });
      release.resolve();
      assert.equal((await pending).json().error.code, 'WEALTHSIMPLE_NOT_CONNECTED');
      await f.query();
      assert.match(String(f.calls.at(-1)!.headers.cookie), /wssdi=new-device/);
      assert.doesNotMatch(String(f.calls.at(-1)!.headers.cookie), /old-device|stale_cookie/);
    });
  }
});

test('old GraphQL responses cannot retry or return data after connection replacement', { timeout: 5000 }, async t => {
  for (const outcome of ['success', 'unauthorized', 'retry unauthorized']) {
    await t.test(outcome, async t => {
      const started = deferred();
      const release = deferred();
      t.after(() => release.resolve());
      let logins = 0;
      const f = await fixture(t, {
        '/token': (call, _req, res) => {
          if (call.body.grant_type === 'refresh_token') {
            respond(res, { access_token: 'old-rotated', refresh_token: 'old-refresh' });
          } else respond(res, { access_token: `access-${++logins}`, refresh_token: `refresh-${logins}` });
        },
        '/info': (call, _req, res) => respond(res, { identity_canonical_id: `identity-${call.headers.authorization}` }),
        '/graphql': async (call, _req, res) => {
          if (outcome === 'retry unauthorized' && call.headers.authorization === 'Bearer access-1') {
            return respond(res, {}, 401);
          }
          if (['Bearer access-1', 'Bearer old-rotated'].includes(String(call.headers.authorization))) {
            started.resolve();
            await release.promise;
            respond(res, outcome === 'success' ? page() : {}, outcome === 'success' ? 200 : 401);
          } else respond(res, page());
        },
      });
      await f.login();
      const pending = f.query();
      await started.promise;
      await f.app.inject({ method: 'DELETE', url: endpoint });
      await f.login({ ...credentials, email: 'new@example.test' });
      release.resolve();
      assert.equal((await pending).json().error.code, 'WEALTHSIMPLE_NOT_CONNECTED');
      assert.equal(f.calls.filter(call => call.path === '/graphql').length, outcome === 'retry unauthorized' ? 2 : 1);
      assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
      assert.equal((await f.query()).statusCode, 200);
      assert.equal(f.calls.at(-1)!.body.variables.identityId, 'identity-Bearer access-2');
    });
  }
});

test('stale refresh success or rejection cannot clear the new shared refresh or connection', { timeout: 5000 }, async t => {
  for (const reject of [false, true]) {
    await t.test(reject ? 'old refresh rejected' : 'old refresh succeeded', async t => {
      const oldStarted = deferred();
      const oldRelease = deferred();
      const newStarted = deferred();
      const newRelease = deferred();
      t.after(() => { oldRelease.resolve(); newRelease.resolve(); });
      let logins = 0;
      let newRefreshes = 0;
      let newStaleReads = 0;
      const client = new WealthsimpleClient({ fetch: async (input, init) => {
        const address = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (address.endsWith('/app/login')) {
          const response = new Response('<script src="/app-test.js"></script>', {
            headers: { 'set-cookie': 'wssdi=device; Path=/' },
          });
          Object.defineProperty(response, 'url', { value: address });
          return response;
        }
        if (address.endsWith('/app-test.js')) return new Response('config={environment:"production",clientId:"fixture"}');
        if (address.endsWith('/token/info')) return Response.json({ identity_canonical_id: `identity-${logins}` });
        if (address.endsWith('/token')) {
          if (body.grant_type === 'password') {
            return Response.json({ access_token: `access-${++logins}`, refresh_token: `refresh-${logins}` });
          }
          if (body.refresh_token === 'refresh-1') {
            oldStarted.resolve();
            await oldRelease.promise;
            return reject ? Response.json({ error: 'invalid_grant' }, { status: 400 }) :
              Response.json({ access_token: 'old-rotated', refresh_token: 'old-refresh' });
          }
          assert.equal(body.refresh_token, 'refresh-2');
          newRefreshes++;
          newStarted.resolve();
          await newRelease.promise;
          return Response.json({ access_token: 'new-rotated', refresh_token: 'new-refresh' });
        }
        const authorization = new Headers(init?.headers).get('authorization');
        if (authorization === 'Bearer new-rotated') return Response.json(page());
        if (authorization === 'Bearer access-2') newStaleReads++;
        return Response.json({}, { status: 401 });
      } });
      t.after(() => client.disconnect());
      const signal = AbortSignal.timeout(5000);
      const query = () => client.graphql({ query: '{ arbitrary }' }, signal);
      await client.login(credentials, signal);
      const oldRead = query().catch(error => error);
      await oldStarted.promise;
      client.disconnect();
      await client.login({ ...credentials, email: 'new@example.test' }, signal);
      const firstNewRead = query();
      await newStarted.promise;
      oldRelease.resolve();
      const oldError = await oldRead;
      assert.ok(oldError instanceof WealthsimpleError);
      assert.equal(oldError.code, 'WEALTHSIMPLE_NOT_CONNECTED');
      const secondNewRead = query();
      // In-memory responses finish in microtasks. Yield one turn so the second
      // 401 has joined the pending refresh before allowing it to complete.
      await setImmediate();
      assert.equal(newStaleReads, 2);
      assert.equal(newRefreshes, 1);
      newRelease.resolve();
      assert.equal((await firstNewRead).status, 200);
      assert.equal((await secondNewRead).status, 200);
      assert.equal(newRefreshes, 1);
      assert.equal(client.getStatus(), 'connected');
    });
  }
});
