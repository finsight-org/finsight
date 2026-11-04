import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createLocalFixture } from "./supabase-fixture.js";
const table = "provider_connections";
test("owners can independently create duplicate-provider and duplicate-label records", async (t) => {
  const f = await createLocalFixture(t);
  const r = await f.a.client
    .from(table)
    .insert([
      { provider_id: "wealthsimple", label: "Personal" },
      { provider_id: "wealthsimple", label: "Personal" },
    ])
    .select();
  assert.equal(r.error, null);
  assert.equal(r.data!.length, 2);
  assert.equal(new Set(r.data!.map((x) => x.id)).size, 2);
  assert.ok(r.data!.every((x) => x.user_id === f.a.id));
  assert.equal(
    (await f.b.client.from(table).insert({ provider_id: "wealthsimple" }))
      .error,
    null,
  );
  assert.equal((await f.b.client.from(table).select()).data!.length, 1);
  const id = r.data![0].id;
  for (const q of [
    f.b.client.from(table).select().eq("id", id),
    f.b.client.from(table).update({ label: "stolen" }).eq("id", id).select(),
    f.b.client.from(table).delete().eq("id", id).select(),
  ]) {
    const v = await q;
    assert.equal(v.error, null);
    assert.deepEqual(v.data, []);
  }
  assert.equal(
    (await f.a.client.from(table).select().eq("id", id)).data![0].label,
    "Personal",
  );
  for (const field of [
    "id",
    "user_id",
    "provider_id",
    "created_at",
    "updated_at",
  ]) {
    const value =
      field === "provider_id"
        ? "other"
        : field.endsWith("_at")
          ? "2020-01-01T00:00:00Z"
          : crypto.randomUUID();
    assert.ok(
      (
        await f.a.client
          .from(table)
          .update({ [field]: value })
          .eq("id", id)
      ).error,
    );
    if (field !== "provider_id")
      assert.ok(
        (
          await f.a.client
            .from(table)
            .insert({ provider_id: "wealthsimple", [field]: value })
        ).error,
      );
  }
  for (const label of ["", " ", "\u00a0\ufeff", "😀".repeat(101)])
    assert.ok(
      (
        await f.a.client
          .from(table)
          .insert({ provider_id: "wealthsimple", label })
      ).error,
    );
  assert.equal(
    (
      await f.a.client
        .from(table)
        .insert({ provider_id: "historical-provider", label: "😀".repeat(100) })
    ).error,
    null,
  );
  const anon = createClient(f.config.supabaseUrl, f.config.publishableKey, {
    auth: { persistSession: false },
  });
  assert.ok((await anon.from(table).select()).error);
});

test("real sessions retain isolated IDs through sign-in, backend restart, and database restart", async (t) => {
  const { startCompiledBackend } = await import("./supabase-fixture.js");
  const f = await createLocalFixture(t),
    server = await startCompiledBackend(t, f.config);
  async function api(
    user: typeof f.a,
    path = "",
    method = "GET",
    body?: unknown,
  ) {
    return fetch(`${server.url}/api/connections${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function add(user: typeof f.a, label: string) {
    const r = await api(user, "", "POST", {
      providerId: "wealthsimple",
      label,
    });
    assert.equal(r.status, 201);
    return (await r.json()).connection;
  }
  const [a1, a2, b1] = await Promise.all([
    add(f.a, "First"),
    add(f.a, "Second"),
    add(f.b, "Other"),
  ]);
  await f.seedCreatedAt([a1.id, a2.id, b1.id], "2026-11-03T12:00:00.123456Z");
  for (const method of ["GET", "PATCH", "DELETE"])
    assert.equal(
      (
        await api(
          f.b,
          `/${a1.id}`,
          method,
          method === "PATCH" ? { label: "stolen" } : undefined,
        )
      ).status,
      404,
    );
  const first = await (await api(f.a, "?limit=1")).json();
  assert.equal(first.connections.length, 1);
  assert.ok(first.nextCursor);
  const second = await (
    await api(f.a, `?limit=1&cursor=${first.nextCursor}`)
  ).json();
  assert.equal(second.connections.length, 1);
  assert.notEqual(first.connections[0].id, second.connections[0].id);
  assert.equal(second.nextCursor, null);
  assert.equal(
    (await api(f.a, `/${a1.id}`, "PATCH", { label: "Renamed" })).status,
    200,
  );
  assert.equal(
    (await api(f.a, `/${a2.id}`, "PATCH", { label: null })).status,
    200,
  );
  async function check() {
    const a = await (await api(f.a)).json(),
      b = await (await api(f.b)).json();
    assert.deepEqual(
      a.connections.map((c: { id: string }) => c.id).sort(),
      [a1.id, a2.id].sort(),
    );
    assert.equal(
      a.connections.find((c: { id: string }) => c.id === a1.id).label,
      "Renamed",
    );
    assert.equal(
      a.connections.find((c: { id: string }) => c.id === a2.id).label,
      null,
    );
    assert.deepEqual(
      b.connections.map((c: { id: string }) => c.id),
      [b1.id],
    );
  }
  await f.a.signOut();
  await f.a.signIn();
  await check();
  await server.restart();
  await check();
  await t.test(
    "local database survives stop/start with retained volumes",
    async (sub) => {
      if (process.env.FINSIGHT_TEST_RESTART_SUPABASE !== "1") {
        sub.skip("Set FINSIGHT_TEST_RESTART_SUPABASE=1 for full acceptance.");
        return;
      }
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const run = promisify(execFile);
      await run("npm", ["run", "supabase:stop"]);
      await run("npm", ["run", "supabase:start"], { timeout: 180000 });
      await f.a.signIn();
      await f.b.signIn();
      await check();
    },
  );
  assert.equal((await api(f.a, `/${a2.id}`, "DELETE")).status, 204);
  assert.equal((await api(f.a, `/${a2.id}`)).status, 404);
  assert.equal((await api(f.b, `/${b1.id}`)).status, 200);
  assert.equal((await api(f.a, `/${a1.id}/graphql`)).status, 404);
  for (const path of ["/providers", "/mcp"])
    assert.equal(
      (
        await fetch(`${server.url}${path}`, {
          headers: { Origin: f.config.webOrigins[0] },
        })
      ).status,
      403,
    );
});
