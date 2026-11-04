import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { authConfig } from './auth-fixtures.js';

test('protected endpoint fails closed without configured Auth while legacy discovery works', async t => {
  const app = createApp(); t.after(() => app.close());
  const response = await app.inject('/api/me');
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'AUTH_NOT_CONFIGURED');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await app.inject('/providers')).statusCode, 200);
});

test('protected endpoint only accepts a single bearer credential and keeps identity request-scoped', async t => {
  let calls = 0;
  const app = createApp([], { auth: authConfig, verifyAccessToken: async (token: string) => {
    calls++;
    if (token === 'rejected') return { status: 'unauthenticated' };
    if (token === 'outage') return { status: 'unavailable' };
    return { status: 'authenticated', user: { id: token, email: null } };
  } });
  t.after(() => app.close());
  for (const authorization of ['', 'Basic a', 'Bearer', 'Bearer a b', 'Bearer a,Bearer b']) {
    const r = await app.inject({ url: '/api/me', headers: { authorization } });
    assert.equal(r.statusCode, 401); assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal(calls, 0);
  const [a, b] = await Promise.all(['a', 'b'].map(token => app.inject({ url: '/api/me?userId=other', headers: { authorization: `bearer ${token}` } })));
  assert.deepEqual(a.json(), { user: { id: 'a', email: null } });
  assert.deepEqual(b.json(), { user: { id: 'b', email: null } });
  for (const [token, status, code] of [['rejected', 401, 'UNAUTHENTICATED'], ['outage', 503, 'AUTH_UNAVAILABLE']] as const) {
    const r = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.statusCode, status); assert.equal(r.json().error.code, code);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('a thrown verifier fails safely without exposing diagnostics',async t=>{
 const app=createApp([],{auth:authConfig,verifyAccessToken:async()=>{throw new Error('PRIVATE_DIAGNOSTIC');}});t.after(()=>app.close());
 const r=await app.inject({url:'/api/me',headers:{authorization:'Bearer ok'}});assert.equal(r.statusCode,503);assert.equal(r.json().error.code,'AUTH_UNAVAILABLE');assert.ok(!r.body.includes('PRIVATE_DIAGNOSTIC'));
});
