import type { DurableSession } from "./model.js";

export interface SessionStore {
  load(connectionId: string, signal: AbortSignal): Promise<DurableSession | null>;
  save(
    connectionId: string,
    state: DurableSession,
    signal: AbortSignal,
  ): Promise<void>;
  remove(connectionId: string, signal: AbortSignal): Promise<void>;
}
