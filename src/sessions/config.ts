import { readFile } from "node:fs/promises";
import { SessionError } from "./model.js";

export interface SessionConfig {
  supabaseSecretKey: string;
  encryptionKey: Uint8Array;
}

export async function readSessionConfig(
  env: NodeJS.ProcessEnv,
  authConfigured: boolean,
): Promise<SessionConfig | undefined> {
  const secret = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const encoded = env.FINSIGHT_SESSION_ENCRYPTION_KEY?.trim() ?? "";
  const file = env.FINSIGHT_SESSION_ENCRYPTION_KEY_FILE?.trim() ?? "";
  if (!secret && !encoded && !file) return undefined;
  try {
    if (
      !authConfigured ||
      !secret.startsWith("sb_secret_") ||
      secret.length <= "sb_secret_".length ||
      Boolean(encoded) === Boolean(file)
    ) {
      throw new Error();
    }
    const value = file ? (await readFile(file, "utf8")).trim() : encoded;
    // A 32-byte key has exactly 43 data characters and one padding character.
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error();
    const encryptionKey = Buffer.from(value, "base64");
    if (encryptionKey.length !== 32 || encryptionKey.toString("base64") !== value)
      throw new Error();
    return { supabaseSecretKey: secret, encryptionKey };
  } catch {
    throw new SessionError("SESSION_NOT_CONFIGURED");
  }
}
