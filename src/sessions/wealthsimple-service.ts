import { isDeepStrictEqual } from 'node:util';
import {
  WealthsimpleClient, WealthsimpleError, type GraphQLRequest, type LoginInput,
} from '../providers/wealthsimple/client.js';
import { parseWealthsimpleSnapshot, type WealthsimpleSnapshot } from '../providers/wealthsimple/snapshot.js';
import type { SessionCipher } from './crypto.js';
import { SessionError, type DurableSession, type SessionBinding, type SessionStatus } from './model.js';
import { ConnectionQueue } from './queue.js';
import type { SessionStore } from './store.js';

export interface SessionAccess {
  binding: SessionBinding;
  checkOwnership(signal: AbortSignal): Promise<void>;
}

export interface WealthsimpleSessionServiceOptions {
  store: SessionStore;
  cipher: SessionCipher;
  createClient?: () => WealthsimpleClient;
  now?: () => number;
}

interface Entry {
  binding: SessionBinding;
  client: WealthsimpleClient;
  expired: boolean;
  needsValidation: boolean;
  active: boolean;
  lastUsed: number;
}

const maxIdleEntries = 256;
const idleMs = 15 * 60 * 1000;
const persistenceTimeoutMs = 5000;

// Shared refresh can outlive a cancelled waiter. Wait for the entire operation
// in the slot, and use abortUpstream to cancel the actual network requests.
const providerWait = new AbortController().signal;

function comparable(snapshot: WealthsimpleSnapshot | null) {
  if (!snapshot) return null;
  // Cookie reads update lastAccessed even when the auth material is unchanged.
  const jar = snapshot.cookies!;
  return { ...snapshot, cookies: { ...jar, cookies: jar.cookies.map(({ lastAccessed, ...cookie }) => cookie) } };
}

async function storage<T>(work: () => Promise<T>) {
  try { return await work(); }
  catch { throw new SessionError('SESSION_STORAGE_UNAVAILABLE'); }
}

export class WealthsimpleSessionService {
  private readonly queue = new ConnectionQueue();
  private readonly entries = new Map<string, Entry>();
  private readonly shutdown = new AbortController();
  private readonly createClient: () => WealthsimpleClient;
  private readonly now: () => number;
  private closing?: Promise<void>;

  constructor(private readonly options: WealthsimpleSessionServiceOptions) {
    this.createClient = options.createClient ?? (() => new WealthsimpleClient());
    this.now = options.now ?? Date.now;
  }

  status(access: SessionAccess, signal: AbortSignal): Promise<{ status: SessionStatus }> {
    return this.live(access, signal, true, async entry => {
      const status = entry.client.getStatus();
      return { status: status === 'disconnected' && entry.expired ? 'expired' : status };
    });
  }

  login(access: SessionAccess, input: LoginInput, signal: AbortSignal) {
    return this.live(access, signal, true, async (entry, operationSignal) => {
      if (entry.client.getStatus() === 'connected') throw new SessionError('CONNECTION_ALREADY_CONNECTED');
      return this.providerOperation(entry, operationSignal, () => entry.client.login(input, providerWait));
    });
  }

  graphql(access: SessionAccess, input: GraphQLRequest, signal: AbortSignal) {
    return this.live(access, signal, false, (entry, operationSignal) =>
      this.providerOperation(entry, operationSignal, () => entry.client.graphql(input, providerWait)));
  }

  disconnect(access: SessionAccess, signal: AbortSignal): Promise<void> {
    return this.slot(access, signal, async operationSignal => {
      this.requireWealthsimple(access.binding);
      this.evict(access.binding.connectionId);
      await storage(() => this.options.store.remove(access.binding.connectionId, operationSignal));
    });
  }

  removeRecord(access: SessionAccess, remove: () => Promise<boolean>, signal: AbortSignal) {
    return this.slot(access, signal, async () => {
      this.evict(access.binding.connectionId);
      return remove();
    });
  }

  close(): Promise<void> {
    if (!this.closing) {
      const drained = this.queue.close();
      this.shutdown.abort(new SessionError('SESSION_SERVICE_CLOSED'));
      this.closing = drained.then(() => {
        for (const id of this.entries.keys()) this.evict(id);
      });
    }
    return this.closing;
  }

  private slot<T>(access: SessionAccess, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>) {
    const binding = access.binding;
    return this.queue.run(binding.connectionId, signal, async () => {
      const operationSignal = AbortSignal.any([signal, this.shutdown.signal]);
      try { await access.checkOwnership(operationSignal); }
      catch (error) {
        if (error instanceof Error && 'statusCode' in error && error.statusCode === 404) this.evict(binding.connectionId);
        throw error;
      }
      operationSignal.throwIfAborted();
      const cached = this.entries.get(binding.connectionId);
      if (cached && (cached.binding.userId !== binding.userId || cached.binding.providerId !== binding.providerId))
        throw new SessionError('SESSION_STATE_UNAVAILABLE');
      this.sweep();
      return work(operationSignal);
    });
  }

