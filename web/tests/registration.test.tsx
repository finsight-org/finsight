import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { authFixture, deferred, session } from './auth-fixtures';

async function register(f = authFixture()) {
  render(<App client={f.client} apiUrl="http://127.0.0.1:4001" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
  await userEvent.type(screen.getByLabelText('Email'), 'new@example.test');
  await userEvent.type(screen.getByLabelText('Password'), 'correct-password');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  return f;
}
test('registration without a session requires confirmation and keeps the home protected', async () => {
  const transport = vi.fn(); vi.stubGlobal('fetch', transport);
  const f = await register();
  expect(await screen.findByText(/check your inbox/i)).toBeVisible();
  expect(screen.queryByText('Your provider connections')).not.toBeInTheDocument();
  expect(transport).not.toHaveBeenCalled();
  expect(f.signupRedirect).toBe(window.location.origin + '/auth/callback');
  await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
});
test('confirmation-disabled registration still verifies its immediate session through the backend', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user: { id: 'new-user', email: 'new@example.test' } })));
  const f = authFixture(); f.immediateSignup = true; await register(f);
  expect(await screen.findByText('Your provider connections')).toBeVisible();
  expect(screen.getByText('new@example.test')).toBeVisible();
});
test('pending registration prevents repeat submits and safe errors permit retry', async () => {
  const pending = deferred<void>(); const f = authFixture(); f.signupPending = pending.promise; f.failSignup = true;
  await register(f);
  expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
  await act(async () => pending.resolve());
  expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_DIAGNOSTIC');
  expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
});
test('a successful SDK callback is verified and removes its code from the address', async () => {
  window.history.replaceState(null, '', '/auth/callback?code=disposable-code');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user: { id: 'callback-user', email: 'confirmed@example.test' } })));
  const f = authFixture(session()); render(<App client={f.client} apiUrl="http://127.0.0.1:4001" />);
  expect(await screen.findByText('confirmed@example.test')).toBeVisible();
  expect(window.location.pathname).toBe('/'); expect(window.location.search).toBe('');
});
test.each(['expired code', 'missing PKCE verifier', 'explicit callback error', 'missing code'])('%s shows an ordinary sign-in fallback without unlocking the home', async issue => {
  window.history.replaceState(null, '', issue === 'explicit callback error' ? '/auth/callback?error=access_denied&error_description=PRIVATE_DIAGNOSTIC' : '/auth/callback');
  const f = authFixture(); if (issue !== 'missing code') f.initializationError = new Error('PRIVATE_DIAGNOSTIC');
  render(<App client={f.client} apiUrl="http://127.0.0.1:4001" />);
  expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_DIAGNOSTIC');
  expect(screen.queryByText('Your provider connections')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
});
test('a stale restored session cannot override a newer sign-in event', async () => {
  const restored = deferred<{ data: { session: ReturnType<typeof session> }; error: null }>();
  const f = authFixture(); f.restoration = restored.promise;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user: { id: 'new-user', email: 'b@example.test' } })));
  render(<App client={f.client} apiUrl="http://127.0.0.1:4001" />);
  act(() => f.emit('SIGNED_IN', session('b')));
  await screen.findByText('b@example.test');
  await act(async () => restored.resolve({ data: { session: session('a') }, error: null }));
  await waitFor(() => expect(screen.getByText('b@example.test')).toBeVisible());
});

test('an unconsumed callback code never treats an existing account as the confirmed account', async () => {
  window.history.replaceState(null, '', '/auth/callback?code=missing-verifier-code');
  const f = authFixture(session('old-account')); f.consumeCallback = false; f.recoverDuringCallback = true;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user: { id: 'old-account', email: 'old@example.test' } })));
  render(<App client={f.client} apiUrl="http://127.0.0.1:4001" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not finish sign-in/i);
  await act(async () => f.emit('SIGNED_IN', session('old-account')));
  expect(screen.getByRole('alert')).toHaveTextContent(/could not finish sign-in/i);
  expect(screen.queryByText('old@example.test')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
});
