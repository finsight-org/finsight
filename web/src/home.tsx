import type { VerifiedUser } from './lib/api';
import { Button } from '@/components/ui/button';
export function Home({ user, pending, onSignOut }: { user: VerifiedUser; pending: boolean; onSignOut(): Promise<void> }) {
  return <div className="space-y-6">
    <div><p className="text-sm text-muted-foreground">Signed in as</p><p className="mt-1 break-all font-medium">{user.email ?? 'FinSight user'}</p><p className="mt-2 break-all font-mono text-xs text-muted-foreground">{user.id}</p></div>
    <div className="rounded-lg border border-dashed p-5"><h2 className="font-medium">Your provider connections</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Connect your financial providers here in a future update.</p></div>
    <Button variant="outline" className="w-full" disabled={pending} onClick={() => void onSignOut()}>Sign out</Button>
  </div>;
}
