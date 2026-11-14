import type { VerifiedUser } from './lib/api';
import { Button } from '@/components/ui/button';
import { Connections } from './connections/connections';

interface Props {
  user: VerifiedUser;
  apiUrl: string;
  authorized: boolean;
  getAccessToken(userId: string): string | null;
  pending: boolean;
  onAuthRejected(token: string): void;
  onSignOut(): Promise<void>;
}

export function Home({ user, apiUrl, authorized, getAccessToken, pending, onAuthRejected, onSignOut }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="mt-1 font-medium">{user.email ?? 'FinSight user'}</p>
        </div>
        <Button variant="outline" disabled={pending} onClick={() => void onSignOut()}>Sign out</Button>
      </div>
      <Connections apiUrl={apiUrl} authorized={authorized} getAccessToken={() => getAccessToken(user.id)} onAuthRejected={onAuthRejected} />
    </div>
  );
}
