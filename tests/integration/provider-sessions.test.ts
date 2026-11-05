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
