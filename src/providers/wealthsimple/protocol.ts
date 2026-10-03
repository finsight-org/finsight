import { Unauthorized, WealthsimpleError } from './errors.js';

// Small decoding primitives shared by Wealthsimple protocol boundaries.
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WealthsimpleError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
export function json(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new WealthsimpleError('INVALID_RESPONSE'); }
  return object(value);
}
export function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new WealthsimpleError('INVALID_RESPONSE');
  return value;
}
export function checkStatus(status: number) {
  if (status === 401) throw new Unauthorized();
  if (status === 429) throw new WealthsimpleError('RATE_LIMITED');
  if (status < 200 || status >= 300) throw new WealthsimpleError('UPSTREAM_FAILURE');
}
export function authFailure(value: Record<string, unknown>): boolean {
  return typeof value.message === 'string' && /^not authorized\.?$/i.test(value.message.trim());
}
