import type { FastifyPluginAsync } from 'fastify';
import type { ConnectInput, WealthsimpleConnection } from './connection.js';
import { publicError, WealthsimpleError, type ErrorCode } from '../errors.js';

const instructions = {
  login: { method: 'POST', required: ['email', 'password'], outcomes: ['connected', 'mfa_required'] },
  completeMfa: {
    method: 'POST', required: ['attemptId', 'email', 'password', 'otp'],
    description: 'Use the attemptId from the login response and the same email. Resubmit the password with one OTP. Attempts expire after five minutes; a rejected OTP requires a new login.',
  },
  disconnect: { method: 'DELETE', description: 'Clear the local session. This does not revoke the remote Wealthsimple session.' },
};

/** Manual connection HTTP interface, mounted on the provider's scoped server. */
export function createConnectionRoutes(connection: WealthsimpleConnection): FastifyPluginAsync {
  return async (app) => {
    // Abort provider work before Fastify waits for in-flight requests to finish.
    app.addHook('preClose', async () => { connection.close(); });
    app.addHook('onClose', async () => { connection.close(); });
    app.setErrorHandler((error, _req, reply) => {
      const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      const safe = error instanceof WealthsimpleError ? error :
        typeof status === 'number' && status >= 400 && status < 500
          ? new WealthsimpleError('INVALID_REQUEST') : publicError(error);
      reply.code(httpStatus[safe.kind]).send({ error: { code: safe.code, message: safe.message } });
    });
    app.get('/', { prefixTrailingSlash: 'both' }, async () => ({ status: connection.getStatus(), instructions }));
    app.post('/', { prefixTrailingSlash: 'both', bodyLimit: 16 * 1024 }, async (req, reply) => {
      const input = loginInput(req.body);
      const controller = new AbortController();
      const abort = () => controller.abort();
      const close = () => { if (!reply.raw.writableFinished) abort(); };
      req.raw.once('aborted', abort);
      reply.raw.once('close', close);
      try { return await connection.connect(input, controller.signal); }
      finally {
        req.raw.removeListener('aborted', abort);
        reply.raw.removeListener('close', close);
      }
    });
    app.delete('/', { prefixTrailingSlash: 'both' }, async (_req, reply) => {
      connection.disconnect();
      return reply.code(204).send();
    });
  };
}

// Validate caller-owned data once, before invoking the connection.
function loginInput(value: unknown): ConnectInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['email', 'password', 'attemptId', 'otp'].includes(key)) ||
      typeof input.email !== 'string' || !input.email.trim() || input.email.length > 320 ||
      typeof input.password !== 'string' || !input.password || input.password.length > 4096) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  const credentials = { email: input.email.trim(), password: input.password };
  if (input.attemptId === undefined && input.otp === undefined) return credentials;
  if (typeof input.attemptId !== 'string' || !input.attemptId || input.attemptId.length > 128 ||
      typeof input.otp !== 'string' || !/^\d{1,32}$/.test(input.otp)) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  return { ...credentials, attemptId: input.attemptId, otp: input.otp };
}

const httpStatus: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400, LOGIN_FAILED: 401,
  CONNECTION_CONFLICT: 409, NOT_CONNECTED: 409, RECONNECT_REQUIRED: 401,
  RATE_LIMITED: 429, TIMEOUT: 504, CANCELLED: 409,
  INVALID_RESPONSE: 502, UPSTREAM_FAILURE: 502,
};
