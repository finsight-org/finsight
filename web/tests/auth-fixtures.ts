import { AuthApiError, type AuthChangeEvent, type Session, type SupabaseClient } from '@supabase/supabase-js';
export function session(id = 'a'): Session {
  return { access_token: `token-${id}`, refresh_token: `refresh-${id}`, expires_in: 3600, token_type: 'bearer',
    user: { id: `sdk-${id}`, email: 'unverified-metadata@example.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-02T00:00:00Z' } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
export function authFixture(initial: Session | null = null) {
  const listeners = new Set<(event: AuthChangeEvent, value: Session | null) => void>();
  const f = {
    initializationError: null as Error | null, restorationFailure: null as Error | null, signInFailure: null as Error | null, initialNullEvent: false, consumeCallback: true, recoverDuringCallback: false, clearOnFailedSignOut: false, immediateSignup: false, failSignup: false, signupRedirect: "", signupPending: null as Promise<void> | null,
    current: initial, failSignOut: false, signOutScopes: [] as string[], unsubscribed: false,
    restoration: null as Promise<{ data: { session: Session | null }; error: null }> | null,
    emit(event: AuthChangeEvent, value: Session | null) { f.current = value; for (const listener of listeners) listener(event, value); },
    client: null as unknown as SupabaseClient,
  };
  f.client = { auth: {
    initialize: async () => {
      if (f.recoverDuringCallback && f.current) f.emit('SIGNED_IN', f.current);
      if (!f.initializationError && f.consumeCallback && window.location.pathname === '/auth/callback' && new URLSearchParams(window.location.search).has('code')) window.history.replaceState(null, '', '/auth/callback');
      return { error: f.initializationError };
    },
    getSession: async () => f.restorationFailure ? { data: { session: null }, error: f.restorationFailure } : f.restoration ?? { data: { session: f.current }, error: null },
    onAuthStateChange: (callback: (event: AuthChangeEvent, value: Session | null) => void) => {
      listeners.add(callback); if (f.initialNullEvent) queueMicrotask(() => callback('INITIAL_SESSION', null)); return { data: { subscription: { unsubscribe: () => { listeners.delete(callback); f.unsubscribed = true; } } } };
    },
    signInWithPassword: async ({ password }: { email: string; password: string }) => {
      if (f.signInFailure) return { data: { session: null }, error: f.signInFailure };
      if (password === 'wrong-password') return { data: { session: null }, error: new AuthApiError('PRIVATE_DIAGNOSTIC', 400, 'invalid_credentials') };
      f.emit('SIGNED_IN', session()); return { data: { session: f.current }, error: null };
    },
    signUp: async ({ options }: { email: string; password: string; options: { emailRedirectTo: string } }) => {
      f.signupRedirect = options.emailRedirectTo;
      if (f.signupPending) await f.signupPending;
      if (f.failSignup) return { data: { session: null }, error: new Error('PRIVATE_DIAGNOSTIC') };
      if (f.immediateSignup) f.emit('SIGNED_IN', session());
      return { data: { session: f.immediateSignup ? f.current : null }, error: null };
    },
    signOut: async ({ scope }: { scope: string }) => {
      f.signOutScopes.push(scope);
      if (f.failSignOut) { if (f.clearOnFailedSignOut) f.emit('SIGNED_OUT', null); return { error: new Error('PRIVATE_DIAGNOSTIC') }; }
      f.emit('SIGNED_OUT', null); return { error: null };
    },
  } } as unknown as SupabaseClient;
  return f;
}
