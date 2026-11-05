import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createLocalFixture } from "./supabase-fixture.js";
import { createSupabaseSessionStore } from "../../src/sessions/supabase-store.js";
import { SessionError, type DurableSession } from "../../src/sessions/model.js";

const connected: DurableSession = { state: "connected", envelope: {
  version: 1, nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AQID", tag: "AAAAAAAAAAAAAAAAAAAAAA==",
} };
const signal = () => new AbortController().signal;
test("backend-only encrypted sessions enforce permissions, constraints, and both deletion cascades", async (t) => {
  const f = await createLocalFixture(t);
  const created = await f.a.client.from("provider_connections").insert({ provider_id: "wealthsimple" }).select("id").single();
  assert.equal(created.error, null);
  const id: string = created.data!.id;
  // Fail explicitly on an absent table before exercising the storage adapter.
  const anonymous = createClient(f.config.supabaseUrl, f.config.publishableKey, { auth: { persistSession: false } });
  const probe = await anonymous.from("provider_sessions").select();
  assert.notEqual(probe.error?.code, "PGRST205", "provider_sessions table must exist");
  await f.sessionStore.save(id, connected, signal());
  assert.deepEqual(await f.sessionStore.load(id, signal()), connected);
  const initial = await f.readSessionRow(id) as Record<string, unknown>;
  assert.deepEqual(initial.encrypted_session, connected.envelope);
  assert.equal(initial.state, "connected");
  for (const client of [anonymous, f.a.client, f.b.client]) {
    const queries: PromiseLike<{ error: { code: string } | null }>[] = [
      client.from("provider_sessions").select(),
      client.from("provider_sessions").insert({ connection_id: id, state: "connected", encrypted_session: connected.envelope }),
      client.from("provider_sessions").update({ state: "expired", encrypted_session: null }).eq("connection_id", id),
      client.from("provider_sessions").delete().eq("connection_id", id),
    ];
    for (const query of queries) {
      const denied = await query;
      assert.equal(denied.error?.code, "42501", "direct session access must be permission denied");
    }
  }
  assert.deepEqual(await f.sessionStore.load(id, signal()), connected);
  // Direct privileged requests prove database CHECKs independently of adapter validation.
  for (const invalid of [
    { state: "connected", encrypted_session: null },
    { state: "expired", encrypted_session: connected.envelope },
    { state: "mfa_required", encrypted_session: null },
  ]) {
    const response = await fetch(`${f.config.supabaseUrl}/rest/v1/provider_sessions?connection_id=eq.${id}`, {
      method: "PATCH", redirect: "error", headers: { apikey: process.env.FINSIGHT_TEST_SUPABASE_SECRET_KEY!, "Content-Type": "application/json" }, body: JSON.stringify(invalid),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "23514");
  }
  await new Promise((r) => setTimeout(r, 5));
  await f.sessionStore.save(id, { state: "expired", envelope: null }, signal());
  assert.deepEqual(await f.sessionStore.load(id, signal()), { state: "expired", envelope: null });
  const replaced = await f.readSessionRow(id) as Record<string, unknown>;
  assert.ok(Date.parse(replaced.updated_at as string) > Date.parse(initial.updated_at as string));
  await f.sessionStore.remove(id, signal());
  await f.sessionStore.remove(id, signal());
  assert.equal(await f.sessionStore.load(id, signal()), null);
  await f.sessionStore.save(id, connected, signal());
  assert.equal((await f.a.client.from("provider_connections").delete().eq("id", id)).error, null);
  assert.equal(await f.sessionStore.load(id, signal()), null);
  let mutationAttempts = 0;
  const store = createSupabaseSessionStore({ supabaseUrl: f.config.supabaseUrl, secretKey: process.env.FINSIGHT_TEST_SUPABASE_SECRET_KEY! }, {
    fetch: async (input, init) => { if (init?.method === "POST") mutationAttempts++; return fetch(input, init); },
  });
  await assert.rejects(store.save(id, connected, signal()), (e: unknown) => e instanceof SessionError && e.code === "SESSION_STORAGE_UNAVAILABLE");
  assert.equal(mutationAttempts, 1);
  const second = await f.b.client.from("provider_connections").insert({ provider_id: "wealthsimple" }).select("id").single();
  assert.equal(second.error, null);
  await f.sessionStore.save(second.data!.id, connected, signal());
  await f.readSessionRow(second.data!.id);
  await f.deleteOwnedTestUser(f.b.id);
  assert.equal(await f.sessionStore.load(second.data!.id, signal()), null);
  assert.equal(await f.readSessionRow(second.data!.id), null);
  await assert.rejects(f.deleteOwnedTestUser(crypto.randomUUID()));
  await assert.rejects(f.readSessionRow(crypto.randomUUID()));
});


test("compiled backend injects configured sessions and deletes unreadable state without decryption", async t => {
  const { randomBytes } = await import("node:crypto");
  const { startCompiledBackend } = await import("./supabase-fixture.js");
  const f = await createLocalFixture(t);
  const server = await startCompiledBackend(t, f.config, {
    secretKey: process.env.FINSIGHT_TEST_SUPABASE_SECRET_KEY!,
    encryptionKey: randomBytes(32).toString("base64"),
  });
  const created = await f.a.client.from("provider_connections").insert({ provider_id: "wealthsimple" }).select("id").single();
  assert.equal(created.error, null);
  const id: string = created.data!.id;
  const path = `${server.url}/api/connections/${id}`;
  const headers = { Authorization: `Bearer ${f.a.accessToken}` };
  const status = await fetch(path + "/session", { headers });
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  assert.deepEqual(await status.json(), { status: "disconnected" });
  assert.equal((await fetch(path + "/session", { headers: { Authorization: `Bearer ${f.b.accessToken}` } })).status, 404);
  // The structurally valid envelope cannot authenticate with the backend's random key.
  await f.sessionStore.save(id, connected, signal());
  await server.restart();
  const unreadable = await fetch(path + "/session", { headers });
  assert.equal(unreadable.status, 503);
  assert.equal((await unreadable.json()).error.code, "SESSION_STATE_UNAVAILABLE");
  assert.equal((await fetch(path, { method: "DELETE", headers })).status, 204);
  assert.equal(await f.sessionStore.load(id, signal()), null);
  assert.equal((await fetch(path + "/session", { headers })).status, 404);
});

// Parent-owned synthetic HTTP state deliberately survives every backend process.
async function acceptanceFixture(t: import('node:test').TestContext) {
  const { fixture, respond, deferred } = await import('../wealthsimple-fixtures.js');
  const { randomBytes } = await import('node:crypto');
  const { startSessionBackend } = await import('./session-backend.js');
  const f = await createLocalFixture(t);
  const owners = new Map<string, string>();
  const rejected = new Set<string>();
  const rejectedRefresh = new Set<string>();
  const latest = new Map<string, { access: string; refresh: string }>();
  const blocked = deferred();
  const aborted = deferred();
  let issuance = 0, block = false, cookieVersion = 1;
  const provider = await fixture(t, {
    '/token': ({ body, headers }, _req, res) => {
      const refresh = body.grant_type === 'refresh_token';
      const owner = refresh ? owners.get(body.refresh_token) : body.username;
      if (!owner || (refresh && rejectedRefresh.has(owner))) return respond(res, { error: 'invalid_grant' }, 401);
      if (!refresh && !headers['x-wealthsimple-otp']) return respond(res, { error: 'otp_required' }, 400);
      if (!refresh && (body.password !== 'PASSWORD_SENTINEL' || headers['x-wealthsimple-otp'] !== '123456;remember=true')) return respond(res, { error: 'invalid_grant' }, 401);
      const access = `ACCESS_SENTINEL-${owner}-${++issuance}`, refreshToken = `REFRESH_SENTINEL-${owner}-${issuance}`;
      owners.set(access, owner); owners.set(refreshToken, owner);
      latest.set(owner, { access, refresh: refreshToken });
      res.setHeader('set-cookie', `auth=COOKIE_SENTINEL-${owner}-${cookieVersion}; Path=/; HttpOnly`);
      respond(res, { access_token: access, refresh_token: refreshToken });
    },
    '/info': ({ headers }, _req, res) => {
      const token = String(headers.authorization).replace(/^Bearer /, '');
      if (rejected.has(token)) return respond(res, {}, 401);
      respond(res, { identity_canonical_id: owners.get(token) });
    },
    '/graphql': ({ body, headers }, _req, res) => {
      const token = String(headers.authorization).replace(/^Bearer /, '');
      if (rejected.has(token)) return respond(res, {}, 401);
      if (block) {
        res.once('close', () => aborted.resolve());
        blocked.resolve();
        return; // SIGTERM must abort the socket rather than wait for a response.
      }
      const owner = owners.get(token);
      respond(res, { data: { identityId: body.variables.identityId, accountId: `ACCOUNT-${owner}`, cookie: headers.cookie } });
    },
  });
  const backend = await startSessionBackend(t, f.config, {
    secretKey: process.env.FINSIGHT_TEST_SUPABASE_SECRET_KEY!, encryptionKey: randomBytes(32).toString('base64'),
    wealthsimple: provider.clientOptions,
  });
  const api = (user: typeof f.a, id: string, suffix: string, method = 'GET', body?: unknown) => fetch(`${backend.url}/api/connections/${id}${suffix}`, {
    method, headers: { Authorization: `Bearer ${user.accessToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function connection(user: typeof f.a) {
    const response = await fetch(`${backend.url}/api/connections`, { method: 'POST',
      headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: 'wealthsimple' }) });
    assert.equal(response.status, 201);
    const id = (await response.json()).connection.id;
    assert.equal(typeof id, 'string');
    return id as string;
  }
  async function login(user: typeof f.a, id: string, email: string) {
    const before = await f.sessionStore.load(id, signal());
    const input = { email, password: 'PASSWORD_SENTINEL' };
    const pending = await api(user, id, '/session', 'POST', input);
    assert.equal(pending.status, 200);
    assert.deepEqual(await pending.json(), { status: 'mfa_required' });
    assert.deepEqual(await f.sessionStore.load(id, signal()), before, 'MFA must not persist credentials or pending state');
    const connected = await api(user, id, '/session', 'POST', { ...input, otp: '123456' });
    assert.equal(connected.status, 200);
    assert.deepEqual(await connected.json(), { status: 'connected' });
  }
  async function query(user: typeof f.a, id: string) {
    const { accountQuery } = await import('../wealthsimple-fixtures.js');
    return api(user, id, '/graphql', 'POST', { query: accountQuery });
  }
  async function check(user: typeof f.a, id: string, owner: string, version = cookieVersion) {
    const response = await query(user, id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.data.identityId, owner);
    assert.equal(result.data.accountId, `ACCOUNT-${owner}`);
    assert.ok(result.data.cookie.includes(`auth=COOKIE_SENTINEL-${owner}-${version}`));
  }
  return { f, backend, api, connection, login, query, check, latest, rejected, rejectedRefresh,
    rotateCookies() { cookieVersion++; }, block() { block = true; }, unblock() { block = false; }, blocked: blocked.promise, aborted: aborted.promise };
}

test('owned A1/A2/B1 sessions survive child restarts, refresh, sign-in, expiration and deletion', async t => {
  const h = await acceptanceFixture(t), { f, backend } = h;
  const a1 = await h.connection(f.a), a2 = await h.connection(f.a), b1 = await h.connection(f.b);
  const records = [[f.a, a1, 'a1@example.test'], [f.a, a2, 'a2@example.test'], [f.b, b1, 'b1@example.test']] as const;
  for (const [user, id, owner] of records) {
    await h.login(user, id, owner);
    await h.check(user, id, owner);
    const row = JSON.stringify(await f.readSessionRow(id));
    for (const plaintext of ['PASSWORD_SENTINEL', '123456', 'ACCESS_SENTINEL', 'REFRESH_SENTINEL', 'COOKIE_SENTINEL', owner, `ACCOUNT-${owner}`]) assert.ok(!row.includes(plaintext));
    const foreign = user === f.a ? f.b : f.a;
    for (const [suffix, method, body] of [
      ['', 'GET', undefined], ['', 'PATCH', { label: 'foreign' }],
      ['/session', 'GET', undefined], ['/session', 'POST', { email: owner, password: 'PASSWORD_SENTINEL' }],
      ['/session', 'DELETE', undefined], ['/graphql', 'POST', { query: 'query { identity { id } }' }], ['', 'DELETE', undefined],
    ] as const) assert.equal((await h.api(foreign, id, suffix, method, body)).status, 404);
  }
  await backend.restart();
  for (const [user, id, owner] of records) await h.check(user, id, owner);
  h.rotateCookies();
  for (const [, , owner] of records) h.rejected.add(h.latest.get(owner)!.access);
  for (const [user, id, owner] of records) await h.check(user, id, owner);
  await backend.restart();
  for (const [user, id, owner] of records) await h.check(user, id, owner);
  await f.a.signOut(); await f.a.signIn();
  for (const [user, id, owner] of records) await h.check(user, id, owner);
  await t.test('provider sessions survive local Supabase stop/start with retained volumes', async sub => {
    if (process.env.FINSIGHT_TEST_RESTART_SUPABASE !== '1') return sub.skip('Set FINSIGHT_TEST_RESTART_SUPABASE=1 for full acceptance.');
    const { restartLocalSupabase } = await import('./supabase-fixture.js');
    await restartLocalSupabase();
    await f.a.signIn(); await f.b.signIn();
    await backend.restart();
    for (const [user, id, owner] of records) await h.check(user, id, owner);
  });
  h.rejected.add(h.latest.get('a1@example.test')!.access); h.rejectedRefresh.add('a1@example.test');
  assert.equal((await h.query(f.a, a1)).status, 401);
  assert.deepEqual(await (await h.api(f.a, a1, '/session')).json(), { status: 'expired' });
  assert.deepEqual(await f.sessionStore.load(a1, signal()), { state: 'expired', envelope: null });
  await backend.restart();
  assert.deepEqual(await (await h.api(f.a, a1, '/session')).json(), { status: 'expired' });
  h.rejectedRefresh.delete('a1@example.test');
  await h.login(f.a, a1, 'a1@example.test');
  await h.check(f.a, a1, 'a1@example.test');
  assert.equal((await h.api(f.a, a1, '', 'DELETE')).status, 204);
  assert.equal(await f.sessionStore.load(a1, signal()), null);
  await h.check(f.b, b1, 'b1@example.test');
  await f.deleteOwnedTestUser(f.a.id);
  assert.equal(await f.sessionStore.load(a2, signal()), null);
  await h.check(f.b, b1, 'b1@example.test');
});

test('SIGTERM during blocked provider request preserves saved sessions', async t => {
  const h = await acceptanceFixture(t), { f, backend } = h;
  const a1Id = await h.connection(f.a);
  await h.login(f.a, a1Id, 'a1@example.test');
  h.block();
  const pending = h.query(f.a, a1Id).catch(() => undefined);
  await h.blocked;
  const started = performance.now();
  await backend.stop(); // Helper requires the child's IPC SIGTERM barrier before exit.
  const elapsedMs = performance.now() - started;
  const childExitCode = backend.exitCode;
  t.diagnostic(`SIGTERM exit ${childExitCode}; graceful shutdown ${Math.round(elapsedMs)}ms`);
  assert.equal(childExitCode, 0);
  assert.ok(elapsedMs < 10_000);
  await h.aborted;
  await pending;
  assert.notEqual(await f.sessionStore.load(a1Id, signal()), null);
  h.unblock();
  await backend.restart();
  const afterRestartQuery = await h.query(f.a, a1Id);
  assert.equal(afterRestartQuery.status, 200);
});
