import { useEffect, useRef, useState } from 'react';
import type { OAuthAuthorizationDetails, OAuthRedirect, SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import type { VerifiedUser } from '../lib/api';
import { AuthStatus } from './auth-status';

function redirectToClient(value: string) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)))
    throw new Error('Invalid OAuth redirect.');
  window.location.assign(url.href);
}

export function OAuthConsent({ client, clientIds, user, authorized, authorizationId, getAccessToken, onSignOut }: {
  client: SupabaseClient;
  clientIds: readonly string[];
  user: VerifiedUser;
  authorized: boolean;
  authorizationId: string | null;
  getAccessToken: () => string | null;
  onSignOut: () => Promise<void>;
}) {
  const [details, setDetails] = useState<OAuthAuthorizationDetails | OAuthRedirect | null>(null);
  const [redirect, setRedirect] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const invalidRequest = 'This authorization request is invalid or has expired. Start again from your agent.';
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (!redirect || !authorized || !getAccessToken()) return;
    try { redirectToClient(redirect); }
    catch {
      setRedirect(null);
      setError(invalidRequest);
    }
  }, [authorized, getAccessToken, redirect]);

  async function load() {
    if (!authorizationId || !authorized || !getAccessToken() || pending) return;
    setPending(true);
    setError('');
    try {
      const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active.current) return;
      if (error || !data || ('authorization_id' in data &&
        (data.user.id !== user.id || data.authorization_id !== authorizationId ||
          !clientIds.includes(data.client.id) || !data.scope.split(' ').includes('openid')))) {
        setError(invalidRequest);
        return;
      }
      setDetails(data);
    } catch {
      if (active.current) setError(invalidRequest);
    } finally {
      if (active.current) setPending(false);
    }
  }

  async function decide(approve: boolean) {
    if (!details || !authorizationId || pending) return;
    if (!authorized || !getAccessToken() || redirect) return;
    setPending(true);
    setError('');
    try {
      if ('redirect_url' in details) {
        setRedirect(details.redirect_url);
        return;
      }
      const options = { skipBrowserRedirect: true };
      const { data, error } = approve
        ? await client.auth.oauth.approveAuthorization(authorizationId, options)
        : await client.auth.oauth.denyAuthorization(authorizationId, options);
      if (!active.current) return;
      if (error || !data) throw new Error('OAuth decision failed.');
      setRedirect(data.redirect_url);
    } catch {
      if (active.current) setError('Unable to complete authorization. Try again.');
    } finally {
      if (active.current) setPending(false);
    }
  }

  const clientName = details && 'client' in details ? details.client.name : null;
  return (
    <section aria-label="Agent authorization" className="space-y-4">
      <h2 className="text-lg font-semibold">{clientName ? 'Authorize ' + clientName : 'Authorize agent access'}</h2>
      <p className="break-all text-sm">{user.email ?? 'FinSight account'}</p>
      {!authorized && <AuthStatus message="Verifying your session…" />}
      {error && <AuthStatus error message={error} />}
      {!authorizationId && <AuthStatus error message={invalidRequest} />}
      {authorizationId && !details && <div className="flex flex-wrap gap-2">
        <Button disabled={pending || !authorized || Boolean(redirect)} onClick={() => void load()}>{pending ? 'Loading…' : 'Use this FinSight account'}</Button>
        <Button disabled={pending || !authorized || Boolean(redirect)} variant="outline" onClick={() => void onSignOut()}>Switch account</Button>
      </div>}
      {details && <>
        <p className="text-sm text-muted-foreground">This agent can read data from your current and future financial connections. You can revoke access from your FinSight account.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !authorized || Boolean(redirect)} onClick={() => void decide(true)}>{clientName ? 'Allow read access' : 'Continue'}</Button>
          {clientName && <Button disabled={pending || !authorized || Boolean(redirect)} variant="outline" onClick={() => void decide(false)}>Deny</Button>}
        </div>
      </>}
      {details && <p className="text-sm text-muted-foreground">To use a different account, start a new authorization from your agent.</p>}
    </section>
  );
}
