import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAuthConfig, createSupabaseVerifier } from '../src/auth.js';
import { authConfig, authFixture } from './auth-fixtures.js';

const env = { SUPABASE_URL: authConfig.supabaseUrl, SUPABASE_PUBLISHABLE_KEY: authConfig.publishableKey,
  WEB_ORIGINS: authConfig.webOrigins.join(',') };

test('Auth configuration preserves absent legacy configuration and validates complete values', () => {
  assert.equal(readAuthConfig({}), undefined);
  assert.equal(readAuthConfig({ SUPABASE_URL: ' ', SUPABASE_PUBLISHABLE_KEY: '', WEB_ORIGINS: '' }), undefined);
  assert.deepEqual(readAuthConfig(env), authConfig);
  for (const key of Object.keys(env)) {
    assert.throws(() => readAuthConfig({ ...env, [key]: '' }), error => !String(error).includes(authConfig.publishableKey));
  }
  for (const value of ['null', '*', 'http://*.example.test', 'http://localhost:5173/path', 'http://user:pass@localhost:5173', 'http://localhost:5173?x=1', 'javascript:alert(1)']) {
    assert.throws(() => readAuthConfig({ ...env, WEB_ORIGINS: value }));
  }
  assert.throws(() => readAuthConfig({ ...env, SUPABASE_URL: 'file:///tmp/project' }));
});

test('Supabase verifier looks up each bearer token independently through real SDK transport', async t => {
  const f = await authFixture(t);
  const verify = createSupabaseVerifier(f.config);
  assert.deepEqual(await Promise.all(['token-a', 'token-b'].map(verify)), [
    { status: 'authenticated', user: { id: 'user-a', email: 'a@example.test' } },
    { status: 'authenticated', user: { id: 'user-b', email: 'b@example.test' } },
  ]);
  assert.deepEqual(f.calls.sort(), ['token-a', 'token-b']);
  for (const token of ['expired', 'forged', 'wrong-project']) assert.deepEqual(await verify(token), { status: 'unauthenticated' });
  assert.deepEqual(await verify('server-error'), { status: 'unavailable' });
});

test('Auth deadlines and network failures are retryable unavailability with no diagnostics', async t => {
  const f = await authFixture(t);
  assert.deepEqual(await createSupabaseVerifier(f.config, { timeoutMs: 20 })('timeout'), { status: 'unavailable' });
  const verify = createSupabaseVerifier(f.config, { fetch: async () => { throw new Error('PRIVATE_DIAGNOSTIC'); } });
  assert.deepEqual(await verify('token-a'), { status: 'unavailable' });
});
