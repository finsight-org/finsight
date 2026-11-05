import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SessionError } from "./model.js";
import type { EncryptedSessionEnvelope, SessionBinding } from "./model.js";

export interface SessionCipher {
  encrypt(binding: SessionBinding, plaintext: string): EncryptedSessionEnvelope;
  decrypt(binding: SessionBinding, envelope: unknown): string;
}

const maxPlaintextBytes = 256 * 1024;
const maxCiphertextCharacters = Math.ceil(maxPlaintextBytes / 3) * 4;
const unavailable = () => new SessionError("SESSION_STATE_UNAVAILABLE");

function associatedData(binding: SessionBinding): Buffer {
  return Buffer.from(
    JSON.stringify([
      "finsight.provider-session",
      1,
      binding.userId,
      binding.connectionId,
      binding.providerId,
    ]),
  );
}

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw unavailable();
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw unavailable();
  return decoded;
}

function decodeEnvelope(value: unknown): {
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw unavailable();
  const envelope = value as Record<string, unknown>;
  // Bound every encoded field before decoding or attempting authenticated decryption.
  if (
    envelope.version !== 1 ||
    typeof envelope.nonce !== "string" ||
    envelope.nonce.length !== 16 ||
    typeof envelope.tag !== "string" ||
    envelope.tag.length !== 24 ||
    typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length > maxCiphertextCharacters
  )
    throw unavailable();
  const nonce = decodeBase64(envelope.nonce);
  const tag = decodeBase64(envelope.tag);
  const ciphertext = decodeBase64(envelope.ciphertext);
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > maxPlaintextBytes)
    throw unavailable();
  return { nonce, tag, ciphertext };
}

export function createSessionCipher(key: Uint8Array): SessionCipher {
  if (key.byteLength !== 32) throw new SessionError("SESSION_NOT_CONFIGURED");
  const secret = Buffer.from(key);
  return {
    encrypt(binding, plaintext) {
      try {
        if (Buffer.byteLength(plaintext, "utf8") > maxPlaintextBytes)
          throw unavailable();
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", secret, nonce);
        cipher.setAAD(associatedData(binding));
        const ciphertext = Buffer.concat([
          cipher.update(plaintext, "utf8"),
          cipher.final(),
        ]);
        return {
          version: 1,
          nonce: nonce.toString("base64"),
          ciphertext: ciphertext.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
        };
      } catch {
        throw unavailable();
      }
    },
    decrypt(binding, envelope) {
      try {
        const { nonce, ciphertext, tag } = decodeEnvelope(envelope);
        const decipher = createDecipheriv("aes-256-gcm", secret, nonce);
        decipher.setAAD(associatedData(binding));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext);
      } catch {
        throw unavailable();
      }
    },
  };
}
