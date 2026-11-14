import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { authFixture, deferred, session } from './auth-fixtures';

const origin = 'http://127.0.0.1:4001';
const collection = '/api/connections';
const personal = '29aa3b7b-0941-4271-89ff-55021743d2ab';
const savings = '8ef562fc-7fa1-49cd-8530-fffb36b40975';
const recordPath = (id = personal) => `${collection}/${id}`;
const sessionPath = (id = personal) => `${recordPath(id)}/session`;
const record = (id = personal, label: string | null = 'Personal') => ({
  id, label, providerId: 'wealthsimple', createdAt: '2026-11-14T12:00:00Z', updatedAt: '2026-11-14T12:00:00Z',
});
const page = (connections = [record()], nextCursor: string | null = null) => Response.json({ connections, nextCursor });
const status = (value: string) => Response.json({ status: value });
const error = (status: number, code: string) => Response.json({ error: { code, message: 'PRIVATE_DIAGNOSTIC' } }, { status });
const verified = (id = 'a') => Response.json({ user: { id: `verified-${id}`, email: `${id}@finsight.test` } });
type Handler = (url: URL, method: string, init: RequestInit) => Response | Promise<Response>;

function show(handle: Handler) {
  const transport = vi.fn((href: string, init: RequestInit) => {
    const url = new URL(href);
    if (url.origin !== origin) throw Error('Unexpected API origin');
    const method = init.method ?? 'GET';
    return Promise.resolve(handle(url, method, init));
  });
  vi.stubGlobal('fetch', transport);
  const auth = authFixture(session());
  const view = render(<App client={auth.client} apiUrl={origin} />);
  return { auth, view, transport, user: userEvent.setup() };
}

function button(name: string) {
  return screen.findByRole('button', { name });
}

const providerCredentials = { email: 'wealthsimple@example.test', password: 'synthetic-provider-password' };
async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Wealthsimple email'), providerCredentials.email);
  await user.type(screen.getByLabelText('Wealthsimple password'), providerCredentials.password);
}

test.each([false, true])('creates one record and completes first login (MFA: %s)', async mfa => {
  const logins: unknown[] = [];
  const pending = deferred<Response>();
  let creates = 0;
  const { transport, user } = show(({ pathname }, method, init) => {
    if (pathname === '/api/me') return verified();
    if (pathname === collection && method === 'GET') return page([]);
    if (pathname === collection && method === 'POST') {
      creates++;
      expect(JSON.parse(String(init.body))).toEqual({ providerId: 'wealthsimple', label: 'Personal' });
      return Response.json({ connection: record() }, { status: 201 });
    }
    if (pathname === sessionPath() && method === 'POST') {
      logins.push(JSON.parse(String(init.body)));
      return logins.length === 1 ? pending.promise : status('connected');
    }
    throw Error(`Unexpected request ${method} ${pathname}`);
  });

  await user.click(await button('Add Wealthsimple connection'));
  await user.type(screen.getByLabelText(/connection label/i), 'Personal');
  await fillCredentials(user);
  const connect = await button('Connect');
  await user.dblClick(connect);
  await waitFor(() => expect(logins).toEqual([providerCredentials]));
  expect(connect).toBeDisabled();
  await act(async () => pending.resolve(status(mfa ? 'mfa_required' : 'connected')));

  if (mfa) {
    await user.type(await screen.findByLabelText('Verification code'), '012345');
    await user.click(await button('Verify and connect'));
    expect(logins).toEqual([providerCredentials, { ...providerCredentials, otp: '012345' }]);
  }
  expect(await screen.findByText('Connected', { exact: true })).toBeVisible();
  expect(creates).toBe(1);
  expect(screen.queryByLabelText('Wealthsimple password')).toBeNull();
  for (const [href, init] of transport.mock.calls.filter(([href]) => !href.endsWith('/api/me'))) {
    expect(new URL(href).pathname).toMatch(/^\/api\/connections/);
    expect(init).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
  }
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(providerCredentials.password);
  expect(document.body.textContent).not.toContain('012345');
});

