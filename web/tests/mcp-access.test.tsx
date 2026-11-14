import { afterEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { authFixture, session } from './auth-fixtures';

const clientId = 'fd56dafb-3d59-4688-a9a9-cb4e17a65939';
const authorizationId = '4755fd36-deb4-4819-a3d5-07116b52d15d';
const externalClient = { id: clientId, name: 'ChatGPT' };
const account = { id: 'verified-a', email: 'owner@example.test' };

function fixture(path: string) {
  history.replaceState(null, '', path);
  const { client } = authFixture(session());
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    Response.json(url.endsWith('/api/me') ? { user: account } : { connections: [], nextCursor: null })));
  return client;
}

afterEach(() => {
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

test('OAuth consent identifies the verified user and explains financial access', async () => {
  const client = fixture('/oauth/consent?authorization_id=' + authorizationId);
  Object.defineProperty(client.auth, 'oauth', { value: {
    getAuthorizationDetails: vi.fn(async () => ({
      data: { authorization_id: authorizationId, redirect_uri: 'https://chatgpt.com/callback', client: externalClient, user: account, scope: 'openid' },
      error: null,
    })),
    approveAuthorization: vi.fn(async () => ({ data: null, error: new Error('private diagnostic') })),
  } });
  render(<App client={client} apiUrl="https://fin.example.test" mcpClientIds={[clientId]} />);
  const confirmAccount = await screen.findByRole('button', { name: 'Use this FinSight account' });
  expect(client.auth.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
  await userEvent.click(confirmAccount);
  expect(await screen.findByRole('heading', { name: 'Authorize ChatGPT' })).toBeVisible();
  expect(screen.getByText(account.email)).toBeVisible();
  expect(screen.getByText(/current and future financial connections/i)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Allow read access' }));
  expect(client.auth.oauth.approveAuthorization).toHaveBeenCalledWith(authorizationId, { skipBrowserRedirect: true });
  expect(await screen.findByText('Unable to complete authorization. Try again.')).toBeVisible();
});

test('revoking an agent grant refreshes the authorization list', async () => {
  const client = fixture('/');
  const listGrants = vi.fn().mockResolvedValueOnce({
    data: [{ client: externalClient, scopes: ['openid'], granted_at: '2026-11-14T00:00:00Z' }], error: null,
  }).mockResolvedValue({ data: [], error: null });
  const revokeGrant = vi.fn().mockResolvedValue({ data: {}, error: null });
  Object.defineProperty(client.auth, 'oauth', { value: { listGrants, revokeGrant } });
  render(<App client={client} apiUrl="https://fin.example.test" mcpClientIds={[clientId]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Revoke ChatGPT' }));
  expect(revokeGrant).toHaveBeenCalledWith({ clientId });
  expect(await screen.findByText('No agents are authorized.')).toBeVisible();
});
