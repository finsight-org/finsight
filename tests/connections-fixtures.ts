import { createApp } from "../src/app.js";
import { authConfig } from "./auth-fixtures.js";
import { libraryProvider } from "./fixtures.js";
import type { ConnectionRecord } from "../src/connections/model.js";
import type { ConnectionStoreFactory } from "../src/connections/store.js";
export function connectionApiFixture() {
  const data = new Map<string, { owner: string; record: ConnectionRecord }>(),
    calls: unknown[] = [];
  const { provider, state } = libraryProvider();
  const factory: ConnectionStoreFactory = (identity, signal) => {
    calls.push({ owner: identity.user.id, signal });
    const owned = (id: string) => {
      const v = data.get(id);
      return v?.owner === identity.user.id ? v.record : null;
    };
    return {
      async create(input) {
        const record = {
          ...input,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        data.set(record.id, { owner: identity.user.id, record });
        return record;
      },
      async get(id) {
        return owned(id);
      },
      async list() {
        return {
          connections: [...data.values()]
            .filter((v) => v.owner === identity.user.id)
            .map((v) => v.record),
          nextCursor: null,
        };
      },
      async rename(id, label) {
        const record = owned(id);
        if (record) record.label = label;
        return record;
      },
      async remove(id) {
        return owned(id) !== null && data.delete(id);
      },
    };
  };
  const options = {
    auth: authConfig,
    createConnectionStore: factory,
    verifyAccessToken: async (token: string) => ({
      status: "authenticated" as const,
      user: { id: token, email: null },
    }),
  };
  return {
    app: createApp([provider], options),
    calls,
    state,
    withoutProvider: () => createApp([], options),
  };
}