test('a rejected verification can start again on the same record and keeps FinSight signed in', async () => {
  const submitted: unknown[] = [];
  let providerState = 'mfa_required';
  const { auth, user } = show(({ pathname }, method, init) => {
    if (pathname === '/api/me') return verified();
    if (pathname === collection && method === 'GET') return page();
    if (pathname === sessionPath() && method === 'GET') return status(providerState);
    if (pathname === sessionPath() && method === 'POST') {
      submitted.push(JSON.parse(String(init.body)));
      providerState = submitted.length === 1 ? 'disconnected' : 'connected';
      return submitted.length === 1 ? error(401, 'WEALTHSIMPLE_LOGIN_FAILED') : status('connected');
    }
    throw Error(`Unexpected request ${method} ${pathname}`);
  });

  await user.click(await button('Resume verification'));
  await fillCredentials(user);
  await user.type(screen.getByLabelText('Verification code'), '000000');
  await user.click(await button('Verify and connect'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/password or verification code/i);
  expect(auth.current?.access_token).toBe('token-a');
  expect(screen.getByLabelText('Wealthsimple password')).toHaveValue('');
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  await user.type(screen.getByLabelText('Wealthsimple password'), providerCredentials.password);
  await user.click(await button('Connect'));
  expect(await screen.findByText('Connected', { exact: true })).toBeVisible();
  expect(submitted).toEqual([{ ...providerCredentials, otp: '000000' }, providerCredentials]);
});

test('loads saved records independently of status and follows the cursor', async () => {
  const slow = deferred<Response>();
  let statusAttempts = 0;
  const { user } = show((url, method) => {
    if (url.pathname === '/api/me') return verified();
    if (url.pathname === collection) {
      return url.searchParams.get('cursor') === 'second_page' ? page([record(savings, null)]) : page([record()], 'second_page');
    }
    if (url.pathname === sessionPath() && method === 'GET') {
      return ++statusAttempts === 1 ? slow.promise : status('expired');
    }
    if (url.pathname === sessionPath(savings) && method === 'GET') return status('disconnected');
    throw Error(`Unexpected request ${method} ${url.pathname}`);
  });

  expect(await screen.findByText('Personal')).toBeVisible();
  expect(screen.getByText('Checking status…')).toBeVisible();
  await act(async () => slow.resolve(error(502, 'WEALTHSIMPLE_UPSTREAM_FAILURE')));
  expect(await screen.findByText('Status unavailable')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  await user.click(await button('Retry status'));
  expect(await screen.findByText('Expired')).toBeVisible();
  await user.click(await button('Load more'));
  expect(await screen.findByText('Wealthsimple', { selector: 'h3' })).toBeVisible();
  expect(await screen.findByText('Disconnected')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  expect(screen.queryByText('PRIVATE_DIAGNOSTIC')).toBeNull();
});

test.each(['SESSION_STATE_UNAVAILABLE', 'SESSION_NOT_CONFIGURED'])(
  'can remove a saved record after confirmation when status returns %s',
  async code => {
    let removals = 0;
    const { user } = show(({ pathname }, method) => {
      if (pathname === '/api/me') return verified();
      if (pathname === collection && method === 'GET') return page();
      if (pathname === sessionPath() && method === 'GET') return error(503, code);
      if (pathname === recordPath() && method === 'DELETE') {
        removals++;
        return new Response(null, { status: 204 });
      }
      throw Error(`Unexpected request ${method} ${pathname}`);
    });

    expect(await screen.findByText('Status unavailable')).toBeVisible();
    await user.click(await button('Remove'));
    const confirmation = screen.getByRole('dialog', { name: 'Remove saved connection' });
    expect(confirmation).toHaveTextContent(/clear any active session/i);
    expect(removals).toBe(0);
    await user.click(within(confirmation).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No saved connections yet.')).toBeVisible();
    expect(removals).toBe(1);
  },
);

test('reconnects an expired session, clears its label, disconnects it, and confirms removal', async () => {
  let saved = record();
  let providerState = 'expired';
  let removals = 0;
  const { user } = show(({ pathname }, method, init) => {
    if (pathname === '/api/me') return verified();
    if (pathname === collection && method === 'GET') return page([saved]);
    if (pathname === recordPath() && method === 'PATCH') {
      expect(JSON.parse(String(init.body))).toEqual({ label: null });
      saved = record(personal, null);
      return Response.json({ connection: saved });
    }
    if (pathname === recordPath() && method === 'DELETE') {
      removals++;
      return new Response(null, { status: 204 });
    }
    if (pathname === sessionPath()) {
      if (method === 'GET') return status(providerState);
      if (method === 'POST') return status(providerState = 'connected');
      if (method === 'DELETE') {
        providerState = 'disconnected';
        return new Response(null, { status: 204 });
      }
    }
    throw Error(`Unexpected request ${method} ${pathname}`);
  });

  await user.click(await button('Reconnect'));
  await fillCredentials(user);
  await user.click(await button('Connect'));
  expect(await screen.findByText('Connected', { exact: true })).toBeVisible();
  await user.click(await button('Rename'));
  await user.clear(screen.getByLabelText(/connection label/i));
  await user.click(await button('Save name'));
  expect(await screen.findByText('Wealthsimple', { selector: 'h3' })).toBeVisible();
  await user.click(await button('Disconnect'));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect' }));
  expect(await screen.findByText('Disconnected')).toBeVisible();
  expect(removals).toBe(0);
  await user.click(await button('Remove'));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(removals).toBe(0);
  await user.click(await button('Remove'));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
  expect(await screen.findByText('No saved connections yet.')).toBeVisible();
  expect(removals).toBe(1);
});

test('reconciles an uncertain create through the last page without retrying the write', async () => {
  let creates = 0;
  const { user } = show((url, method) => {
    if (url.pathname === '/api/me') return verified();
    if (url.pathname === collection && method === 'POST') {
      creates++;
      return error(503, 'CONNECTION_STORAGE_UNAVAILABLE');
    }
    if (url.pathname === collection && method === 'GET') {
      return url.searchParams.has('cursor') ? page([record(savings, 'Recovered')]) : page([record()], creates ? 'tail' : null);
    }
    if (url.pathname.startsWith(collection) && method === 'GET') return status('disconnected');
    throw Error(`Unexpected request ${method} ${url.pathname}`);
  });

  await user.click(await button('Add Wealthsimple connection'));
  await fillCredentials(user);
  await user.click(await button('Connect'));
  expect(await screen.findByText('Recovered')).toBeVisible();
  expect(await screen.findByRole('alert')).toHaveTextContent(/check your saved connections/i);
  expect(screen.queryByLabelText('Wealthsimple password')).toBeNull();
  expect(creates).toBe(1);
});

test('pauses an open MFA form through token verification and then uses the new verified token', async () => {
  const verification = deferred<Response>();
  const submitted: Array<{ token: string | null; body: unknown }> = [];
  const { auth, user } = show(({ pathname }, method, init) => {
    const token = new Headers(init.headers).get('Authorization');
    if (pathname === '/api/me') return token === 'Bearer rotated' ? verification.promise : verified();
    if (pathname === collection) return page();
    if (pathname === sessionPath() && method === 'GET') return status('disconnected');
    if (pathname === sessionPath() && method === 'POST') {
      submitted.push({ token, body: JSON.parse(String(init.body)) });
      return status(submitted.length === 1 ? 'mfa_required' : 'connected');
    }
    throw Error(`Unexpected request ${method} ${pathname}`);
  });

  await user.click(await button('Connect again'));
  await fillCredentials(user);
  await user.click(await button('Connect'));
  await user.type(await screen.findByLabelText('Verification code'), '014321');
  act(() => auth.emit('TOKEN_REFRESHED', { ...session(), access_token: 'rotated' }));
  expect(await button('Verify and connect')).toBeDisabled();
  expect(screen.getByLabelText('Verification code')).toHaveValue('014321');
  await act(async () => verification.resolve(verified()));
  await user.click(await button('Verify and connect'));
  expect(await screen.findByText('Connected', { exact: true })).toBeVisible();
  expect(submitted[1]).toEqual({ token: 'Bearer rotated', body: { ...providerCredentials, otp: '014321' } });
});

test('an account switch aborts old work and discards a late response and the open form', async () => {
  const late = deferred<Response>();
  let oldSignal: AbortSignal | null | undefined;
  const { auth, user } = show(({ pathname }, method, init) => {
    const isB = new Headers(init.headers).get('Authorization') === 'Bearer token-b';
    if (pathname === '/api/me') return verified(isB ? 'b' : 'a');
    if (pathname === collection) return isB ? page([record(savings, 'User B')]) : page();
    if (pathname === sessionPath() && method === 'POST') {
      oldSignal = init.signal;
      return late.promise;
    }
    if (method === 'GET') return status('disconnected');
    throw Error(`Unexpected request ${method} ${pathname}`);
  });

  await user.click(await button('Connect again'));
  await fillCredentials(user);
  await user.click(await button('Connect'));
  await waitFor(() => expect(oldSignal).toBeDefined());
  act(() => auth.emit('SIGNED_IN', session('b')));
  expect(await screen.findByText('User B')).toBeVisible();
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => late.resolve(status('mfa_required')));
  expect(screen.queryByText('Personal')).toBeNull();
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  expect(screen.queryByLabelText('Wealthsimple password')).toBeNull();
});

test('does not send the provider login when FinSight starts token verification during record creation', async () => {
  const creation = deferred<Response>();
  const verification = deferred<Response>();
  const loginTokens: string[] = [];
  let creates = 0;
  const { auth, user } = show(({ pathname }, method, init) => {
    const token = new Headers(init.headers).get('Authorization')!;
    if (pathname === '/api/me') return token === 'Bearer rotated' ? verification.promise : verified();
    if (pathname === collection && method === 'GET') return page([]);
    if (pathname === collection && method === 'POST') {
      creates++;
      return creation.promise;
    }
    if (pathname === sessionPath() && method === 'POST') {
      loginTokens.push(token);
      return status('connected');
    }
    throw Error(`Unexpected request ${method} ${pathname}`);
  });

  await user.click(await button('Add Wealthsimple connection'));
  await fillCredentials(user);
  await user.click(await button('Connect'));
  await waitFor(() => expect(creates).toBe(1));
  await act(async () => {
    auth.emit('TOKEN_REFRESHED', { ...session(), access_token: 'rotated' });
    creation.resolve(Response.json({ connection: record() }, { status: 201 }));
  });
  expect(loginTokens).toEqual([]);
  expect(await button('Connect')).toBeDisabled();

  await act(async () => verification.resolve(verified()));
  await user.click(await button('Connect'));
  expect(await screen.findByText('Connected', { exact: true })).toBeVisible();
  expect(loginTokens).toEqual(['Bearer rotated']);
  expect(creates).toBe(1);
});

test('verifies a rejected FinSight token again and signs out when it is invalid', async () => {
  let meRequests = 0;
  const { auth } = show(({ pathname }) => {
    if (pathname === '/api/me') return ++meRequests === 1 ? verified() : error(401, 'UNAUTHENTICATED');
    if (pathname === collection) return error(401, 'UNAUTHENTICATED');
    throw Error(`Unexpected request ${pathname}`);
  });

  expect(await button('Sign in')).toBeVisible();
  expect(meRequests).toBe(2);
  expect(auth.signOutScopes).toEqual(['local']);
});

test('checks the saved session after a malformed disconnect response before offering another attempt', async () => {
  let statusChecks = 0;
  const { user } = show(({ pathname }, method) => {
    if (pathname === '/api/me') return verified();
    if (pathname === collection) return page();
    if (pathname === sessionPath() && method === 'GET') {
      statusChecks++;
      return status('connected');
    }
    if (pathname === sessionPath() && method === 'DELETE') return new Response('bad response', { status: 200 });
    throw Error(`Unexpected request ${method} ${pathname}`);
  });

  await user.click(await button('Disconnect'));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not update/i);
  expect(screen.getByText('Connected', { exact: true })).toBeVisible();
  expect(statusChecks).toBe(2);
});

test('a failed sign-out still allows recovery from a later rejected FinSight token', async () => {
  let expired = false;
  const { auth, user } = show(({ pathname }) => {
    if (pathname === '/api/me') return expired ? error(401, 'UNAUTHENTICATED') : verified();
    if (pathname === collection) return expired ? error(401, 'UNAUTHENTICATED') : page();
    if (pathname === sessionPath()) return status('disconnected');
    throw Error(`Unexpected request ${pathname}`);
  });

  await button('Refresh connections');
  auth.failSignOut = true;
  await user.click(await button('Sign out'));
  expect(await screen.findByText('Unable to sign out. Please try again.')).toBeVisible();
  const refresh = await button('Refresh connections');
  await waitFor(() => expect(refresh).toBeEnabled());
  auth.failSignOut = false;
  expired = true;
  await user.click(refresh);

  expect(await button('Sign in')).toBeVisible();
  expect(auth.signOutScopes).toEqual(['local', 'local']);
});
