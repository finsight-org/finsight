import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { wealthsimpleProvider, type WealthsimpleOptions } from '../src/providers/wealthsimple/index.js';

export const endpoint = '/providers/wealthsimple/connection';
export const graphql = '/providers/wealthsimple/graphql';
export const credentials = { email: 'person@example.test', password: 'PASSWORD_SENTINEL' };
export const accountFields = 'edges { node { id nickname unifiedAccountType currency status } } pageInfo { hasNextPage endCursor }';
export const accountQuery = `query Accounts($identityId: ID!, $first: Int = 25, $after: String) { identity(id: $identityId) { accounts(filter: {}, first: $first, after: $after) { ${accountFields} } } }`;
export const tokens = { access_token: 'ACCESS_SENTINEL', refresh_token: 'REFRESH_SENTINEL' };
export function page(nodes: unknown[] = [{ id: 'a', nickname: 'Savings', unifiedAccountType: 'tfsa', currency: 'CAD', status: 'open' }], next = false, cursor: unknown = null) {
  return { data: { identity: { accounts: { edges: nodes.map(node => ({ node })), pageInfo: { hasNextPage: next, endCursor: cursor } } } } };
}
export function respond(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
export interface Call { path: string; body: Record<string, any>; headers: IncomingMessage['headers'] }
export type Override = (call: Call, req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
export async function fixture(t: TestContext, overrides: Record<string, Override> = {}, options: WealthsimpleOptions = {}) {
  const calls: Call[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      const call = { path: req.url!, body: text ? JSON.parse(text) : {}, headers: req.headers };
      calls.push(call);
      if (overrides[call.path]) { await overrides[call.path](call, req, res); return; }
      switch (call.path) {
        case '/login':
          res.setHeader('set-cookie', ['wssdi=DEVICE_SENTINEL; Path=/; HttpOnly', 'session_cookie=COOKIE_SENTINEL; Path=/']);
          res.end('<script src="/assets/app-test.js"></script>'); break;
        case '/assets/app-test.js': res.end('const config={environment:"production",clientId:"fixture-client"};'); break;
        case '/token': respond(res, tokens); break;
        case '/info': respond(res, { identity_canonical_id: 'IDENTITY_SENTINEL' }); break;
        case '/graphql': respond(res, page()); break;
        default: res.writeHead(404); res.end();
      }
    } catch { if (!res.destroyed) { res.writeHead(500); res.end(); } }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const provider = wealthsimpleProvider({ ...options, endpoints: {
    login: `${base}/login`, token: `${base}/token`, tokenInfo: `${base}/info`, graphql: `${base}/graphql`,
  } });
  const app = createApp([provider]);
  t.after(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return {
    app, calls, provider,
    login: (payload: unknown = credentials) => app.inject({ method: 'POST', url: endpoint, payload: payload as object }),
    query: (variables?: Record<string, unknown>) => app.inject({ method: 'POST', url: graphql,
      payload: { query: accountQuery, ...(variables === undefined ? {} : { variables }) } }),
  };
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
