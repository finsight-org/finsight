import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import type { AuthVerification } from '../src/auth.js';

const origin = 'https://finsight.example.test';
const resource = origin + '/mcp';
const issuer = 'https://auth.example.test/auth/v1';
const user = { id: '72e2448c-b921-46aa-a65d-4ffa28ca700b', email: null };
const claimBase = {
  iss: issuer, aud: ['authenticated', resource], sub: user.id,
  exp: Math.floor(Date.now() / 1000) + 120, role: 'authenticated',
  client_id: 'fd56dafb-3d59-4688-a9a9-cb4e17a65939',
  session_id: '4755fd36-deb4-4819-a3d5-07116b52d15d',
  scope: 'openid', finsight_mcp_read: true,
};

test('hosted MCP publishes OAuth discovery, separates browser tokens and disables shared routes', async t => {
  const app = createApp([], {
    auth: { supabaseUrl: 'https://auth.example.test', publishableKey: 'sb_publishable_test', webOrigins: [origin] },
    mcpOAuth: { resource, issuer },
    verifyAccessToken: async (token): Promise<AuthVerification> => ({
      status: 'authenticated', user,
      claims: {
        mcp: claimBase,
        wrong: { ...claimBase, aud: ['authenticated'] },
        expired: { ...claimBase, exp: 1 },
        misplaced: { ...claimBase, iss: 'https://elsewhere.example.test/auth/v1' },
        unscoped: { ...claimBase, scope: 'profile' },
        unpermitted: { ...claimBase, finsight_mcp_read: false },
      }[token] ?? {},
    }),
  });
  t.after(() => app.close());
  const metadata = await app.inject({ url: '/.well-known/oauth-protected-resource/mcp', headers: { host: new URL(origin).host } });
  assert.equal(metadata.statusCode, 200);
  assert.deepEqual(metadata.json(), { resource, authorization_servers: [issuer], scopes_supported: ['openid'] });
  const call = (token?: string) => app.inject({
    method: 'POST', url: '/mcp',
    headers: { accept: 'application/json, text/event-stream', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  for (const token of [undefined, 'browser', 'wrong', 'expired', 'misplaced', 'unscoped', 'unpermitted']) {
    const blocked = await call(token);
    assert.equal(blocked.statusCode, 401);
    assert.match(blocked.headers['www-authenticate'] as string, /oauth-protected-resource\/mcp/);
  }
  assert.equal((await call('mcp')).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/me', headers: { authorization: 'Bearer mcp' } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/me', headers: { authorization: 'Bearer browser' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/providers' })).statusCode, 404);
});

test('the production verifier checks delegated sessions at Supabase OAuth UserInfo', async () => {
  const { createSupabaseOAuthVerifier } = await import('../src/auth.js');
  const auth = { supabaseUrl: 'https://auth.example.test', publishableKey: 'sb_publishable_test', webOrigins: [origin] };
  const token = 'header.' + Buffer.from(JSON.stringify({ ...claimBase, is_anonymous: false })).toString('base64url') + '.signature';
  const verify = createSupabaseOAuthVerifier(auth, { fetch: async (input, init) => {
    assert.equal(input, issuer + '/oauth/userinfo');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + token);
    assert.equal(init?.redirect, 'error');
    return Response.json({ sub: user.id });
  } });
  const result = await verify(token);
  assert.equal(result.status, 'authenticated');
  assert.deepEqual(result.status === 'authenticated' && result.user, user);
});
