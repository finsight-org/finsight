import { Cookie, CookieJar } from 'tough-cookie';
import { WealthsimpleError } from './client.js';

export interface WealthsimpleSnapshot {
  version: 1;
  session: {
    clientId: string;
    deviceId: string;
    sessionId: string;
    accessToken: string;
    refreshToken: string;
    identityId: string;
  };
  cookies: ReturnType<CookieJar['serializeSync']>;
}

const sessionKeys = ['clientId', 'deviceId', 'sessionId', 'accessToken', 'refreshToken', 'identityId'];
const jarKeys = ['version', 'storeType', 'rejectPublicSuffixes', 'enableLooseMode', 'allowSpecialUseDomain', 'prefixSecurity', 'cookies'];

/** Validate untrusted persisted material before replacing a working session. */
export function parseWealthsimpleSnapshot(value: unknown): WealthsimpleSnapshot {
  try {
    const snapshot = record(value, ['version', 'session', 'cookies']);
    if (snapshot.version !== 1) invalid();
    const session = record(snapshot.session, sessionKeys);
    for (const key of sessionKeys) {
      if (typeof session[key] !== 'string' || !session[key].trim()) invalid();
    }
    const jar = record(snapshot.cookies, jarKeys);
    if (typeof jar.version !== 'string' || !jar.version ||
        (jar.storeType !== null && typeof jar.storeType !== 'string') ||
        typeof jar.rejectPublicSuffixes !== 'boolean' || !Array.isArray(jar.cookies)) invalid();
    for (const key of ['enableLooseMode', 'allowSpecialUseDomain']) {
      if (jar[key] !== undefined && typeof jar[key] !== 'boolean') invalid();
    }
    if (jar.prefixSecurity !== undefined && (typeof jar.prefixSecurity !== 'string' ||
        !['silent', 'strict', 'unsafe-disabled'].includes(jar.prefixSecurity))) invalid();
    for (const entry of jar.cookies as unknown[]) validateCookie(entry);
    // Deserialize a JSON copy: callers cannot retain references to restored material.
    const detached = JSON.parse(JSON.stringify(snapshot)) as WealthsimpleSnapshot;
    CookieJar.deserializeSync(detached.cookies!);
    return detached;
  } catch {
    // Cookie library failures must not disclose persisted credentials or cookies.
    throw new WealthsimpleError('INVALID_REQUEST');
  }
}

function validateCookie(value: unknown) {
  const cookie = record(value, Cookie.serializableProperties);
  if (typeof cookie.key !== 'string' ||
      (cookie.value !== undefined && typeof cookie.value !== 'string') ||
      typeof cookie.domain !== 'string' || !cookie.domain ||
      typeof cookie.path !== 'string' || !cookie.path.startsWith('/')) invalid();
  for (const key of ['secure', 'httpOnly', 'hostOnly', 'pathIsDefault']) {
    if (cookie[key] !== undefined && typeof cookie[key] !== 'boolean') invalid();
  }
  for (const key of ['expires', 'creation', 'lastAccessed']) {
    const date = cookie[key];
    if (date !== undefined && date !== null && date !== 'Infinity' &&
        (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))) invalid();
  }
  if (cookie.maxAge !== undefined && cookie.maxAge !== null &&
      cookie.maxAge !== 'Infinity' && cookie.maxAge !== '-Infinity' &&
      (typeof cookie.maxAge !== 'number' || !Number.isFinite(cookie.maxAge))) invalid();
  if (cookie.sameSite !== undefined && (typeof cookie.sameSite !== 'string' ||
      !['strict', 'lax', 'none'].includes(cookie.sameSite))) invalid();
  if (cookie.extensions !== undefined && cookie.extensions !== null &&
      (!Array.isArray(cookie.extensions) || cookie.extensions.some(entry => typeof entry !== 'string'))) invalid();
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw new WealthsimpleError('INVALID_REQUEST');
}
