import { expect, test, vi } from 'vitest';
import { getCurrentUser } from '../src/lib/api';
test('API sends only a bearer credential and consumes the verified user response', async () => {
  const transport = vi.fn().mockResolvedValue(Response.json({ user: { id: 'verified-a', email: 'a@example.test' } }));
  vi.stubGlobal('fetch', transport);
  expect(await getCurrentUser('http://127.0.0.1:4001', 'token-a', new AbortController().signal)).toEqual({ id: 'verified-a', email: 'a@example.test' });
  expect(transport).toHaveBeenCalledWith('http://127.0.0.1:4001/api/me', expect.objectContaining({ headers: { Authorization: 'Bearer token-a' }, credentials: 'omit', cache: 'no-store' }));
});
test('API classifies rejected credentials separately from retryable failures', async () => {
  for (const [status, body, kind] of [[401, {}, 'unauthenticated'], [503, {}, 'unavailable'], [200, { user: { id: 123 } }, 'unavailable']] as const) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })));
    await expect(getCurrentUser('http://localhost:4000', 'token', new AbortController().signal)).rejects.toMatchObject({ kind });
  }
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private diagnostic')));
  await expect(getCurrentUser('http://localhost:4000', 'token', new AbortController().signal)).rejects.toMatchObject({ kind: 'unavailable' });
});
