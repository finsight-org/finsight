import type { SupabaseClient } from '@supabase/supabase-js';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFinSightAuth } from './auth/use-finsight-auth';
import { AuthForm } from './auth/auth-form';
import { AuthStatus } from './auth/auth-status';
import { Home } from './home';
export function App({ client, apiUrl }: { client: SupabaseClient; apiUrl: string }) {
  const auth = useFinSightAuth(client, apiUrl);
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const backToSignIn = () => { setMode('sign-in'); auth.retry(); };
  return <main className="min-h-svh bg-background px-5 py-14 text-foreground sm:py-24">
    <div className="mx-auto max-w-sm"><p className="mb-8 text-center text-xl font-semibold tracking-tight">FinSight<span className="text-primary">.</span></p>
      <Card><CardHeader><CardTitle className="text-xl"><h1>{auth.state.phase === 'authenticated' ? 'Your FinSight account' : 'Welcome to FinSight'}</h1></CardTitle><CardDescription>Your financial connections, in one place.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          {auth.error && <AuthStatus message={auth.error} error />}
          {auth.state.phase === 'loading' && <AuthStatus message="Verifying your session…" />}
          {auth.state.phase === 'signed-out' && <><AuthForm key={mode} mode={mode} pending={auth.pending} onSubmit={mode === 'sign-up' ? auth.signUp : auth.signIn} /><Button variant="link" className="w-full" disabled={auth.pending} onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>{mode === 'sign-in' ? 'Create an account' : 'Back to sign in'}</Button></>}
          {auth.state.phase === 'confirmation-required' && <><AuthStatus message="Check your inbox for a confirmation link, then return here to finish signing in." /><p className="break-all text-sm text-muted-foreground">{auth.state.email}</p><Button variant="outline" className="w-full" onClick={backToSignIn}>Back to sign in</Button></>}
          {auth.state.phase === 'callback-error' && <><AuthStatus error message="This confirmation link could not finish sign-in. It may have expired or opened in a different browser. If your email is confirmed, sign in with your password." /><Button className="w-full" onClick={backToSignIn}>Back to sign in</Button></>}
          {auth.state.phase === 'verification-error' && <><AuthStatus message="Unable to verify your session. Your session has been kept; please try again." error /><Button className="w-full" onClick={auth.retry}>Retry</Button></>}
          {auth.state.phase === 'authenticated' && <Home user={auth.state.user} pending={auth.pending} onSignOut={auth.signOut} />}
        </CardContent>
      </Card><p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">Your account is ready for the next step.</p>
    </div>
  </main>;
}
