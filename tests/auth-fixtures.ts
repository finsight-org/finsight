import { createServer } from 'node:http';
import type { TestContext } from 'node:test';

export const authConfig = {
  supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_test',
  webOrigins: ['http://127.0.0.1:5173', 'http://127.0.0.1:8080'],
};

export async function authFixture(t: TestContext) {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    calls.push(token);
    res.setHeader('Content-Type', 'application/json');
    if (req.url !== '/auth/v1/user' || req.headers.apikey !== 'sb_publishable_test') {
      res.writeHead(404).end('{}'); return;
    }
    if (token === 'timeout') { const timer = setTimeout(() => res.end('{}'), 300); res.once('close', () => clearTimeout(timer)); return; }
    if (token === 'server-error') { res.writeHead(500).end('{"message":"PRIVATE_DIAGNOSTIC"}'); return; }
    if (!['token-a', 'token-b'].includes(token)) { res.writeHead(401).end('{"message":"PRIVATE_DIAGNOSTIC"}'); return; }
    const suffix = token.at(-1);
    res.end(JSON.stringify({ id: `user-${suffix}`, aud: 'authenticated', role: 'authenticated',
      email: `${suffix}@example.test`, created_at: '2026-11-02T00:00:00Z', app_metadata: {}, user_metadata: {} }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(err => err ? reject(err) : resolve()); }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not listen.');
  return { config: { ...authConfig, supabaseUrl: `http://127.0.0.1:${address.port}` }, calls };
}
