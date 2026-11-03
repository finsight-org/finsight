import { createClient } from "@supabase/supabase-js";
import type { AuthConfig, RequestIdentity } from "../auth.js";
import {
  ConnectionError,
  encodeConnectionCursor,
  mapConnectionRow,
  type ConnectionRecord,
  type CreateConnectionInput,
  type ListConnectionsInput,
  type ConnectionPage,
} from "./model.js";
export interface ConnectionStore {
  create(input: CreateConnectionInput): Promise<ConnectionRecord>;
  list(input: ListConnectionsInput): Promise<ConnectionPage>;
  get(id: string): Promise<ConnectionRecord | null>;
  rename(id: string, label: string | null): Promise<ConnectionRecord | null>;
  remove(id: string): Promise<boolean>;
}
export type ConnectionStoreFactory = (
  identity: RequestIdentity,
  signal: AbortSignal,
) => ConnectionStore;
const columns = "id,user_id,provider_id,label,created_at,updated_at";
export function createSupabaseConnectionStoreFactory(
  config: AuthConfig,
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): ConnectionStoreFactory {
  return (identity, signal) => {
    const client = createClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: false },
      global: {
        headers: { Authorization: `Bearer ${identity.accessToken}` },
        fetch: (input, init) =>
          (options.fetch ?? globalThis.fetch)(input, {
            ...init,
            redirect: "error",
          }),
      },
    });
    const table = () => client.from("provider_connections");
    async function rows(query: {
      abortSignal(
        signal: AbortSignal,
      ): PromiseLike<{ data: unknown; error: unknown; status: number }>;
    }): Promise<ConnectionRecord[]> {
      try {
        const result = await query.abortSignal(
          AbortSignal.any([
            signal,
            AbortSignal.timeout(options.timeoutMs ?? 5000),
          ]),
        );
        if (result.status === 401) throw new ConnectionError("UNAUTHENTICATED");
        if (result.error || !Array.isArray(result.data))
          throw new ConnectionError("CONNECTION_STORAGE_UNAVAILABLE");
        return result.data.map((row) =>
          mapConnectionRow(row, identity.user.id),
        );
      } catch (error) {
        if (error instanceof ConnectionError) throw error;
        throw new ConnectionError("CONNECTION_STORAGE_UNAVAILABLE");
      }
    }
    async function one(
      query: Parameters<typeof rows>[0],
    ): Promise<ConnectionRecord | null> {
      const r = await rows(query);
      if (r.length > 1)
        throw new ConnectionError("CONNECTION_STORAGE_UNAVAILABLE");
      return r[0] ?? null;
    }
    return {
      async create(input) {
        const r = await one(
          table()
            .insert({ provider_id: input.providerId, label: input.label })
            .select(columns),
        );
        if (!r) throw new ConnectionError("CONNECTION_STORAGE_UNAVAILABLE");
        return r;
      },
      async get(id) {
        return one(
          table().select(columns).eq("user_id", identity.user.id).eq("id", id),
        );
      },
      async rename(id, label) {
        return one(
          table()
            .update({ label })
            .eq("user_id", identity.user.id)
            .eq("id", id)
            .select(columns),
        );
      },
      async remove(id) {
        return (
          (await one(
            table()
              .delete()
              .eq("user_id", identity.user.id)
              .eq("id", id)
              .select(columns),
          )) !== null
        );
      },
      async list(input) {
        let query = table().select(columns).eq("user_id", identity.user.id);
        if (input.after) {
          const { createdAt, id } = input.after;
          query = query.or(
            `created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`,
          );
        }
        const result = await rows(
          query
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(input.limit + 1),
        );
        if (result.length > input.limit + 1)
          throw new ConnectionError("CONNECTION_STORAGE_UNAVAILABLE");
        const connections = result.slice(0, input.limit),
          last = connections.at(-1);
        return {
          connections,
          nextCursor:
            result.length > input.limit && last
              ? encodeConnectionCursor({
                  createdAt: last.createdAt,
                  id: last.id,
                })
              : null,
        };
      },
    };
  };
}
