export interface Connection {
  id: string;
  providerId: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SessionStatus = 'connected' | 'disconnected' | 'expired' | 'mfa_required';
export interface Credentials { email: string; password: string; otp?: string }

export class ConnectionApiError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super('Connection request failed.');
  }
}

const unavailable = () => new ConnectionApiError('UNAVAILABLE');
const noContent = Symbol();

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}

function connection(value: unknown): Connection {
  const { id, providerId, label, createdAt, updatedAt } = object(value);
  if (typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ||
      typeof providerId !== 'string' || !providerId ||
      (label !== null && typeof label !== 'string') ||
      typeof createdAt !== 'string' || typeof updatedAt !== 'string') throw unavailable();
  return { id, providerId, label, createdAt, updatedAt };
}

function sessionStatus(value: unknown): SessionStatus {
  const { status } = object(value);
  if (status === 'connected' || status === 'disconnected' || status === 'expired' || status === 'mfa_required') return status;
  throw unavailable();
}

export function createConnectionsApi(
  origin: string,
  signal: AbortSignal,
  getToken: () => string | null,
  onAuthRejected: (token: string) => void,
) {
  const collection = '/api/connections';
  const item = (id: string) => `${collection}/${encodeURIComponent(id)}`;
  const session = (id: string) => `${item(id)}/session`;

  async function request(path: string, method = 'GET', body?: object): Promise<unknown> {
    signal.throwIfAborted();
    const token = getToken();
    if (!token) throw new ConnectionApiError('AUTH_VERIFYING', 401);
    let response: Response;
    try {
      response = await fetch(new URL(path, origin).href, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch {
      signal.throwIfAborted();
      throw unavailable();
    }
    if (response.status === 204) {
      signal.throwIfAborted();
      return noContent;
    }
    const payload: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (!response.ok) {
      const error = (payload as { error?: { code?: unknown } } | null)?.error;
      const code = typeof error?.code === 'string' ? error.code : 'UNAVAILABLE';
      if (response.status === 401 && code === 'UNAUTHENTICATED') onAuthRejected(token);
      throw new ConnectionApiError(code, response.status);
    }
    return payload;
  }

  return {
    signal,
    async list(cursor?: string) {
      // Each visible page starts at most ten provider status checks.
      const params = new URLSearchParams({ limit: '10' });
      if (cursor) params.set('cursor', cursor);
      const { connections, nextCursor } = object(await request(`${collection}?${params}`));
      if (!Array.isArray(connections) ||
          (nextCursor !== null && (typeof nextCursor !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(nextCursor)))) {
        throw unavailable();
      }
      return { connections: connections.map(connection), nextCursor };
    },
    async create(label: string | null) {
      return connection(object(await request(collection, 'POST', { providerId: 'wealthsimple', label })).connection);
    },
    async get(id: string) {
      return connection(object(await request(item(id))).connection);
    },
    async rename(id: string, label: string | null) {
      return connection(object(await request(item(id), 'PATCH', { label })).connection);
    },
    async status(id: string) { return sessionStatus(await request(session(id))); },
    async login(id: string, input: Credentials) {
      const result = sessionStatus(await request(session(id), 'POST', input));
      if (result === 'connected' || result === 'mfa_required') return result;
      throw unavailable();
    },
    async disconnect(id: string) {
      if (await request(session(id), 'DELETE') !== noContent) throw unavailable();
    },
    async remove(id: string) {
      if (await request(item(id), 'DELETE') !== noContent) throw unavailable();
    },
  };
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof ConnectionApiError ? error.code : undefined;
}

export function uncertainWrite(error: unknown): boolean {
  return !(error instanceof ConnectionApiError) || error.status === undefined || error.status >= 500;
}

export function connectionErrorMessage(error: unknown, fallback: string): string {
  switch (errorCode(error)) {
    case 'AUTH_VERIFYING': return 'FinSight is verifying your sign-in. Try again in a moment.';
    case 'UNAUTHENTICATED': return 'Your FinSight sign-in expired. Please sign in again.';
    case 'AUTH_UNAVAILABLE': return 'FinSight sign-in is temporarily unavailable. Try again.';
    case 'CONNECTION_NOT_FOUND': return 'This connection is no longer available.';
    case 'CONNECTION_ALREADY_CONNECTED': return 'This Wealthsimple connection is already connected.';
    case 'CONNECTION_INPUT_INVALID': return 'Check the connection label and try again.';
    case 'WEALTHSIMPLE_INVALID_REQUEST': return 'Check your Wealthsimple sign-in details and try again.';
    case 'WEALTHSIMPLE_LOGIN_FAILED': return 'Wealthsimple could not sign you in. Check your email, password or verification code and try again.';
    case 'WEALTHSIMPLE_UPSTREAM_FAILURE': return 'Wealthsimple is temporarily unavailable. Try again.';
    case 'SESSION_NOT_CONFIGURED': return 'Wealthsimple connections are unavailable on this FinSight server.';
    case 'CONNECTION_STORAGE_UNAVAILABLE':
    case 'SESSION_STORAGE_UNAVAILABLE':
    case 'SESSION_STATE_UNAVAILABLE':
    case 'SESSION_SERVICE_CLOSED': return 'FinSight could not access saved connections. Try again.';
    default: return fallback;
  }
}
