import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ConnectionApiError, connectionErrorMessage, createConnectionsApi, errorCode,
  type Connection, type SessionStatus,
} from './api';

type Api = ReturnType<typeof createConnectionsApi>;
type Page = Awaited<ReturnType<Api['list']>>;
type ConnectionStatus =
  | { value: SessionStatus | 'checking' }
  | { value: 'unavailable'; message: string; canRemove: boolean };

function mergeConnections(current: Connection[], incoming: Connection[]): Connection[] {
  const byId = new Map(current.map(connection => [connection.id, connection]));
  for (const connection of incoming) byId.set(connection.id, connection);
  return [...byId.values()];
}

export function useConnectionList(
  origin: string, authorized: boolean, getAccessToken: () => string | null, onAuthRejected: (token: string) => void,
) {
  const [page, setPage] = useState<Page | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({});
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const authorization = useRef({ getAccessToken, onAuthRejected });
  const lifetime = useRef<AbortController | null>(null);
  const initialized = useRef(false);
  const activeStatus = useRef(new Map<string, symbol>());
  const listing = useRef(false);

  useLayoutEffect(() => {
    authorization.current = { getAccessToken, onAuthRejected };
  }, [getAccessToken, onAuthRejected]);

  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    initialized.current = false;
    return () => {
      controller.abort();
      activeStatus.current.clear();
      listing.current = false;
    };
  }, [origin]);

  const openApi = useCallback(() => createConnectionsApi(
    origin, lifetime.current!.signal,
    () => authorization.current.getAccessToken(),
    token => authorization.current.onAuthRejected(token),
  ), [origin]);

  const forget = useCallback((id: string) => {
    activeStatus.current.delete(id);
    setPage(current => current && { ...current, connections: current.connections.filter(record => record.id !== id) });
    setStatuses(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const updateStatus = useCallback((id: string, value: SessionStatus) => {
    activeStatus.current.delete(id);
    setStatuses(current => ({ ...current, [id]: { value } }));
  }, []);

  const checkStatus = useCallback(async (id: string, api = openApi()) => {
    const ticket = Symbol();
    activeStatus.current.set(id, ticket);
    setStatuses(current => ({ ...current, [id]: { value: 'checking' } }));
    const isCurrent = () => !api.signal.aborted && activeStatus.current.get(id) === ticket;
    try {
      const result = await api.status(id);
      if (!isCurrent()) return;
      updateStatus(id, result);
      return result;
    } catch (error) {
      if (!isCurrent()) return;
      activeStatus.current.delete(id);
      const code = errorCode(error);
      if (code === 'CONNECTION_NOT_FOUND') {
        forget(id);
        return;
      }
      setStatuses(current => ({
        ...current,
        [id]: {
          value: 'unavailable',
          message: connectionErrorMessage(error, 'Could not check this connection. Try again.'),
          canRemove: code === 'SESSION_STATE_UNAVAILABLE' || code === 'SESSION_NOT_CONFIGURED',
        },
      }));
    }
  }, [forget, openApi, updateStatus]);

  const load = useCallback(async (options: { cursor?: string; reconcile?: boolean } = {}) => {
    if (listing.current) return false;
    listing.current = true;
    const api = openApi();
    setLoading(true);
    setListError(null);
    try {
      let result = await api.list(options.cursor);
      if (options.reconcile) {
        const seen = new Set<string>();
        while (result.nextCursor) {
          if (seen.has(result.nextCursor)) throw new ConnectionApiError('UNAVAILABLE');
          seen.add(result.nextCursor);
          const next = await api.list(result.nextCursor);
          result = { connections: mergeConnections(result.connections, next.connections), nextCursor: next.nextCursor };
        }
      }
      if (!options.cursor) {
        activeStatus.current.clear();
        setStatuses({});
      }
      setPage(current => ({
        connections: options.cursor ? mergeConnections(current?.connections ?? [], result.connections) : result.connections,
        nextCursor: result.nextCursor,
      }));

      async function checkVisibleStatuses() {
        const supported = result.connections.filter(record => record.providerId === 'wealthsimple');
        for (let index = 0; index < supported.length && !api.signal.aborted; index += 10) {
          await Promise.all(supported.slice(index, index + 10).map(record => checkStatus(record.id, api)));
        }
      }
      void checkVisibleStatuses();
      return true;
    } catch (error) {
      if (!api.signal.aborted) setListError(connectionErrorMessage(error, 'Could not load saved connections. Try again.'));
      return false;
    } finally {
      if (!api.signal.aborted) {
        listing.current = false;
        setLoading(false);
      }
    }
  }, [checkStatus, openApi]);

  useEffect(() => {
    if (authorized && !initialized.current) {
      initialized.current = true;
      void load();
    }
  }, [authorized, load]);

  function save(record: Connection) {
    setPage(current => ({
      connections: mergeConnections(current?.connections ?? [], [record]),
      nextCursor: current?.nextCursor ?? null,
    }));
  }

  return { page, statuses, listError, loading, openApi, load, checkStatus, updateStatus, forget, save };
}
