import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFinSightAuth } from './auth/use-finsight-auth';
import { AuthForm } from './auth/auth-form';
import { AuthStatus } from './auth/auth-status';
import { Home } from './home';
import { OAuthConsent } from './auth/oauth-consent';
import { AgentAccess } from './auth/agent-access';
const noMcpClients: readonly string[] = [];
export function App({ client, apiUrl, mcpClientIds = noMcpClients }: {
  client: SupabaseClient; apiUrl: string; mcpClientIds?: readonly string[];
}) {
  const auth = useFinSightAuth(client, apiUrl);
  const consentRoute = window.location.pathname === '/oauth/consent';
  const requests = new URLSearchParams(window.location.search).getAll('authorization_id');
  const authorizationId = requests.length === 1 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requests[0]) ? requests[0] : null;
  const userId = auth.state.phase === 'authenticated' ? auth.state.user.id : null;
  const getConsentToken = useCallback(() => userId ? auth.getAccessToken(userId) : null, [auth.getAccessToken, userId]);
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const backToSignIn = () => { setMode('sign-in'); auth.retry(); };
  return <main className="min-h-svh bg-background px-5 py-14 text-foreground sm:py-24">
    <div className={auth.state.phase === 'authenticated' ? 'mx-auto max-w-2xl' : 'mx-auto max-w-sm'}><p className="mb-8 text-center text-xl font-semibold tracking-tight">FinSight<span className="text-primary">.</span></p>
      <Card><CardHeader><CardTitle className="text-xl"><h1>{auth.state.phase === 'authenticated' ? 'Your FinSight account' : 'Welcome to FinSight'}</h1></CardTitle><CardDescription>Your financial connections, in one place.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          {auth.error && <AuthStatus message={auth.error} error />}
          {auth.state.phase === 'loading' && <AuthStatus message="Verifying your session…" />}
          {auth.state.phase === 'signed-out' && <><AuthForm key={mode} mode={mode} pending={auth.pending} onSubmit={mode === 'sign-up' ? auth.signUp : auth.signIn} /><Button variant="link" className="w-full" disabled={auth.pending} onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>{mode === 'sign-in' ? 'Create an account' : 'Back to sign in'}</Button></>}
          {auth.state.phase === 'confirmation-required' && <><AuthStatus message="Check your inbox for a confirmation link, then return here to finish signing in." /><p className="break-all text-sm text-muted-foreground">{auth.state.email}</p><Button variant="outline" className="w-full" onClick={backToSignIn}>Back to sign in</Button></>}
          {auth.state.phase === 'callback-error' && <><AuthStatus error message="This confirmation link could not finish sign-in. It may have expired or opened in a different browser. If your email is confirmed, sign in with your password." /><Button className="w-full" onClick={backToSignIn}>Back to sign in</Button></>}
          {auth.state.phase === 'verification-error' && <><AuthStatus message="Unable to verify your session. Your session has been kept; please try again." error /><Button className="w-full" onClick={auth.retry}>Retry</Button></>}
          {auth.state.phase === 'authenticated' && (consentRoute
            ? mcpClientIds.length > 0
              ? <OAuthConsent key={auth.state.user.id + '/' + authorizationId} client={client} clientIds={mcpClientIds}
                user={auth.state.user} authorized={auth.state.authorized} authorizationId={authorizationId}
                getAccessToken={getConsentToken} onSignOut={auth.signOut} />
              : <AuthStatus message="Agent access is unavailable." />
            : <>
              <Home key={`${apiUrl}/${auth.state.user.id}`} user={auth.state.user} apiUrl={apiUrl}
                authorized={auth.state.authorized} getAccessToken={auth.getAccessToken} pending={auth.pending}
                onAuthRejected={auth.revalidateAccessToken} onSignOut={auth.signOut} />
              {mcpClientIds.length > 0 && auth.state.authorized &&
                <AgentAccess key={auth.state.user.id} client={client} clientIds={mcpClientIds} />}
            </>)}
        </CardContent>
      </Card>
    </div>
  </main>;
}
