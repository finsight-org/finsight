import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WealthsimpleClient, MAX_RESPONSE_BYTES } from '../src/providers/wealthsimple/client.js';
import { accountQuery, deferred, endpoint, fixture, credentials, graphql, tokens } from './wealthsimple-fixtures.js';

const signal = () => new AbortController().signal;
// Injected fetch responses need the URL native fetch normally supplies for cookie storage/redirects.
function responseAt(url: string, body: string, init?: ResponseInit) {
  const response = new Response(body, init);
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

test('fetch-cookie scopes multiple Set-Cookie headers and disconnect clears its jar', async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const client = new WealthsimpleClient({ fetch: async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    const path = new URL(String(url)).pathname;
    if (path === '/app/login') {
      const headers = new Headers();
      headers.append('set-cookie', 'wssdi=device; Secure; Path=/');
      headers.append('set-cookie', 'restricted=hidden; Secure; Path=/app');
      headers.append('set-cookie', 'foreign=hidden; Domain=unrelated.test; Path=/');
      return responseAt(String(url), '<script src="/assets/app-test.js"></script>', { headers });
    }
    if (path === '/assets/app-test.js') return new Response('config={environment:"production",clientId:"fixture"}');
    if (path.endsWith('/token/info')) return Response.json({ identity_canonical_id: 'identity' });
    if (path.endsWith('/token')) return Response.json(tokens);
    return Response.json({ data: { anything: true } });
  } });
  await client.login(credentials, signal());
  await client.graphql({ query: '{ anything }' }, signal());
  assert.equal(calls.find(call => call.url.endsWith('/graphql'))?.headers.get('cookie'), 'wssdi=device');
  assert.equal(calls.find(call => call.url.endsWith('/token'))?.headers.get('cookie'), null);
  assert.equal(calls.find(call => call.url.endsWith('/token'))?.headers.get('authorization'), null);
  client.disconnect();
  assert.equal(client.getStatus(), 'disconnected');
  await client.login(credentials, signal());
  const logins = calls.filter(call => call.url.endsWith('/app/login'));
  assert.equal(logins[1].headers.get('cookie'), null);
  client.disconnect();
});

test('public login redirects store cookies before following the redirect', async t => {
  const f = await fixture(t, {
    '/login': (_call, _req, res) => {
      res.writeHead(302, { 'set-cookie': 'wssdi=DEVICE_SENTINEL; Path=/', location: '/redirected-login' });
      res.end();
    },
    '/redirected-login': (call, _req, res) => {
      assert.match(String(call.headers.cookie), /wssdi=DEVICE_SENTINEL/);
      res.end('<script src="/assets/app-test.js"></script>');
    },
  });
  assert.deepEqual((await f.login()).json(), { status: 'connected' });
});

test('untrusted assets and token redirects never receive authentication requests', async t => {
  for (const target of ['https://evil.test/app-test.js', 'http://my.wealthsimple.com/app-test.js', 'https://user:pass@my.wealthsimple.com/app-test.js', 'https://wealthsimple.com.evil.test/app-test.js']) {
    await t.test(target, async t => {
      const f = await fixture(t, { '/login': (_call, _req, res) => {
        res.setHeader('set-cookie', 'wssdi=device; Path=/');
        res.end(`<script src="${target}"></script>`);
      } });
      assert.equal((await f.login()).statusCode, 502);
      assert.equal(f.calls.length, 1);
    });
  }
  const f = await fixture(t, { '/token': (_call, _req, res) => {
    res.writeHead(307, { location: '/should-not-receive-password' });
    res.end();
  } });
  assert.equal((await f.login(credentials)).statusCode, 502);
  assert.ok(!f.calls.some(call => call.path === '/should-not-receive-password'));
  assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
});

test('fetch-cookie bounds public redirects without a manual redirect loop', async () => {
  let calls = 0;
  const client = new WealthsimpleClient({ fetch: async url => {
    calls++;
    return responseAt(String(url), '', { status: 302, headers: { location: '/loop' } });
  } });
  await assert.rejects(client.login(credentials, signal()), { code: 'WEALTHSIMPLE_UPSTREAM_FAILURE' });
  assert.equal(calls, 21);
});

test('login, bundle and token-info redirects are checked before sending headers to untrusted targets', async t => {
  for (const path of ['/login', '/assets/app-test.js', '/info']) {
    for (const target of ['http://127.0.0.1:9/private', 'https://evil.test/private',
      'http://my.wealthsimple.com/private', 'https://user:pass@api.production.wealthsimple.com/private',
      'ftp://my.wealthsimple.com/private']) {
      await t.test(`${path} to ${target}`, async t => {
        let foreignRequests = 0;
        const f = await fixture(t, { [path]: (_call, _req, res) => {
          res.writeHead(302, { location: target });
          res.end();
        } }, { fetch: async (input, init) => {
          if (String(input) === target) {
            foreignRequests++;
            return Response.json({ identity_canonical_id: 'foreign' });
          }
          return fetch(input, init);
        } });
        assert.equal((await f.login()).statusCode, 502);
        assert.equal(foreignRequests, 0);
      });
    }
  }
});

test('trusted HTTPS Wealthsimple redirects still work with fetch-cookie', async () => {
  const destinations: string[] = [];
  const client = new WealthsimpleClient({ fetch: async (input) => {
    const address = String(input);
    destinations.push(address);
    if (address.endsWith('/app/login')) return responseAt(address, '', {
      status: 302,
      headers: { location: 'https://login.wealthsimple.com/page', 'set-cookie': 'wssdi=device; Domain=wealthsimple.com; Secure; Path=/' },
    });
    if (address === 'https://login.wealthsimple.com/page') return responseAt(address, '<script src="https://assets.wealthsimple.com/app-test.js"></script>');
    if (address.endsWith('/app-test.js')) return new Response('config={environment:"production",clientId:"fixture"}');
    if (address.endsWith('/token/info')) return Response.json({ identity_canonical_id: 'identity' });
    return Response.json(tokens);
  } });
  assert.deepEqual(await client.login(credentials, signal()), { status: 'connected' });
  assert.ok(destinations.includes('https://login.wealthsimple.com/page'));
  assert.ok(destinations.includes('https://assets.wealthsimple.com/app-test.js'));
  client.disconnect();
});

test('oversized streamed responses are cancelled and reported as upstream failure', async () => {
  let cancelled = false;
  const client = new WealthsimpleClient({ fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(client.login(credentials, signal()), { code: 'WEALTHSIMPLE_UPSTREAM_FAILURE' });
  assert.equal(cancelled, true);
});

test('a caller deadline cancels an upstream request without clearing the connected session', { timeout: 5000 }, async t => {
  const cancelled = deferred();
  const f = await fixture(t, { '/graphql': (_call, _req, res) => { res.once('close', () => cancelled.resolve()); } });
  await f.login();
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  await assert.rejects(fetch(address + graphql, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: accountQuery }), signal: AbortSignal.timeout(100),
  }), { name: 'TimeoutError' });
  await cancelled.promise;
  assert.equal((await f.app.inject(endpoint)).json().status, 'connected');
});
