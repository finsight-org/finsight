import { useEffect, useState } from 'react';
import type { OAuthGrant, SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { AuthStatus } from './auth-status';

export function AgentAccess({ client, clientIds }: { client: SupabaseClient; clientIds: readonly string[] }) {
  const [grants, setGrants] = useState<OAuthGrant[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await client.auth.oauth.listGrants();
        if (result.error) throw new Error('Could not list grants.');
        if (!cancelled) setGrants(result.data.filter(grant => clientIds.includes(grant.client.id)));
      } catch {
        if (!cancelled) setError('Unable to load agent access. Try again.');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [attempt, client, clientIds]);

  async function revoke(clientId: string) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const result = await client.auth.oauth.revokeGrant({ clientId });
      if (result.error) throw new Error('Could not revoke grant.');
      setGrants(current => current?.filter(grant => grant.client.id !== clientId) ?? null);
      setAttempt(current => current + 1);
    } catch { setError('Unable to revoke agent access. Try again.'); }
    finally { setPending(false); }
  }

  return (
    <section aria-labelledby="agent-access-heading" className="space-y-3 border-t pt-4">
      <h2 id="agent-access-heading" className="text-lg font-semibold">Agent access</h2>
      {error && <div className="space-y-2">
        <AuthStatus error message={error} />
        {!grants && <Button variant="outline" onClick={() => { setError(''); setAttempt(current => current + 1); }}>Retry</Button>}
      </div>}
      {!grants && !error && <AuthStatus message="Loading agent access…" />}
      {grants?.length === 0 && <p className="text-sm text-muted-foreground">No agents are authorized.</p>}
      {grants && grants.length > 0 && <ul className="space-y-2">
        {grants.map(({ client: agent }) => (
          <li key={agent.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
            <span className="min-w-0 break-all">{agent.name}</span>
            <Button disabled={pending} variant="outline" aria-label={'Revoke ' + agent.name} onClick={() => void revoke(agent.id)}>Revoke</Button>
          </li>
        ))}
      </ul>}
    </section>
  );
}
