import { SessionError } from './model.js';

interface QueuedJob {
  start(): void;
  cancel(reason: unknown): void;
}

interface ConnectionState {
  active: boolean;
  waiting: QueuedJob[];
}

export class ConnectionQueue {
  private readonly connections = new Map<string, ConnectionState>();
  private closed = false;
  private closing?: Promise<void>;
  private resolveClosed?: () => void;

  run<T>(connectionId: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new SessionError('SESSION_SERVICE_CLOSED'));
    if (signal.aborted) return Promise.reject(signal.reason);

    let state = this.connections.get(connectionId);
    if (!state) {
      state = { active: false, waiting: [] };
      this.connections.set(connectionId, state);
    }
    const connection = state;

    return new Promise<T>((resolve, reject) => {
      const abort = () => job.cancel(signal.reason);
      const job: QueuedJob = {
        start: () => {
          // Once admitted, cancellation belongs to the provider work itself.
          signal.removeEventListener('abort', abort);
          void (async () => {
            try {
              resolve(await work());
            } catch (error) {
              reject(error);
            } finally {
              connection.active = false;
              this.startNext(connectionId, connection);
            }
          })();
        },
        cancel: reason => {
          signal.removeEventListener('abort', abort);
          const index = connection.waiting.indexOf(job);
          if (index !== -1) connection.waiting.splice(index, 1);
          reject(reason);
        },
      };
      signal.addEventListener('abort', abort, { once: true });
      connection.waiting.push(job);
      if (!connection.active) this.startNext(connectionId, connection);
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = new Promise<void>(resolve => { this.resolveClosed = resolve; });
    for (const connection of this.connections.values()) {
      for (const job of connection.waiting.splice(0)) {
        job.cancel(new SessionError('SESSION_SERVICE_CLOSED'));
      }
    }
    this.finishClose();
    return this.closing;
  }

  private startNext(connectionId: string, connection: ConnectionState): void {
    const job = connection.waiting.shift();
    if (job) {
      connection.active = true;
      job.start();
    } else {
      this.connections.delete(connectionId);
      this.finishClose();
    }
  }

  private finishClose(): void {
    if (this.closed && this.connections.size === 0) {
      this.resolveClosed?.();
      this.resolveClosed = undefined;
    }
  }
}
