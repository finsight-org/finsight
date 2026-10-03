import type { Transport } from '../upstream/http.js';
import { OTPRequired, Unauthorized, WealthsimpleError } from '../errors.js';
import { authFailure, checkStatus, json, requiredString } from '../protocol.js';

export type ConnectInput = { email: string; password: string } & (
  { attemptId?: undefined; otp?: undefined } | { attemptId: string; otp: string }
);
export interface AuthIdentifiers {
  sessionId: string;
  deviceId: string;
  clientId: string;
}
export interface Tokens { access: string; refresh: string }

/** Authentication protocol functions return results; connection owns all commits. */
export async function bootstrap(transport: Transport, signal: AbortSignal) {
  const page = await transport.request(transport.endpoints.login, signal);
  checkStatus(page.status);
  const deviceId = requiredString(transport.deviceId());
  const scripts = [...page.text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)];
  const source = scripts.map(match => match[1]).find(path => /\/app-[^/]+\.js(?:\?|$)/.test(path));
  if (!source) throw new WealthsimpleError('INVALID_RESPONSE');
  const script = await transport.request(transport.assetUrl(source.replaceAll('&amp;', '&')), signal);
  checkStatus(script.status);
  const clientId = requiredString(script.text.match(/["']production["'][^}]{0,2000}\bclientId\s*:\s*["']([a-zA-Z0-9_-]+)["']/)?.[1]);
  return { deviceId, clientId };
}

export function sessionHeaders(identifiers: Readonly<AuthIdentifiers>, profile?: string): Record<string, string> {
  return {
    'x-ws-device-id': identifiers.deviceId, 'x-ws-session-id': identifiers.sessionId,
    ...(profile === undefined ? {} : { 'x-wealthsimple-client': '@wealthsimple/wealthsimple', 'x-ws-profile': profile }),
  };
}

export function authenticatedHeaders(identifiers: Readonly<AuthIdentifiers>, access: string): Record<string, string> {
  return { ...sessionHeaders(identifiers), authorization: `Bearer ${access}` };
}

export async function login(
  transport: Transport, identifiers: Readonly<AuthIdentifiers>, input: ConnectInput, signal: AbortSignal,
): Promise<Tokens> {
  const headers = sessionHeaders(identifiers, 'undefined');
  if (input.otp) headers['x-wealthsimple-otp'] = `${input.otp};remember=true`;
  const response = await transport.request(transport.endpoints.token, signal, {
    grant_type: 'password', username: input.email, password: input.password, skip_provision: 'true',
    scope: 'invest.read trade.read tax.read', client_id: identifiers.clientId, otp_claim: null,
  }, headers);
  if (![200, 400, 401].includes(response.status)) checkStatus(response.status);
  const body = json(response.text);
  if (body.error) {
    if (!input.otp && ['invalid_grant', 'otp_required', 'mfa_required'].includes(String(body.error))) throw new OTPRequired();
    throw new WealthsimpleError('LOGIN_FAILED');
  }
  if (response.status !== 200) throw new WealthsimpleError('LOGIN_FAILED');
  return decodeTokens(body);
}

export async function refreshTokens(
  transport: Transport, identifiers: Readonly<AuthIdentifiers>, refreshToken: string, signal: AbortSignal,
): Promise<Tokens> {
  const response = await transport.request(transport.endpoints.token, signal, {
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: identifiers.clientId,
  }, sessionHeaders(identifiers, 'invest'));
  if (response.status === 400 || response.status === 401) throw new Unauthorized();
  checkStatus(response.status);
  const body = json(response.text);
  if (body.error) throw new Unauthorized();
  return decodeTokens(body);
}

export async function lookupIdentity(
  transport: Pick<Transport, 'endpoints' | 'request'>, headers: Readonly<Record<string, string>>, signal: AbortSignal,
): Promise<string> {
  const response = await transport.request(transport.endpoints.tokenInfo, signal, undefined, {
    ...headers, 'x-wealthsimple-client': '@wealthsimple/wealthsimple',
  });
  checkStatus(response.status);
  const body = json(response.text);
  if (authFailure(body)) throw new Unauthorized();
  return requiredString(body.identity_canonical_id);
}

function decodeTokens(body: Record<string, unknown>): Tokens {
  return { access: requiredString(body.access_token), refresh: requiredString(body.refresh_token) };
}
