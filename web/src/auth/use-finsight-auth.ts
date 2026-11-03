import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { ApiError, getCurrentUser, type VerifiedUser } from '../lib/api';

export type AuthState = { phase: 'loading' } | { phase: 'signed-out' }
  | { phase: 'authenticated'; user: VerifiedUser } | { phase: 'verification-error' }
  | { phase: 'confirmation-required'; email: string } | { phase: 'callback-error' };
export interface AuthController {
  state: AuthState; pending: boolean; error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retry(): void;
}
function retryableAuthError(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  if (isAuthSessionMissingError(error)) return false;
  return !(isAuthApiError(error) && [400, 401, 403, 422].includes(error.status));
}
export function useFinSightAuth(client: SupabaseClient, apiUrl: string): AuthController {
  const [state, setState] = useState<AuthState>({ phase: 'loading' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const current = useRef<Session | null>(null);
  const callbackRejected = useRef(false);
  const request = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => { generation.current++; request.current?.abort(); }, []);
  const accept = useCallback((session: Session | null) => {
    invalidate(); current.current = session;
    if (!mounted.current) return;
    setError(null);
    if (!session) { setState({ phase: 'signed-out' }); return; }
    const version = generation.current;
    const abort = new AbortController(); request.current = abort;
    setState({ phase: 'loading' });
    queueMicrotask(async () => {
      if (!mounted.current || version !== generation.current) return;
      try {
        const user = await getCurrentUser(apiUrl, session.access_token, abort.signal);
        if (mounted.current && version === generation.current) setState({ phase: 'authenticated', user });
      } catch (failure) {
        if (!mounted.current || version !== generation.current || abort.signal.aborted) return;
        if (failure instanceof ApiError && failure.kind === 'unauthenticated') {
          accept(null);
          void client.auth.signOut({ scope: 'local' });
        } else setState({ phase: 'verification-error' });
      }
    });
  }, [apiUrl, client, invalidate]);
  const restore = useCallback(async () => {
    const version = generation.current;
    setError(null); setState({ phase: 'loading' });
    try {
      const { data, error: failure } = await client.auth.getSession();
      if (!mounted.current || version !== generation.current) return;
      if (failure && retryableAuthError(failure)) setState({ phase: 'verification-error' });
      else accept(failure ? null : data.session);
    } catch {
      if (mounted.current && version === generation.current) setState({ phase: 'verification-error' });
    }
  }, [accept, client]);
  useEffect(() => {
    mounted.current = true;
    const version = generation.current;
    const callback = window.location.pathname === '/auth/callback';
    const callbackError = new URLSearchParams(window.location.search).has('error') || new URLSearchParams(window.location.hash.slice(1)).has('error');
    let processingCallback = callback;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      // getSession owns restoration errors; INITIAL_SESSION(null) can mean an outage.
      // During a callback, SDK recovery events alone do not prove code exchange.
      if (event === 'INITIAL_SESSION' || processingCallback || callbackRejected.current) return;
      accept(session);
    });
    void (async () => {
      try {
        const initialized = await client.auth.initialize();
        if (!mounted.current || version !== generation.current) return;
        if (callback && (initialized.error || callbackError || new URLSearchParams(window.location.search).has('code'))) {
          callbackRejected.current = true; setState({ phase: 'callback-error' }); return;
        }
        if (initialized.error) {
          if (retryableAuthError(initialized.error)) setState({ phase: 'verification-error' });
          else accept(null);
          return;
        }
        const { data, error: failure } = await client.auth.getSession();
        if (!mounted.current || version !== generation.current) return;
        if (callback && (failure || !data.session)) { callbackRejected.current = true; setState({ phase: 'callback-error' }); }
        else if (failure && retryableAuthError(failure)) setState({ phase: 'verification-error' });
        else if (failure) accept(null);
        else accept(data.session);
      } catch {
        if (mounted.current && version === generation.current) {
          if (callback) callbackRejected.current = true;
          setState({ phase: callback ? 'callback-error' : 'verification-error' });
        }
      } finally {
        processingCallback = false;
        if (callback && mounted.current) window.history.replaceState(null, '', '/');
      }
    })();
    return () => { mounted.current = false; invalidate(); subscription.unsubscribe(); };
  }, [client, accept, invalidate]);
  const signIn = async (email: string, password: string) => {
    callbackRejected.current = false;
    setPending(true); setError(null); const version = generation.current;
    try {
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error && mounted.current && version === generation.current) setError(retryableAuthError(result.error)
        ? 'Sign-in is temporarily unavailable. Please try again.'
        : 'Unable to sign in. Check your email and password and try again.');
      else if (result.data.session && current.current?.access_token !== result.data.session.access_token) accept(result.data.session);
    } catch { if (mounted.current && version === generation.current) setError('Sign-in is temporarily unavailable. Please try again.'); }
    finally { if (mounted.current) setPending(false); }
  };
  const signOut = async () => {
    invalidate(); const version = generation.current; const previous = state;
    setPending(true); setError(null); setState({ phase: 'loading' });
    try {
      const result = await client.auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
      if (mounted.current && generation.current === version) accept(null);
    } catch {
      if (mounted.current && current.current === null) {
        setState({ phase: 'signed-out' });
        setError('Signed out on this device. We could not confirm server sign-out. You can sign in again.');
      } else if (mounted.current && generation.current === version) {
        setState(previous); setError('Unable to sign out. Please try again.');
      }
    } finally { if (mounted.current) setPending(false); }
  };
  const signUp = async (email: string, password: string) => {
    callbackRejected.current = false;
    setPending(true); setError(null); const version = generation.current;
    try {
      const result = await client.auth.signUp({ email, password,
        options: { emailRedirectTo: new URL('/auth/callback', window.location.origin).href } });
      if (!mounted.current) return;
      if (result.error && generation.current === version) setError(retryableAuthError(result.error)
        ? 'Account creation is temporarily unavailable. Please try again.'
        : 'Unable to create your account. Check your details and try again.');
      else if (result.data.session) {
        if (current.current?.access_token !== result.data.session.access_token) accept(result.data.session);
      } else if (generation.current === version) setState({ phase: 'confirmation-required', email });
    } catch { if (mounted.current) setError('Unable to create your account. Please try again.'); }
    finally { if (mounted.current) setPending(false); }
  };
  return { state, pending, error, signIn, signUp, signOut, retry: () => {
    if (state.phase === 'callback-error' || state.phase === 'confirmation-required') { callbackRejected.current = false; accept(null); }
    else if (current.current) accept(current.current);
    else void restore();
  } };
}
