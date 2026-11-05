import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseSessionStore } from "../src/sessions/supabase-store.js";
import { SessionError, type DurableSession } from "../src/sessions/model.js";

const id = "2b444444-4444-4444-8444-444444444444";
const connected: DurableSession = {
  state: "connected",
  envelope: { version: 1, nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AQID", tag: "AAAAAAAAAAAAAAAAAAAAAA==" },
};
const config = { supabaseUrl: "http://127.0.0.1:54321", secretKey: "sb_secret_test-private-key" };
const signal = () => new AbortController().signal;
function unavailable(error: unknown) {
  assert.ok(error instanceof SessionError);
  assert.equal(error.code, "SESSION_STORAGE_UNAVAILABLE");
  assert.equal(error.statusCode, 503);
  assert.equal(error.message, "Session storage is temporarily unavailable.");
  return true;
}
function fixture(responses: Response[]) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const store = createSupabaseSessionStore(config, {
    fetch: async (input, init = {}) => {
      requests.push({ url: new URL(String(input)), init });
      const response = responses.shift();
      assert.ok(response, "unexpected extra request");
      return response;
    },
  });
  return { store, requests };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

test("loads only the selected encrypted state for the requested connection", async () => {
  const f = fixture([json({ connection_id: id, state: "connected", encrypted_session: connected.envelope })]);
  assert.deepEqual(await f.store.load(id, signal()), connected);
  const r = f.requests[0];
  assert.equal(r.url.pathname, "/rest/v1/provider_sessions");
  assert.equal(r.url.searchParams.get("connection_id"), `eq.${id}`);
  assert.equal(r.url.searchParams.get("select"), "connection_id,state,encrypted_session");
  assert.equal(new Headers(r.init.headers).get("apikey"), config.secretKey);
  assert.equal(new Headers(r.init.headers).get("authorization"), `Bearer ${config.secretKey}`);
  assert.equal(r.init.redirect, "error");
});
test("missing and expired rows load without an envelope", async () => {
  const f = fixture([json(null), json({ connection_id: id, state: "expired", encrypted_session: null })]);
  assert.equal(await f.store.load(id, signal()), null);
  assert.deepEqual(await f.store.load(id, signal()), { state: "expired", envelope: null });
});
test("save replaces a row using encrypted data only and remove is idempotent", async () => {
  const f = fixture(Array.from({ length: 4 }, () => new Response(null, { status: 204 })));
  await f.store.save(id, connected, signal());
  await f.store.save(id, { state: "expired", envelope: null }, signal());
  await f.store.remove(id, signal());
  await f.store.remove(id, signal());
  assert.deepEqual(JSON.parse(String(f.requests[0].init.body)), { connection_id: id, state: "connected", encrypted_session: connected.envelope });
  assert.deepEqual(JSON.parse(String(f.requests[1].init.body)), { connection_id: id, state: "expired", encrypted_session: null });
  assert.equal(f.requests[0].url.searchParams.get("on_conflict"), "connection_id");
  assert.match(new Headers(f.requests[0].init.headers).get("prefer")!, /resolution=merge-duplicates/);
  for (const r of f.requests.slice(2)) {
    assert.equal(r.init.method, "DELETE");
    assert.equal(r.url.searchParams.get("connection_id"), `eq.${id}`);
  }
});
test("malformed, oversized, or foreign rows fail closed", async () => {
  const row = { connection_id: id, state: "connected", encrypted_session: connected.envelope };
  for (const bad of [
    {}, { ...row, connection_id: crypto.randomUUID() }, { ...row, state: "other" },
    { ...row, encrypted_session: null }, { ...row, state: "expired" },
    ...[ { ...connected.envelope, version: 2 }, { ...connected.envelope, nonce: "!".repeat(16) },
      { ...connected.envelope, tag: "A".repeat(24) }, { ...connected.envelope, ciphertext: "A".repeat(349532) },
      { ...connected.envelope, ciphertext: "!!!!" }, { ...connected.envelope, plaintext: "secret" } ]
      .map((encrypted_session) => ({ ...row, encrypted_session })),
  ]) await assert.rejects(fixture([json(bad)]).store.load(id, signal()), unavailable);
});
test("invalid state cannot send plaintext or make a mutation", async () => {
  const f = fixture([]);
  await assert.rejects(f.store.save(id, { state: "connected", envelope: { plaintext: "token" } } as unknown as DurableSession, signal()), unavailable);
  assert.equal(f.requests.length, 0);
});
test("pre-aborted operations never contact storage", async () => {
  const f = fixture([]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.store.load(id, controller.signal), unavailable);
  await assert.rejects(f.store.save(id, connected, controller.signal), unavailable);
  await assert.rejects(f.store.remove(id, controller.signal), unavailable);
  assert.equal(f.requests.length, 0);
});
test("HTTP failures, secret-key rejection and transport errors are sanitized without retries", async () => {
  for (const method of ["load", "save", "remove"] as const) {
    for (const status of [401, 403, 500, 503]) {
      const f = fixture([json({ message: "private-secret-token", details: "database detail" }, status)]);
      const op = method === "save" ? f.store.save(id, connected, signal()) : f.store[method](id, signal());
      await assert.rejects(op, unavailable);
      assert.equal(f.requests.length, 1);
    }
  }
  const store = createSupabaseSessionStore(config, { fetch: async () => { throw new Error("private token"); } });
  await assert.rejects(store.load(id, signal()), unavailable);
});
test("operation abort and timeout interrupt pending storage requests", async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController();
    const store = createSupabaseSessionStore(config, { timeoutMs: 15, fetch: async (_input, init) => new Promise((_resolve, reject) => {
      if (init!.signal!.aborted) { reject(new Error("secret abort")); return; }
      init!.signal!.addEventListener("abort", () => reject(new Error("secret abort")), { once: true });
    }) });
    const pending = store.load(id, controller.signal);
    if (abort) controller.abort();
    // Keep the event loop alive while AbortSignal.timeout's unref'ed timer runs.
    const timer = setTimeout(() => {}, 1000);
    try { await assert.rejects(pending, unavailable); } finally { clearTimeout(timer); }
  }
});
