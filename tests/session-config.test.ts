import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readSessionConfig } from "../src/sessions/config.js";

const key = Buffer.alloc(32, 23);
const encodedKey = key.toString("base64");
const secret = "sb_secret_SECRET_SENTINEL";
const valid = { SUPABASE_SECRET_KEY: secret, FINSIGHT_SESSION_ENCRYPTION_KEY: encodedKey };
const invalid = { code: "SESSION_NOT_CONFIGURED", statusCode: 503 };

test("session configuration is disabled when all session values are missing", async () => {
  assert.equal(await readSessionConfig({}, false), undefined);
  assert.equal(await readSessionConfig({}, true), undefined);
});

test("session configuration accepts a trimmed environment key and secret with Auth", async () => {
  const config = await readSessionConfig({ SUPABASE_SECRET_KEY: ` ${secret}\n`, FINSIGHT_SESSION_ENCRYPTION_KEY: `\n${encodedKey} ` }, true);
  assert.equal(config?.supabaseSecretKey, secret);
  assert.deepEqual(Buffer.from(config!.encryptionKey), key);
});

test("session configuration accepts a local key file ending in a newline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finsight-session-"));
  try {
    const file = join(directory, "key");
    await writeFile(file, `${encodedKey}\n`);
    const config = await readSessionConfig({ SUPABASE_SECRET_KEY: secret, FINSIGHT_SESSION_ENCRYPTION_KEY_FILE: file }, true);
    assert.deepEqual(Buffer.from(config!.encryptionKey), key);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session configuration rejects partial settings", async () => {
  for (const env of [{ SUPABASE_SECRET_KEY: secret }, { FINSIGHT_SESSION_ENCRYPTION_KEY: encodedKey }, { FINSIGHT_SESSION_ENCRYPTION_KEY_FILE: "missing" }]) {
    await assert.rejects(readSessionConfig(env, true), invalid);
  }
});

test("session configuration rejects both key sources", async () => {
  await assert.rejects(readSessionConfig({ ...valid, FINSIGHT_SESSION_ENCRYPTION_KEY_FILE: "missing" }, true), invalid);
});

test("session configuration requires existing Auth", async () => {
  await assert.rejects(readSessionConfig(valid, false), invalid);
});

test("session configuration requires a Supabase secret key", async () => {
  for (const value of ["sb_publishable_SECRET_SENTINEL", "service_role_SECRET_SENTINEL", "sb_secret_"]) {
    await assert.rejects(readSessionConfig({ ...valid, SUPABASE_SECRET_KEY: value }, true), invalid);
  }
});

for (const length of [31, 33]) {
  test(`session configuration rejects a ${length}-byte encryption key`, async () => {
    await assert.rejects(readSessionConfig({ ...valid, FINSIGHT_SESSION_ENCRYPTION_KEY: Buffer.alloc(length).toString("base64") }, true), invalid);
  });
}

test("session configuration rejects noncanonical base64 keys", async () => {
  for (const value of [encodedKey.slice(0, -1), encodedKey.slice(0, -2) + "d=", "-".repeat(43) + "=", encodedKey.slice(0, 4) + "\n" + encodedKey.slice(4)]) {
    await assert.rejects(readSessionConfig({ ...valid, FINSIGHT_SESSION_ENCRYPTION_KEY: value }, true), invalid);
  }
});

test("missing key files and invalid key material produce sanitized startup errors", async () => {
  for (const env of [
    { ...valid, FINSIGHT_SESSION_ENCRYPTION_KEY: "ACCESS_SENTINEL_REFRESH_SENTINEL" },
    { SUPABASE_SECRET_KEY: secret, FINSIGHT_SESSION_ENCRYPTION_KEY_FILE: "/missing/ACCESS_SENTINEL_REFRESH_SENTINEL" },
  ]) {
    await assert.rejects(readSessionConfig(env, true), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(String(error), /SECRET_SENTINEL|ACCESS_SENTINEL|REFRESH_SENTINEL/);
      assert.equal((error as Error & { code: string }).code, "SESSION_NOT_CONFIGURED");
      return true;
    });
  }
});
