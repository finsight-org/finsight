import { randomBytes, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { WealthsimpleClient } from '../src/providers/wealthsimple/client.js';
import { parseWealthsimpleSnapshot } from '../src/providers/wealthsimple/snapshot.js';
import { createSessionCipher } from '../src/sessions/crypto.js';
import type { DurableSession } from '../src/sessions/model.js';
import type { SessionStore } from '../src/sessions/store.js';
import { WealthsimpleSessionService, type SessionAccess } from '../src/sessions/wealthsimple-service.js';
import { accountQuery, deferred } from './wealthsimple-fixtures.js';

export const query = { query: accountQuery };
export const credentials = (email = 'a1@example.test') => ({ email, password: 'PASSWORD_SENTINEL' });
export function access(userId: string = randomUUID(), providerId = 'wealthsimple'): SessionAccess {
  return { binding: { connectionId: randomUUID(), userId, providerId }, async checkOwnership() {} };
}
export function barrier() {
  const entered = deferred(), release = deferred();
  return { entered: entered.promise, release: () => release.resolve(),
    async wait() { entered.resolve(); await release.promise; } };
}

class MemoryStore implements SessionStore {
  rows = new Map<string, DurableSession>();
  loads = 0;
  saves = 0;
  removals = 0;
  saveMode: 'ok' | 'fail' | 'commit-then-fail' = 'ok';
  failRemove = false;
  saveBarrier?: ReturnType<typeof barrier>;
  removeBarrier?: ReturnType<typeof barrier>;
  saveSignal?: AbortSignal;

  async load(id: string, signal: AbortSignal) {
    this.loads++;
    signal.throwIfAborted();
    return structuredClone(this.rows.get(id) ?? null);
  }
  async save(id: string, row: DurableSession, signal: AbortSignal) {
    this.saves++;
    this.saveSignal = signal;
    await this.saveBarrier?.wait();
    signal.throwIfAborted();
    if (this.saveMode === 'fail') throw Error('synthetic storage failure');
    this.rows.set(id, structuredClone(row));
    if (this.saveMode === 'commit-then-fail') throw Error('synthetic lost response');
  }
  async remove(id: string, signal: AbortSignal) {
    this.removals++;
    await this.removeBarrier?.wait();
    signal.throwIfAborted();
    if (this.failRemove) throw Error('synthetic storage failure');
    this.rows.delete(id);
  }
}

interface Call { path: string; grant?: string; bearer: string; cookies: string; device: string; refresh?: string; }
export function sessionFixture(t: TestContext) {
  const calls: Call[] = [];
  const store = new MemoryStore();
  const cipher = createSessionCipher(randomBytes(32));
  const a1 = access(), a2 = access(a1.binding.userId), b1 = access();
  const signal = new AbortController().signal;
  const controls = {
    now: 1, clients: 0, infoOutage: false, malformedInfo: false, requireOtp: false, rejectRefresh: false,
    rejectAccess: new Set<string>(), queryCookie: '', queryStatus: 200, malformed: false,
    beforeResponse: async (_call: Call, _signal: AbortSignal) => {},
  };
  const tokenOwners = new Map<string, string>();
  let issuance = 0, devices = 0;
  const base = 'https://fixture.example.test';
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const call: Call = { path: url.pathname, grant: body.grant_type, refresh: body.refresh_token,
      bearer: (headers.get('authorization') ?? '').replace(/^Bearer /, ''),
      cookies: headers.get('cookie') ?? '', device: headers.get('x-ws-device-id') ?? '' };
    calls.push(call);
    await controls.beforeResponse(call, init!.signal!);
    init!.signal!.throwIfAborted();
    const reply = (value: unknown, status = 200, cookie?: string) => {
      const response = new Response(typeof value === 'string' ? value : JSON.stringify(value),
        { status, headers: cookie ? { 'set-cookie': cookie } : {} });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    };
    switch (call.path) {
      case '/login':
        return reply('<script src="/assets/app-fixture.js"></script>', 200, 'wssdi=device-' + ++devices + '; Path=/');
      case '/assets/app-fixture.js':
        return reply('const config={environment:"production",clientId:"fixture-client"};');
      case '/token': {
        const refresh = call.grant === 'refresh_token';
        const owner = refresh ? tokenOwners.get(body.refresh_token) : body.username;
        if (!owner || (refresh && controls.rejectRefresh)) return reply({ error: 'invalid_grant' }, 401);
        if (!refresh && body.password !== 'PASSWORD_SENTINEL') return reply({ error: 'bad_credentials' }, 401);
        if (!refresh && controls.requireOtp && !headers.has('x-wealthsimple-otp')) return reply({ error: 'otp_required' }, 400);
        const suffix = owner + '-' + ++issuance;
        const accessToken = 'ACCESS_SENTINEL-' + suffix, refreshToken = 'REFRESH_SENTINEL-' + suffix;
        tokenOwners.set(accessToken, owner);
        tokenOwners.set(refreshToken, owner);
        return reply({ access_token: accessToken, refresh_token: refreshToken }, 200,
          refresh ? undefined : 'auth=COOKIE_SENTINEL-' + owner + '; Path=/; HttpOnly');
      }
      case '/info':
        if (controls.infoOutage) return reply('outage', 503);
        if (controls.malformedInfo) return reply('null');
        if (controls.rejectAccess.has(call.bearer)) return reply({}, 401);
        return reply({ identity_canonical_id: tokenOwners.get(call.bearer) });
      case '/graphql':
        if (controls.rejectAccess.has(call.bearer)) return reply({}, 401);
        return reply(controls.malformed ? 'invalid JSON' :
          { data: { identityId: body.variables.identityId, balance: '765.43', currency: 'CAD' } },
          controls.queryStatus, controls.queryCookie || undefined);
      default: throw Error('unexpected synthetic request');
    }
  };
  const createService = () => new WealthsimpleSessionService({ store, cipher, now: () => controls.now,
    createClient: () => {
      controls.clients++;
      return new WealthsimpleClient({ fetch, endpoints: { login: base + '/login', token: base + '/token',
        tokenInfo: base + '/info', graphql: base + '/graphql' } });
    } });
  let service = createService();
  t.after(() => service.close());
  return { get service() { return service; }, store, cipher, a1, a2, b1, signal, calls, controls,
    passwordGrants: () => calls.filter(call => call.grant === 'password').length,
    async restart() { await service.close(); service = createService(); },
    snapshot(record = a1) {
      const row = store.rows.get(record.binding.connectionId);
      if (row?.state !== 'connected') throw Error('Expected a saved connected session.');
      return parseWealthsimpleSnapshot(JSON.parse(cipher.decrypt(record.binding, row.envelope)));
    } };
}
