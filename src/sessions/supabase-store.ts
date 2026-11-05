import { createClient } from "@supabase/supabase-js";
import { SessionError, type DurableSession, type EncryptedSessionEnvelope } from "./model.js";
import type { SessionStore } from "./store.js";

const unavailable = () => new SessionError("SESSION_STORAGE_UNAVAILABLE");
const maxCiphertextBytes = 256 * 1024;
const maxCiphertextCharacters = Math.ceil(maxCiphertextBytes / 3) * 4;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}
function base64(value: unknown, maxCharacters: number): Buffer {
  if (typeof value !== "string" || value.length > maxCharacters ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw unavailable();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw unavailable();
  return bytes;
}
function envelope(value: unknown): EncryptedSessionEnvelope {
  const v = record(value);
  if (Object.keys(v).length !== 4 || v.version !== 1 ||
    base64(v.nonce, 16).length !== 12 || base64(v.tag, 24).length !== 16 ||
    base64(v.ciphertext, maxCiphertextCharacters).length > maxCiphertextBytes) throw unavailable();
  return { version: 1, nonce: v.nonce as string, tag: v.tag as string, ciphertext: v.ciphertext as string };
}
function state(value: unknown): DurableSession {
  const v = record(value);
  if (v.state === "expired" && v.envelope === null) return { state: "expired", envelope: null };
  if (v.state === "connected") return { state: "connected", envelope: envelope(v.envelope) };
  throw unavailable();
}

export function createSupabaseSessionStore(
  config: { supabaseUrl: string; secretKey: string },
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): SessionStore {
  // This client never receives user authentication or a browser session.
  const client = createClient(config.supabaseUrl, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { retry: false },
    global: { fetch: (input, init) => (options.fetch ?? globalThis.fetch)(input, { ...init, redirect: "error" }) },
  });
  const table = () => client.from("provider_sessions");
  async function execute(query: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 5000)]);
    combined.throwIfAborted();
    const result = await query(combined);
    if (result.error) throw unavailable();
    return result.data;
  }
  return {
    async load(connectionId, signal) {
      try {
        const data = await execute((combined) => table().select("connection_id,state,encrypted_session").eq("connection_id", connectionId).abortSignal(combined).maybeSingle(), signal);
        if (data === null) return null;
        const row = record(data);
        if (row.connection_id !== connectionId) throw unavailable();
        return state({ state: row.state, envelope: row.encrypted_session });
      } catch { throw unavailable(); }
    },
    async save(connectionId, value, signal) {
      try {
        const validated = state(value);
        await execute((combined) => table().upsert({ connection_id: connectionId, state: validated.state, encrypted_session: validated.envelope }, { onConflict: "connection_id" }).abortSignal(combined), signal);
      } catch { throw unavailable(); }
    },
    async remove(connectionId, signal) {
      try { await execute((combined) => table().delete().eq("connection_id", connectionId).abortSignal(combined), signal); }
      catch { throw unavailable(); }
    },
  };
}
