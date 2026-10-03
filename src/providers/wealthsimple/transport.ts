import { CookieJar } from 'tough-cookie';
import { RequestAborted, WealthsimpleError } from './errors.js';

export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export interface Endpoints {
  login: string;
  token: string;
  tokenInfo: string;
  graphql: string;
}
export const defaultEndpoints: Endpoints = {
  login: 'https://my.wealthsimple.com/app/login',
  token: 'https://api.production.wealthsimple.com/v1/oauth/v2/token',
  tokenInfo: 'https://api.production.wealthsimple.com/v1/oauth/v2/token/info',
  graphql: 'https://my.wealthsimple.com/graphql',
};
export interface TransportOptions {
  /** Application/test configuration only; never sourced from incoming requests. */
  endpoints?: Partial<Endpoints>;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

export class Transport {
  readonly endpoints: Endpoints;
  #jar = new CookieJar();
  #fetch: typeof globalThis.fetch;
  #timeout: number;
  constructor(options: TransportOptions = {}) {
    this.endpoints = { ...defaultEndpoints, ...options.endpoints };
    for (const address of Object.values(this.endpoints)) {
      const url = new URL(address);
      if (url.username || url.password || (url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))) {
        throw new Error('Invalid Wealthsimple endpoint configuration.');
      }
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.requestTimeoutMs ?? 30_000;
  }

  deviceId(): string | undefined {
    return this.#jar.getCookiesSync(this.endpoints.login).find(cookie => cookie.key === 'wssdi')?.value;
  }
  clear() { this.#jar.removeAllCookiesSync(); }

  /** Discovered scripts are public assets, never arbitrary caller URLs. */
  assetUrl(path: string): string {
    const base = new URL(this.endpoints.login);
    const url = new URL(path, base);
    if (url.username || url.password || !(url.origin === base.origin ||
        (url.protocol === 'https:' && (url.hostname === 'wealthsimple.com' || url.hostname.endsWith('.wealthsimple.com'))))) {
      throw new WealthsimpleError('INVALID_RESPONSE');
    }
    return url.href;
  }

  async request(address: string, signal: AbortSignal, payload?: unknown, headers: Record<string, string> = {}) {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.#timeout)]);
    try {
      let url = new URL(address);
      const origin = url.origin;
      for (let redirects = 0; redirects <= 5; redirects++) {
        combined.throwIfAborted();
        const cookie = this.#jar.getCookieStringSync(url.href);
        const response = await this.#fetch(url, {
          method: payload === undefined ? 'GET' : 'POST',
          headers: {
            accept: 'application/json, text/html;q=0.9, */*;q=0.8',
            ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
            ...headers,
            ...(cookie ? { cookie } : {}),
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: combined, redirect: 'manual',
        });
        combined.throwIfAborted();
        for (const value of response.headers.getSetCookie()) {
          this.#jar.setCookieSync(value, url.href, { ignoreError: true });
        }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          // Never replay credentials through a redirect, even to the same origin.
          if (payload !== undefined || !location) throw new WealthsimpleError('UPSTREAM_FAILURE');
          const next = new URL(location, url);
          if (next.origin !== origin || next.username || next.password) throw new WealthsimpleError('UPSTREAM_FAILURE');
          url = next;
          continue;
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          try {
            while (true) {
              combined.throwIfAborted();
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > MAX_RESPONSE_BYTES) throw new WealthsimpleError('INVALID_RESPONSE');
              chunks.push(value);
            }
          } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
          } finally { reader.releaseLock(); }
        }
        combined.throwIfAborted();
        return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
      }
      throw new WealthsimpleError('UPSTREAM_FAILURE');
    } catch (error) {
      if (error instanceof WealthsimpleError) throw error;
      if (combined.aborted) {
        if (combined.reason instanceof WealthsimpleError) throw combined.reason;
        throw new RequestAborted(combined.reason);
      }
      throw new WealthsimpleError('UPSTREAM_FAILURE');
    }
  }
}
