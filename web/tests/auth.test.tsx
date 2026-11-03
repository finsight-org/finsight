import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { authFixture, deferred, session } from './auth-fixtures';

const success = () => Response.json({ user: { id: 'verified-a', email: 'verified@example.test' } });
function show(f = authFixture()) { render(<App client={f.client} apiUrl="http://127.0.0.1:4001" />); return f; }
test('restoration hides the home until the backend verifies the stored session', async () => {
  const response = deferred<Response>(); vi.stubGlobal('fetch', () => response.promise);
  const f = show(authFixture(session()));
  expect(screen.queryByText('verified@example.test')).not.toBeInTheDocument();
  response.resolve(success());
  expect(await screen.findByText('verified@example.test')).toBeVisible();
  expect(screen.queryByText('unverified-metadata@example.test')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(f.current).toBeNull(); expect(f.signOutScopes).toEqual(['local']);
});
test('failed password can be retried and successful sign-in displays only verified identity', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(success)); show();
  await screen.findByRole('button', { name: 'Sign in' });
  await userEvent.type(screen.getByLabelText('Email'), 'a@example.test');
  await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_DIAGNOSTIC');
  await userEvent.clear(screen.getByLabelText('Password'));
  await userEvent.type(screen.getByLabelText('Password'), 'correct-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('verified@example.test')).toBeVisible();
});
test('verification outage preserves the session and Retry recovers; 401 discards it', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 })).mockImplementation(success);
  vi.stubGlobal('fetch', transport); const f = show(authFixture(session()));
  await screen.findByRole('button', { name: 'Retry' }); expect(f.current).not.toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('verified@example.test')).toBeVisible();
  transport.mockResolvedValue(Response.json({}, { status: 401 }));
  act(() => f.emit('TOKEN_REFRESHED', session('expired')));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(f.current).toBeNull();
});
test('a late verification cannot restore a signed-out user', async () => {
  const response = deferred<Response>(); const transport = vi.fn(() => response.promise); vi.stubGlobal('fetch', transport);
  const f = show(authFixture(session()));
  await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { Authorization: 'Bearer token-a' } })));
  act(() => f.emit('SIGNED_OUT', null));
  await screen.findByRole('button', { name: 'Sign in' });
  await act(async () => response.resolve(success()));
  expect(screen.queryByText('verified@example.test')).not.toBeInTheDocument();
});
test('a late response from user A cannot replace user B and subscriptions clean up', async () => {
  const a = deferred<Response>();
  const transport = vi.fn((_url: string, init: RequestInit) => (init.headers as Record<string, string>).Authorization === 'Bearer token-a'
    ? a.promise : Promise.resolve(Response.json({ user: { id: 'verified-b', email: 'b@example.test' } })));
  vi.stubGlobal('fetch', transport);
  const f = authFixture(session()); const view = render(<App client={f.client} apiUrl="http://127.0.0.1:4001" />);
  await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { Authorization: 'Bearer token-a' } })));
  act(() => f.emit('SIGNED_IN', session('b')));
  expect(await screen.findByText('b@example.test')).toBeVisible();
  await act(async () => a.resolve(success()));
  expect(screen.queryByText('verified@example.test')).not.toBeInTheDocument();
  view.unmount(); expect(f.unsubscribed).toBe(true);
});
test('a failed sign-out is visible and retryable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(success)); const f = show(authFixture(session()));
  await screen.findByText('verified@example.test'); f.failSignOut = true;
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_DIAGNOSTIC');
  expect(f.current).not.toBeNull(); f.failSignOut = false;
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('SDK refresh outages keep the restoration retryable even after INITIAL_SESSION null', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(success));
  const f = authFixture(session()); f.initialNullEvent = true;
  f.initializationError = new AuthRetryableFetchError('temporary', 503);
  f.restorationFailure = new AuthRetryableFetchError('temporary', 503);
  show(f);
  await screen.findByRole('button', { name: 'Retry' });
  expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  expect(f.current).not.toBeNull();
  f.restorationFailure = null;
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('verified@example.test')).toBeVisible();
});
test('Auth sign-in outages permit retrying the same credentials without blaming the password', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(success)); const f = show();
  await screen.findByRole('button', { name: 'Sign in' });
  await userEvent.type(screen.getByLabelText('Email'), 'a@example.test');
  await userEvent.type(screen.getByLabelText('Password'), 'correct-password');
  f.signInFailure = new AuthRetryableFetchError('temporary', 503);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
  expect(screen.getByRole('alert')).not.toHaveTextContent(/check your email and password/i);
  f.signInFailure = null;
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('verified@example.test')).toBeVisible();
});
test('a remote logout failure remains visible after the SDK clears local session state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(success)); const f = show(authFixture(session()));
  await screen.findByText('verified@example.test'); f.failSignOut = true; f.clearOnFailedSignOut = true;
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(/signed out on this device/i);
  expect(screen.getByRole('alert')).toHaveTextContent(/server sign-out/i);
  expect(f.current).toBeNull();
});