  private requireWealthsimple(binding: SessionBinding) {
    if (binding.providerId !== 'wealthsimple') throw new SessionError('CONNECTION_PROVIDER_UNSUPPORTED');
  }

  private live<T>(access: SessionAccess, signal: AbortSignal, validateConnected: boolean,
    work: (entry: Entry, signal: AbortSignal) => Promise<T>) {
    return this.slot(access, signal, async operationSignal => {
      const { binding } = access;
      this.requireWealthsimple(binding);
      const entry = await this.getEntry(binding, operationSignal);
      const abort = () => entry.client.abortUpstream();
      operationSignal.addEventListener('abort', abort, { once: true });
      try {
        operationSignal.throwIfAborted();
        if (entry.client.getStatus() === 'connected' && (validateConnected || entry.needsValidation)) {
          await this.providerOperation(entry, operationSignal, () => entry.client.validateSession(providerWait));
          entry.needsValidation = false;
          operationSignal.throwIfAborted();
        }
        const result = await work(entry, operationSignal);
        operationSignal.throwIfAborted();
        return result;
      } finally {
        operationSignal.removeEventListener('abort', abort);
        entry.lastUsed = this.now();
        entry.active = false;
        if (operationSignal.aborted) this.evict(binding.connectionId);
        this.sweep();
      }
    });
  }

  private async getEntry(binding: SessionBinding, signal: AbortSignal): Promise<Entry> {
    const existing = this.entries.get(binding.connectionId);
    if (existing) {
      existing.active = true;
      return existing;
    }
    const row = await storage(() => this.options.store.load(binding.connectionId, signal));
    signal.throwIfAborted();
    let snapshot: WealthsimpleSnapshot | undefined;
    if (row?.state === 'connected') {
      try {
        snapshot = parseWealthsimpleSnapshot(JSON.parse(this.options.cipher.decrypt(binding, row.envelope)));
      } catch { throw new SessionError('SESSION_STATE_UNAVAILABLE'); }
    }
    const client = this.createClient();
    if (snapshot) {
      try { client.restoreSnapshot(snapshot); }
      catch { client.close(); throw new SessionError('SESSION_STATE_UNAVAILABLE'); }
    }
    const entry = { binding: { ...binding }, client, expired: row?.state === 'expired',
      needsValidation: Boolean(snapshot), active: true, lastUsed: this.now() };
    this.entries.set(binding.connectionId, entry);
    return entry;
  }

  private snapshot(entry: Entry) {
    try {
      const snapshot = entry.client.exportSnapshot();
      if (!snapshot && entry.client.getStatus() === 'connected') throw Error();
      return snapshot;
    } catch {
      this.evict(entry.binding.connectionId);
      throw new SessionError('SESSION_STATE_UNAVAILABLE');
    }
  }

  private async providerOperation<T>(entry: Entry, signal: AbortSignal, operation: () => Promise<T>) {
    const before = this.snapshot(entry);
    try {
      return await operation();
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof WealthsimpleError) throw error;
      // Transport timeouts and unexpected upstream payloads have no public diagnostics.
      throw new WealthsimpleError('UPSTREAM_FAILURE');
    } finally {
      // Also capture rotations/cookies on malformed upstream responses or abort.
      await this.persistChanges(entry, before, signal);
    }
  }

  private async persistChanges(entry: Entry, before: WealthsimpleSnapshot | null, signal: AbortSignal) {
    const after = this.snapshot(entry);
    let row: DurableSession;
    if (after) {
      if (isDeepStrictEqual(comparable(before), comparable(after))) return;
      try {
        row = { state: 'connected', envelope: this.options.cipher.encrypt(entry.binding, JSON.stringify(after)) };
      } catch {
        this.evict(entry.binding.connectionId);
        throw new SessionError('SESSION_STATE_UNAVAILABLE');
      }
    } else {
      if (!before || signal.aborted) return;
      row = { state: 'expired', envelope: null };
    }
    try {
      await this.options.store.save(entry.binding.connectionId, row, AbortSignal.timeout(persistenceTimeoutMs));
    } catch {
      this.evict(entry.binding.connectionId);
      throw new SessionError('SESSION_STORAGE_UNAVAILABLE');
    }
    entry.expired = row.state === 'expired';
  }

  private evict(id: string) {
    this.entries.get(id)?.client.close();
    this.entries.delete(id);
  }

  private sweep() {
    const cutoff = this.now() - idleMs;
    const idle = [];
    for (const entry of this.entries.values()) {
      if (entry.active) continue;
      if (entry.lastUsed <= cutoff) this.evict(entry.binding.connectionId);
      else idle.push(entry);
    }
    if (idle.length > maxIdleEntries) {
      idle.sort((a, b) => a.lastUsed - b.lastUsed);
      for (const entry of idle.slice(0, idle.length - maxIdleEntries)) this.evict(entry.binding.connectionId);
    }
  }
}
