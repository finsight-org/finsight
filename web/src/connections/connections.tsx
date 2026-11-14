import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AuthStatus } from '../auth/auth-status';
import {
  connectionErrorMessage, errorCode, uncertainWrite, type Connection, type Credentials,
} from './api';
import { ConnectionDialog, type ConnectionAction } from './connection-dialog';
import { useConnectionList } from './use-connection-list';

const statusLabel = {
  checking: 'Checking status…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  expired: 'Expired',
  mfa_required: 'Verification required',
  unavailable: 'Status unavailable',
};

function providerName(record: Connection) {
  return record.providerId === 'wealthsimple' ? 'Wealthsimple' : record.providerId;
}

interface Props {
  apiUrl: string;
  authorized: boolean;
  getAccessToken(): string | null;
  onAuthRejected(token: string): void;
}

export function Connections({ apiUrl, authorized, getAccessToken, onAuthRejected }: Props) {
  const list = useConnectionList(apiUrl, authorized, getAccessToken, onAuthRejected);
  const [action, setAction] = useState<ConnectionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const submitting = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const disabled = pending || !authorized || list.loading;
  const records = list.page?.connections ?? [];
  const selected = records.find(record => record.id === action?.id);

  function open(next: ConnectionAction, trigger: HTMLElement) {
    opener.current = trigger;
    setError(null);
    setAction(next);
  }

  function restoreFocus() {
    const target = opener.current;
    if (target?.isConnected && !target.matches(':disabled')) target.focus();
    else addButton.current?.focus();
    opener.current = null;
  }

  function close() {
    setAction(null);
    setError(null);
  }

  async function submit<T>(work: (api: ReturnType<typeof list.openApi>) => Promise<T>): Promise<T | undefined> {
    if (submitting.current || !authorized) return;
    submitting.current = true;
    const api = list.openApi();
    setPending(true);
    setError(null);
    try {
      return await work(api);
    } finally {
      submitting.current = false;
      if (!api.signal.aborted) setPending(false);
    }
  }

  async function connect(input: Credentials, label: string | null) {
    if (action?.kind !== 'connect') return;
    return submit(async api => {
      let id = action.id;
      if (!id) {
        try {
          const record = await api.create(label);
          id = record.id;
          list.save(record);
          list.updateStatus(id, 'disconnected');
          setAction({ ...action, id });
        } catch (failure) {
          if (api.signal.aborted) return;
          if (uncertainWrite(failure)) {
            const refreshed = await list.load({ reconcile: true });
            if (api.signal.aborted) return;
            setAction(null);
            setReviewRequired(!refreshed);
            setError('FinSight could not confirm the new connection. Check your saved connections before adding another.');
          } else {
            setError(connectionErrorMessage(failure, 'Could not add the connection. Try again.'));
          }
          return;
        }
      }
      try {
        const status = await api.login(id, input);
        list.updateStatus(id, status);
        if (status === 'connected') close();
        else setAction({ kind: 'connect', id, verify: true });
      } catch (failure) {
        if (api.signal.aborted) return;
        const code = errorCode(failure);
        const needsStatus = uncertainWrite(failure) || code === 'CONNECTION_ALREADY_CONNECTED';
        let restart = false;
        if (code === 'CONNECTION_NOT_FOUND') {
          list.forget(id);
          setAction(null);
        } else if (needsStatus || code === 'WEALTHSIMPLE_LOGIN_FAILED') {
          const status = await list.checkStatus(id, api);
          if (api.signal.aborted) return;
          if (status === 'connected') {
            close();
            return;
          }
          if (!status && needsStatus) setAction(null);
          else {
            const verify = code !== 'WEALTHSIMPLE_LOGIN_FAILED' && status === 'mfa_required';
            setAction({ kind: 'connect', id, verify });
            restart = !verify && (action.verify || code === 'WEALTHSIMPLE_LOGIN_FAILED');
          }
        }
        setError(connectionErrorMessage(failure, 'Could not connect to Wealthsimple. Try again.'));
        if (restart) return 'restart' as const;
      }
    });
  }

  async function editConnection(label: string | null = null) {
    if (!action || action.kind === 'connect') return;
    const { id, kind } = action;
    await submit(async api => {
      try {
        if (kind === 'rename') list.save(await api.rename(id, label));
        else if (kind === 'disconnect') {
          await api.disconnect(id);
          list.updateStatus(id, 'disconnected');
        } else {
          await api.remove(id);
          list.forget(id);
        }
        close();
      } catch (failure) {
        if (api.signal.aborted) return;
        if (errorCode(failure) === 'CONNECTION_NOT_FOUND') {
          list.forget(id);
          setAction(null);
        } else if (uncertainWrite(failure)) {
          // Check the saved state before giving the user a chance to retry a write.
          if (kind === 'disconnect') {
            const status = await list.checkStatus(id, api);
            if (api.signal.aborted) return;
            if (status === 'disconnected') {
              close();
              return;
            }
          } else {
            try {
              list.save(await api.get(id));
            } catch (refreshError) {
              if (api.signal.aborted) return;
              if (errorCode(refreshError) === 'CONNECTION_NOT_FOUND') {
                list.forget(id);
                if (kind === 'remove') {
                  close();
                  return;
                }
              } else {
                setReviewRequired(true);
              }
            }
          }
          setAction(null);
        }
        setError(connectionErrorMessage(failure, 'Could not update the connection. Check its saved state and try again.'));
      }
    });
  }

  async function refresh(cursor?: string) {
    if (await list.load({ cursor, reconcile: reviewRequired })) {
      if (reviewRequired) setError(null);
      setReviewRequired(false);
    }
  }

  return (
    <section aria-labelledby="connections-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="connections-heading" className="text-lg font-semibold">Connections</h2>
        <Button ref={addButton} disabled={disabled || reviewRequired || !list.page}
          onClick={event => open({ kind: 'connect', verify: false }, event.currentTarget)}>
          Add Wealthsimple connection
        </Button>
      </div>
      {!authorized && !action && <AuthStatus message="Verifying your FinSight sign-in…" />}
      {!action && error && <AuthStatus message={error} error />}
      {list.listError && <AuthStatus message={list.listError} error />}
      {list.loading && <p role="status" className="text-muted-foreground">Loading saved connections…</p>}
      {list.page && !records.length && <p className="rounded-lg border border-dashed p-5 text-muted-foreground">No saved connections yet.</p>}
      {!!records.length && (
        <ul className="space-y-2">
          {records.map(record => {
            const supported = record.providerId === 'wealthsimple';
            const status = list.statuses[record.id]?.value ?? 'checking';
            const message = list.statuses[record.id]?.message;
            const provider = providerName(record);
            return (
              <li key={record.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <h3 className="font-medium">{record.label ?? provider}</h3>
                    {record.label && <p className="text-xs text-muted-foreground">{provider}</p>}
                  </div>
                  <span role="status" className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === 'connected'
                    ? 'bg-emerald-100 text-emerald-900'
                    : status === 'expired' || status === 'mfa_required'
                      ? 'bg-amber-100 text-amber-950'
                      : 'bg-muted text-muted-foreground'}`}>
                    {supported ? statusLabel[status] : 'Provider unavailable'}
                  </span>
                </div>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <div className="flex flex-wrap gap-2">
                  {supported && (status === 'disconnected' || status === 'expired' || status === 'mfa_required') && (
                    <Button variant="outline" size="sm" disabled={disabled || reviewRequired}
                      onClick={event => open({ kind: 'connect', id: record.id, verify: status === 'mfa_required' }, event.currentTarget)}>
                      {status === 'mfa_required' ? 'Resume verification' : status === 'expired' ? 'Reconnect' : 'Connect again'}
                    </Button>
                  )}
                  {supported && status === 'unavailable' && (
                    <Button variant="outline" size="sm" disabled={disabled} onClick={() => void list.checkStatus(record.id)}>Retry status</Button>
                  )}
                  <Button variant="outline" size="sm" disabled={disabled || reviewRequired}
                    onClick={event => open({ kind: 'rename', id: record.id }, event.currentTarget)}>Rename</Button>
                  {supported && (status === 'connected' || status === 'expired' || status === 'mfa_required') && (
                    <Button variant="outline" size="sm" disabled={disabled || reviewRequired}
                      onClick={event => open({ kind: 'disconnect', id: record.id }, event.currentTarget)}>Disconnect</Button>
                  )}
                  {supported && status === 'disconnected' && (
                    <Button variant="ghost" size="sm" disabled={disabled || reviewRequired}
                      onClick={event => open({ kind: 'remove', id: record.id }, event.currentTarget)}>Remove</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(list.page?.nextCursor || list.listError || reviewRequired || records.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {list.page?.nextCursor && !reviewRequired && (
            <Button variant="outline" disabled={disabled} onClick={() => void refresh(list.page?.nextCursor ?? undefined)}>Load more</Button>
          )}
          <Button variant="ghost" disabled={disabled} onClick={() => void refresh()}>
            {reviewRequired ? 'Review saved connections' : list.page ? 'Refresh connections' : 'Retry loading'}
          </Button>
        </div>
      )}
      {action && (
        <ConnectionDialog action={action} name={selected?.label ?? (selected ? providerName(selected) : 'Wealthsimple')}
          savedLabel={selected?.label} error={error} pending={pending} authorized={authorized}
          onClose={close} onRestoreFocus={restoreFocus} onConnect={connect} onRename={editConnection}
          onConfirm={() => editConnection()} onRestart={() => {
            if (action.kind === 'connect') setAction({ ...action, verify: false });
            setError(null);
          }} />
      )}
    </section>
  );
}
