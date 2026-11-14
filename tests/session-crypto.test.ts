import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { test } from "node:test";
import { createSessionCipher } from "../src/sessions/crypto.js";
import { SessionError, type EncryptedSessionEnvelope } from "../src/sessions/model.js";

const key = new Uint8Array(32).fill(23);
const binding = { userId: "user-a", connectionId: "connection-a", providerId: "wealthsimple" };
const plaintext = '{"access":"ACCESS_SENTINEL","refresh":"REFRESH_SENTINEL"}';
const unavailable = { code: "SESSION_STATE_UNAVAILABLE", statusCode: 503 };
const maxBytes = 256 * 1024;

function rawEnvelope(bytes: Uint8Array): EncryptedSessionEnvelope {
  const nonce = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from('["finsight.provider-session",1,"user-a","connection-a","wealthsimple"]'));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { version: 1, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function changeBase64(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

test("session encryption round trips secrets with fresh nonces and standard GCM sizes", () => {
  const cipher = createSessionCipher(key);
  const envelope = cipher.encrypt(binding, plaintext);
  assert.equal(cipher.decrypt(binding, envelope), plaintext);
  assert.notDeepEqual(cipher.encrypt(binding, plaintext), cipher.encrypt(binding, plaintext));
  assert.equal(Buffer.from(envelope.nonce, "base64").length, 12);
  assert.equal(Buffer.from(envelope.tag, "base64").length, 16);
  assert.doesNotMatch(JSON.stringify(envelope), /ACCESS_SENTINEL|REFRESH_SENTINEL/);
  assert.equal(cipher.decrypt(binding, rawEnvelope(Buffer.from(plaintext))), plaintext);
});

for (const field of ["userId", "connectionId", "providerId"] as const) {
  test(`session authentication rejects the wrong ${field}`, () => {
    const cipher = createSessionCipher(key);
    assert.throws(() => cipher.decrypt({ ...binding, [field]: "other" }, cipher.encrypt(binding, plaintext)), unavailable);
  });
}

test("session authentication rejects the wrong key without disclosing secrets", () => {
  const envelope = createSessionCipher(key).encrypt(binding, plaintext);
  assert.throws(() => createSessionCipher(new Uint8Array(32).fill(24)).decrypt(binding, envelope), (error: unknown) => {
    assert.ok(error instanceof SessionError);
    assert.equal(error.code, "SESSION_STATE_UNAVAILABLE");
    assert.equal(error.statusCode, 503);
    assert.doesNotMatch(String(error), /ACCESS_SENTINEL|REFRESH_SENTINEL/);
    return true;
  });
});

for (const field of ["nonce", "tag", "ciphertext"] as const) {
  test(`session authentication rejects modified ${field}`, () => {
    const cipher = createSessionCipher(key);
    const envelope = cipher.encrypt(binding, plaintext);
    assert.throws(() => cipher.decrypt(binding, { ...envelope, [field]: changeBase64(envelope[field]) }), unavailable);
  });
}

test("session decoding rejects malformed envelopes and unknown versions", () => {
  const cipher = createSessionCipher(key);
  const envelope = cipher.encrypt(binding, plaintext);
  for (const invalid of [null, [], {}, { ...envelope, version: 2 }, { ...envelope, nonce: 1 }, { ...envelope, tag: null }, { ...envelope, ciphertext: {} }, { ...envelope, nonce: Buffer.alloc(11).toString("base64") }, { ...envelope, tag: Buffer.alloc(15).toString("base64") }]) {
    assert.throws(() => cipher.decrypt(binding, invalid), unavailable);
  }
});

test("session decoding rejects noncanonical standard base64", () => {
  const cipher = createSessionCipher(key);
  const envelope = cipher.encrypt(binding, "x");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const ciphertextPadBits =
    envelope.ciphertext.slice(0, -3) +
    alphabet[alphabet.indexOf(envelope.ciphertext.at(-3)!) + 1] + "==";
  assert.deepEqual(Buffer.from(ciphertextPadBits, "base64"), Buffer.from(envelope.ciphertext, "base64"));
  for (const invalid of [
    { ...envelope, nonce: envelope.nonce + "\n" },
    { ...envelope, tag: envelope.tag.replace(/=+$/, "") },
    { ...envelope, ciphertext: ciphertextPadBits },
    { ...envelope, ciphertext: "-w==" }, // URL alphabet
    { ...envelope, ciphertext: "!!!!" },
  ]) assert.throws(() => cipher.decrypt(binding, invalid), unavailable);
});

test("session encryption enforces the 256 KiB UTF-8 byte boundary", () => {
  const cipher = createSessionCipher(key);
  for (const value of ["x".repeat(maxBytes), "é".repeat(maxBytes / 2), ""]) {
    assert.equal(cipher.decrypt(binding, cipher.encrypt(binding, value)), value);
  }
  for (const value of ["x".repeat(maxBytes + 1), "é".repeat(maxBytes / 2) + "x"]) {
    assert.throws(() => cipher.encrypt(binding, value), unavailable);
  }
});

test("session decoding rejects oversized encrypted input", () => {
  const cipher = createSessionCipher(key);
  const envelope = cipher.encrypt(binding, "x");
  for (const field of ["nonce", "tag", "ciphertext"] as const) {
    assert.throws(() => cipher.decrypt(binding, { ...envelope, [field]: "A".repeat(400_000) }), unavailable);
  }
  // The first excess bytes can share the permitted ciphertext's encoded length.
  assert.throws(() => cipher.decrypt(binding, rawEnvelope(Buffer.alloc(maxBytes + 1))), unavailable);
});

test("session decoding rejects authenticated invalid UTF-8 plaintext", () => {
  assert.throws(() => createSessionCipher(key).decrypt(binding, rawEnvelope(Buffer.from([0xc3, 0x28]))), unavailable);
});

for (const length of [31, 33]) {
  test(`session cipher rejects a ${length}-byte key`, () => {
    assert.throws(() => createSessionCipher(new Uint8Array(length)), { code: "SESSION_NOT_CONFIGURED", statusCode: 503 });
  });
}

test("session errors expose only safe messages and required HTTP status codes", () => {
  for (const code of ["SESSION_NOT_CONFIGURED", "SESSION_STORAGE_UNAVAILABLE", "SESSION_STATE_UNAVAILABLE", "SESSION_SERVICE_CLOSED"] as const) {
    assert.equal(new SessionError(code).statusCode, 503);
  }
  for (const code of ["CONNECTION_ALREADY_CONNECTED", "CONNECTION_PROVIDER_UNSUPPORTED"] as const) {
    assert.equal(new SessionError(code).statusCode, 409);
  }
});
