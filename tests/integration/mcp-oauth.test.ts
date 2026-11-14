import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../../src/app.js';
import { wealthsimpleProvider } from '../../src/providers/wealthsimple/index.js';
import { sessionFixture, access, barrier, credentials, query } from '../session-fixtures.js';
import { createLocalFixture, type LocalUser } from './supabase-fixture.js';

const resource = 'https://finsight.example.test/mcp';
const redirect = 'http://127.0.0.1:43721/callback';

test('real Supabase grants isolate two Wealthsimple users before and after OAuth revocation', { timeout: 15000 }, async t => {
  const f = await createLocalFixture(t);
  const ws = sessionFixture(t);
  const app = createApp([wealthsimpleProvider()], {
    auth: f.config, connectionSessions: ws.service,
    mcpOAuth: { resource, issuer: f.config.supabaseUrl + '/auth/v1' },
  });
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });

  const dbUrl = new URL(process.env.FINSIGHT_TEST_SUPABASE_DB_URL ?? 'invalid:');
  assert.ok(dbUrl.protocol === 'postgresql:' && ['127.0.0.1', 'localhost', '[::1]'].includes(dbUrl.hostname),
    'Set FINSIGHT_TEST_SUPABASE_DB_URL to a loopback Supabase database.');
  function sql(statement: string) {
    try {
      execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement], {
        env: { ...process.env, PGHOST: dbUrl.hostname, PGPORT: dbUrl.port, PGUSER: decodeURIComponent(dbUrl.username),
          PGPASSWORD: decodeURIComponent(dbUrl.password), PGDATABASE: dbUrl.pathname.slice(1) },
        stdio: 'ignore',
      });
    } catch { throw new Error('Local OAuth test database setup failed.'); }
  }
  const admin = createClient(f.config.supabaseUrl, process.env.FINSIGHT_TEST_SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const oauth = await admin.auth.admin.oauth.createClient({
    client_name: 'FinSight MCP fixture',
    redirect_uris: [redirect],
    token_endpoint_auth_method: 'client_secret_basic',
  });
  assert.equal(oauth.error?.message, undefined);
  const { client_id: clientId, client_secret: clientSecret } = oauth.data!;
  assert.match(clientId, /^[a-f0-9-]{36}$/);
  assert.ok(typeof clientSecret === 'string' && clientSecret.length > 0);
  try {
    sql(`insert into finsight_private.mcp_oauth_clients values ('${clientId}', '${resource}')`);
  } finally {
    t.after(async () => {
      sql(`delete from finsight_private.mcp_oauth_clients where client_id = '${clientId}'`);
      await admin.auth.admin.oauth.deleteClient(clientId);
    });
  }

  const metadata = await fetch(f.config.supabaseUrl + '/auth/v1/.well-known/oauth-authorization-server');
  assert.equal(metadata.status, 200);
  const settings = await metadata.json() as { issuer: string; scopes_supported: string[]; code_challenge_methods_supported: string[] };
  assert.equal(settings.issuer, f.config.supabaseUrl + '/auth/v1');
  assert.ok(settings.code_challenge_methods_supported.includes('S256'));
  const scopes = settings.scopes_supported.includes('offline_access') ? 'openid offline_access' : 'openid';

  async function begin() {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomUUID();
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirect, scope: scopes, state,
      response_type: 'code', resource, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const response = await fetch(f.config.supabaseUrl + '/auth/v1/oauth/authorize?' + params, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const authorizationId = new URL(response.headers.get('location')!).searchParams.get('authorization_id');
    assert.ok(authorizationId);
    return { authorizationId, verifier, state };
  }
  const denied = await begin();
  const pendingDenial = await f.a.client.auth.oauth.getAuthorizationDetails(denied.authorizationId);
  assert.equal(pendingDenial.error?.message, undefined);
  const denial = await f.a.client.auth.oauth.denyAuthorization(denied.authorizationId, { skipBrowserRedirect: true });
  assert.equal(denial.error?.message, undefined);
  const callback = new URL(denial.data!.redirect_url);
  assert.equal(callback.searchParams.get('state'), denied.state);
  assert.equal(callback.searchParams.get('error'), 'access_denied');

  function exchange(params: Record<string, string>) {
    return fetch(f.config.supabaseUrl + '/auth/v1/oauth/token', {
      method: 'POST', redirect: 'error',
      headers: { Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64') },
      body: new URLSearchParams({ resource, ...params }),
    });
  }
  async function issue(user: LocalUser) {
    const flow = await begin();
    const details = await user.client.auth.oauth.getAuthorizationDetails(flow.authorizationId);
    assert.equal(details.error?.message, undefined);
    assert.ok(details.data && 'user' in details.data);
    assert.equal(details.data.user.id, user.id);
    const approval = await user.client.auth.oauth.approveAuthorization(flow.authorizationId, { skipBrowserRedirect: true });
    assert.equal(approval.error?.message, undefined);
    const callback = new URL(approval.data!.redirect_url);
    assert.equal(callback.searchParams.get('state'), flow.state);
    const code = callback.searchParams.get('code');
    assert.ok(code);
    const response = await exchange({ grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: redirect });
    assert.equal(response.status, 200, 'PKCE token exchange');
    return await response.json() as { access_token: string; refresh_token: string };
  }
  const [aToken, bToken] = await Promise.all([issue(f.a), issue(f.b)]);
  async function create(user: LocalUser, label: string, connected = true) {
    const response = await user.client.from('provider_connections')
      .insert({ provider_id: 'wealthsimple', label }).select('id').single();
    assert.equal(response.error?.message, undefined);
    const id: string = response.data!.id;
    const binding = access(user.id);
    binding.binding.connectionId = id;
    const owner = label + '@example.test';
    if (connected) await ws.service.login(binding, credentials(owner), ws.signal);
    return { id, owner };
  }
  const a1 = await create(f.a, 'a-one'), a2 = await create(f.a, 'a-two'),
    b1 = await create(f.b, 'b-one'), disconnected = await create(f.b, 'disconnected', false);

  async function agent(token: string, modern = false) {
    const client = new Client({ name: 'oauth-fixture', version: '1.0.0' },
      modern ? { versionNegotiation: { mode: 'auto' } } : undefined);
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', address), {
      requestInit: { headers: { Authorization: 'Bearer ' + token } },
    }));
    t.after(() => client.close());
    return async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      const content = (response.content as Array<{ type: string; text: string }>)[0];
      assert.equal(content.type, 'text');
      return JSON.parse(content.text) as { body: string; statusCode: number };
    };
  }

  const a = await agent(aToken.access_token, true), b = await agent(bToken.access_token);
  const page = JSON.parse((await a('list_connections', { limit: 1 })).body);
  const next = JSON.parse((await a('list_connections', { cursor: page.nextCursor })).body);
  const owned = [...page.connections, ...next.connections];
  assert.deepEqual(owned.map(row => row.id).sort(), [a1.id, a2.id].sort());
  assert.deepEqual(owned.map(row => Object.keys(row)), [['id', 'providerId', 'label'], ['id', 'providerId', 'label']]);
  assert.deepEqual(JSON.parse((await b('list_connections', {})).body).connections.map((row: { id: string }) => row.id).sort(),
    [b1.id, disconnected.id].sort());

  const tool = 'query_provider_graphql';
  const before = ws.calls.length;
  const foreign = await a(tool, { ...query, connectionId: b1.id });
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(await a(tool, { ...query, connectionId: randomUUID() }), foreign);
  assert.equal((await b(tool, { query: 'mutation { change }', connectionId: b1.id })).statusCode, 400);
  assert.equal(ws.calls.length, before);
  assert.equal((await b(tool, { ...query, connectionId: disconnected.id })).statusCode, 409);
  for (const [run, record] of [[a, a1], [a, a2], [b, b1]] as const) {
    const response = await run(tool, { ...query, connectionId: record.id, variables: { identityId: 'ignored' } });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).data.identityId, record.owner);
  }

  const refresh = await exchange({ grant_type: 'refresh_token', refresh_token: aToken.refresh_token });
  assert.equal(refresh.status, 200);
  const fresh = await refresh.json() as typeof aToken;
  const refreshed = await agent(fresh.access_token);
  assert.equal((await refreshed('list_connections', {})).statusCode, 200);

  async function postgrest(token: string, method: string, path = '', body?: object) {
    return fetch(f.config.supabaseUrl + '/rest/v1/provider_connections' + path, {
      method,
      headers: { apikey: f.config.publishableKey, Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  assert.equal((await postgrest(fresh.access_token, 'POST', '', { provider_id: 'wealthsimple' })).status, 403);
  assert.deepEqual(await (await postgrest(fresh.access_token, 'PATCH', '?id=eq.' + a1.id, { label: 'denied' })).json(), []);
  assert.deepEqual(await (await postgrest(fresh.access_token, 'DELETE', '?id=eq.' + a1.id)).json(), []);

  const bearer = (token: string) => ({ Authorization: 'Bearer ' + token });
  const clock = Date.now;
  const advanced = t.mock.method(Date, 'now', () => clock() + 24 * 60 * 60 * 1000);
  try {
    assert.equal((await fetch(address + '/mcp', { headers: bearer(fresh.access_token) })).status, 401);
  } finally {
    advanced.mock.restore();
  }

  await t.test('GoTrue refuses account changes from a delegated token', {
    skip: process.env.FINSIGHT_TEST_REQUIRE_AUTH_GUARD !== '1' && 'Requires GoTrue with the OAuth account-management restriction',
  }, async () => {
    const accountUpdate = await fetch(f.config.supabaseUrl + '/auth/v1/user', {
      method: 'PUT',
      headers: { ...bearer(fresh.access_token), apikey: f.config.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { fixture: true } }),
    });
    assert.equal(accountUpdate.status, 403);
  });

  assert.equal((await fetch(address + '/api/me', { headers: bearer(fresh.access_token) })).status, 401);
  assert.equal((await fetch(address + '/mcp', { headers: bearer(f.a.accessToken) })).status, 401);
  const inFlight = barrier();
  ws.controls.beforeResponse = async call => {
    if (call.path === '/graphql') await inFlight.wait();
  };
  const pendingQuery = refreshed(tool, { ...query, connectionId: a1.id });
  try {
    await inFlight.entered;
    const revoked = await f.a.client.auth.oauth.revokeGrant({ clientId });
    assert.equal(revoked.error?.message, undefined);
  } finally {
    ws.controls.beforeResponse = async () => {};
    inFlight.release();
  }
  const pendingResult = await pendingQuery;
  assert.equal(pendingResult.statusCode, 401);
  assert.doesNotMatch(pendingResult.body, /identityId|balance/);
  for (const revokedToken of [aToken.access_token, fresh.access_token]) {
    assert.equal((await fetch(address + '/mcp', { headers: bearer(revokedToken) })).status, 401);
    assert.deepEqual(await (await postgrest(revokedToken, 'GET', '?select=id')).json(), []);
  }
  assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: fresh.refresh_token })).status, 400);
  assert.equal((await b(tool, { ...query, connectionId: b1.id })).statusCode, 200);
  assert.equal((await fetch(address + '/api/connections/' + a1.id, { headers: bearer(f.a.accessToken) })).status, 200);
});
