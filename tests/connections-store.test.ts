import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseConnectionStoreFactory } from "../src/connections/store.js";
import { authConfig } from "./auth-fixtures.js";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const identity = { user: { id: owner, email: null }, accessToken: "a" };
const row = {
  id,
  user_id: owner,
  provider_id: "wealthsimple",
  label: null,
  created_at: "2026-11-03T00:00:00.123456+00:00",
  updated_at: "2026-11-03T00:00:00Z",
};
test("failed inserts never retry and downstream failures are sanitized", async () => {
  for (const status of [401, 404, 503, 0]) {
    let calls = 0;
    const factory = createSupabaseConnectionStoreFactory(authConfig, {
      fetch: async () => {
        calls++;
        if (!status) throw new Error("PRIVATE");
        return Response.json({ message: "PRIVATE" }, { status });
      },
    });
    await assert.rejects(
      factory(identity, new AbortController().signal).create({
        providerId: "wealthsimple",
        label: null,
      }),
      {
        code:
          status === 401 ? "UNAUTHENTICATED" : "CONNECTION_STORAGE_UNAVAILABLE",
      },
    );
    assert.equal(calls, 1);
  }
});
test("stores send per-user JWTs, owner filters, and only allowed write columns", async () => {
  const requests: { url: URL; init: RequestInit }[] = [];
  const factory = createSupabaseConnectionStoreFactory(authConfig, {
    fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), init: init! });
      return Response.json(init?.method === "POST" ? [row] : []);
    },
  });
  const a = factory(identity, new AbortController().signal),
    b = factory(
      { user: { id, email: null }, accessToken: "b" },
      new AbortController().signal,
    );
  await a.create({ providerId: "wealthsimple", label: null });
  await Promise.all([a.get(id), b.get(id)]);
  assert.equal(await a.rename(id, "x"), null);
  assert.equal(await a.remove(id), false);
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    provider_id: "wealthsimple",
    label: null,
  });
  for (const r of requests.slice(1)) {
    assert.ok(r.url.searchParams.get("user_id"));
    assert.equal(r.url.searchParams.get("id"), `eq.${id}`);
    assert.notEqual(r.url.searchParams.get("select"), "*");
  }
  assert.equal(
    new Headers(requests[1].init.headers).get("authorization"),
    "Bearer a",
  );
  assert.equal(
    new Headers(requests[2].init.headers).get("authorization"),
    "Bearer b",
  );
  assert.deepEqual(JSON.parse(String(requests[3].init.body)), { label: "x" });
});
test("lookahead uses last returned row and preserves timestamp precision", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({
    ...row,
    id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
  }));
  let url: URL | undefined;
  const factory = createSupabaseConnectionStoreFactory(authConfig, {
    fetch: async (input) => {
      url = new URL(String(input));
      return Response.json(rows);
    },
  });
  const page = await factory(identity, new AbortController().signal).list({
    limit: 50,
    after: { createdAt: row.created_at, id },
  });
  assert.equal(page.connections.length, 50);
  assert.equal(
    JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString()).id,
    rows[49].id,
  );
  assert.equal(url!.searchParams.get("limit"), "51");
  assert.ok(url!.searchParams.get("or")!.includes(".123456+00:00"));
});
test("storage deadlines and caller abort cancel pending SDK requests", async () => {
  for (const cancel of [false, true]) {
    const abort = new AbortController();
    let observed = false;
    const factory = createSupabaseConnectionStoreFactory(authConfig, {
      timeoutMs: 20,
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) => {
          if (init!.signal!.aborted) {
            observed = true;
            reject(new Error("aborted"));
            return;
          }
          init!.signal!.addEventListener(
            "abort",
            () => {
              observed = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    });
    const result = factory(identity, abort.signal).get(id);
    if (cancel) abort.abort();
    const keepAlive = setTimeout(() => {}, 100);
    await assert.rejects(result, { code: "CONNECTION_STORAGE_UNAVAILABLE" });
    clearTimeout(keepAlive);
    assert.equal(observed, true);
  }
});
test("malformed successful data is unavailable rather than exposing diagnostics", async () => {
  for (const data of [
    null,
    {},
    [{ ...row, user_id: id }],
    [{ ...row, created_at: "PRIVATE" }],
  ]) {
    const factory = createSupabaseConnectionStoreFactory(authConfig, {
      fetch: async () => Response.json(data),
    });
    await assert.rejects(
      factory(identity, new AbortController().signal).get(id),
      { code: "CONNECTION_STORAGE_UNAVAILABLE" },
    );
  }
  const factory = createSupabaseConnectionStoreFactory(authConfig, {
    fetch: async () => Response.json([]),
  });
  assert.deepEqual(
    await factory(identity, new AbortController().signal).list({
      limit: 50,
      after: null,
    }),
    { connections: [], nextCursor: null },
  );
});
