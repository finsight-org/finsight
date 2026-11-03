import type { FastifyInstance } from 'fastify';
import { createSupabaseVerifier, type AuthConfig, type VerifyAccessToken } from './auth.js';

export interface WebApiOptions { auth?: AuthConfig; verifyAccessToken?: VerifyAccessToken }

export function registerWebApi(app: FastifyInstance, options: WebApiOptions): void {
  const verify = options.auth ? options.verifyAccessToken ?? createSupabaseVerifier(options.auth) : undefined;
  app.options('/api/me', { config: { browserApi: true } }, async (_request, reply) => reply.code(204).send());
  app.get('/api/me', { exposeHeadRoute: false, config: { browserApi: true } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const fail = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
    if (!verify) return fail(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured.');
    const header = request.headers.authorization;
    const token = typeof header === 'string' ? /^Bearer ([^\s,]+)$/i.exec(header)?.[1] : undefined;
    if (!token) return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    const result = await verify(token);
    if (result.status === 'unauthenticated') return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    if (result.status === 'unavailable') return fail(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.');
    return { user: result.user };
  });
}
