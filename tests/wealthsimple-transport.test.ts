import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Transport, MAX_RESPONSE_BYTES } from '../src/providers/wealthsimple/transport.js';
import { endpoint, fixture, credentials } from './wealthsimple-fixtures.js';

const signal = () => new AbortController().signal;

test('transport uses scoped cookies, multiple Set-Cookie headers, and clears private state', async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const transport = new Transport({ endpoints: { login: 'https://my.wealthsimple.com/app/login' }, fetch: async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    const headers = new Headers();
    if (calls.length === 1) {
      headers.append('set-cookie', 'wssdi=device; Secure; Path=/');
      headers.append('set-cookie', 'restricted=hidden; Secure; Path=/app');
      headers.append('set-cookie', 'foreign=hidden; Domain=unrelated.test; Path=/');
    }
    return new Response('{}', { headers });
  } });
  await transport.request(transport.endpoints.login, signal());
  assert.equal(transport.deviceId(), 'device');
  await transport.request('https://my.wealthsimple.com/graphql', signal());
  assert.equal(calls[1].headers.get('cookie'), 'wssdi=device');
  await transport.request('https://api.production.wealthsimple.com/token', signal());
  assert.equal(calls[2].headers.get('cookie'), null);
  transport.clear();
  assert.equal(transport.deviceId(), undefined);
});

test('untrusted assets and redirects cannot receive authentication requests', async t => {
  for (const target of ['https://evil.test/app-test.js', 'http://my.wealthsimple.com/app-test.js', 'https://user:pass@my.wealthsimple.com/app-test.js', 'https://wealthsimple.com.evil.test/app-test.js']) {
    assert.throws(() => new Transport().assetUrl(target));
  }
  for (const route of ['/login', '/token']) await t.test(route, async t => {
    const f = await fixture(t, { [route]: (_call, _req, res) => {
      if (route === '/login') {
        res.setHeader('set-cookie', 'wssdi=device; Path=/');
        res.end('<script src="https://evil.test/app-test.js"></script>');
      } else { res.writeHead(307, { location: '/should-not-receive-password' }); res.end(); }
    } });
    assert.equal((await f.login(credentials)).statusCode, 502);
    assert.ok(!f.calls.some(call => call.path === '/should-not-receive-password'));
    assert.equal((await f.app.inject(endpoint)).json().status, 'disconnected');
  });
  let calls = 0;
  const transport = new Transport({ fetch: async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://evil.test/' } });
  } });
  await assert.rejects(transport.request(transport.endpoints.login, signal()));
  assert.equal(calls, 1);
});

test('same-origin public redirects are bounded', async () => {
  let calls = 0;
  const transport = new Transport({ fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/loop' } }); } });
  await assert.rejects(transport.request(transport.endpoints.login, signal()));
  assert.equal(calls, 6);
});

test('oversized streamed upstream responses are stopped and exposed safely', async () => {
  let cancelled = false;
  const transport = new Transport({ fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(transport.request(transport.endpoints.login, signal()), { code: 'WEALTHSIMPLE_INVALID_RESPONSE' });
  assert.equal(cancelled, true);
});
