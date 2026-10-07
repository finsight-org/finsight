import { readdir, readFile } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Kind, parse } from 'graphql';
import type { Provider } from '../../providers.js';
import {
  WealthsimpleClient, WealthsimpleError,
  type GraphQLRequest, type LoginInput, type WealthsimpleOptions,
} from './client.js';
export type { WealthsimpleOptions } from './client.js';

const instructions = {
  login: {
    method: 'POST',
    required: ['email', 'password'],
    optional: ['otp'],
    outcomes: ['connected', 'mfa_required'],
  },
  completeMfa: {
    method: 'POST',
    required: ['email', 'password', 'otp'],
    description: 'Resubmit credentials with one OTP. No attempt ID is required; passwords and OTPs are never retained.',
  },
  disconnect: { method: 'DELETE', description: 'Clear the local session. This does not revoke the remote Wealthsimple session.' },
};

export function wealthsimpleProvider(options: WealthsimpleOptions = {}): Provider {
  const client = new WealthsimpleClient(options);
  return {
    metadata: {
      id: 'wealthsimple',
      name: 'Wealthsimple',
      description: 'Read financial data from Wealthsimple.',
      graphqlEndpoint: '/providers/wealthsimple/graphql',
      connectionEndpoint: '/providers/wealthsimple/connection',
    },
    routes: async (app) => {
      // Cancel upstream work before Fastify waits for active HTTP requests.
      app.addHook('preClose', async () => { client.close(); });
      app.addHook('onClose', async () => { client.disconnect(); });
      app.setErrorHandler((error, _req, reply) => {
        const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
        const safe = error instanceof WealthsimpleError ? error : new WealthsimpleError(
          typeof status === 'number' && status >= 400 && status < 500
            ? 'INVALID_REQUEST' : 'UPSTREAM_FAILURE',
        );
        reply.code(safe.statusCode).send({ error: { code: safe.code, message: safe.message } });
      });
      app.get('/connection', async () => ({ status: client.getStatus(), instructions }));
      app.post('/connection', { bodyLimit: 16 * 1024 }, async (req, reply) => {
        const input = loginInput(req.body);
        return withCancellation(req, reply, signal => client.login(input, signal));
      });
      app.delete('/connection', async (_req, reply) => {
        client.disconnect();
        return reply.code(204).send();
      });

      // Keep reference documents in src for both development and compiled runs.
      const directory = new URL('../../../src/providers/wealthsimple/reference/', import.meta.url);
      const filenames = (await readdir(directory)).filter(file => file.endsWith('.graphql')).sort();
      const references = await Promise.all(filenames.map(async file => ({
        file,
        query: await readFile(new URL(file, directory), 'utf8'),
      })));
      app.get('/graphql', async () => ({
        description: 'Native Wealthsimple GraphQL. Upstream introspection is disabled; these reference queries are examples, not an allowlist or operations executable by ID.',
        request: { method: 'POST', required: ['query'], optional: ['operationName', 'variables'] },
        identityId: 'FinSight supplies the connected identity in variables.identityId, replacing any caller value. Use $identityId in identity-scoped queries.',
        usage: 'Construct any native GraphQL query. Wealthsimple validates fields, arguments, types, fragments and operation selection; use its errors to refine your query. Only query operations are allowed.',
        references,
      }));
      app.post('/graphql', async (req, reply) => {
        const input = graphqlInput(req.body);
        let document;
        try { document = parse(input.query); }
        catch { throw new WealthsimpleError('INVALID_REQUEST', 'Invalid GraphQL syntax.'); }
        for (const definition of document.definitions) {
          if (definition.kind === Kind.OPERATION_DEFINITION && definition.operation !== 'query') {
            throw new WealthsimpleError('INVALID_REQUEST', 'Only GraphQL queries are allowed');
          }
        }
        const response = await withCancellation(req, reply, signal => client.graphql(input, signal));
        return reply.code(response.status).type('application/json').send(response.text);
      });
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WealthsimpleError('INVALID_REQUEST');
  return value as Record<string, unknown>;
}

function loginInput(value: unknown): LoginInput {
  const input = record(value);
  if (Object.keys(input).some(key => !['email', 'password', 'otp'].includes(key))) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  if (typeof input.email !== 'string' || !input.email.trim() || input.email.length > 320) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  if (typeof input.password !== 'string' || !input.password || input.password.length > 4096) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  if (input.otp !== undefined && (typeof input.otp !== 'string' || !/^\d{1,32}$/.test(input.otp))) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  return {
    email: input.email.trim(),
    password: input.password,
    otp: input.otp as string | undefined,
  };
}

function graphqlInput(value: unknown): GraphQLRequest {
  const input = record(value);
  if (typeof input.query !== 'string') {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  if (input.operationName != null && typeof input.operationName !== 'string') {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  if (input.variables != null && (typeof input.variables !== 'object' || Array.isArray(input.variables))) {
    throw new WealthsimpleError('INVALID_REQUEST');
  }
  return {
    query: input.query,
    operationName: input.operationName as string | null | undefined,
    variables: input.variables as Record<string, unknown> | null | undefined,
  };
}

async function withCancellation<T>(
  req: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!reply.raw.writableFinished) abort(); };
  req.raw.once('aborted', abort);
  reply.raw.once('close', close);
  try { return await work(controller.signal); }
  finally {
    req.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', close);
  }
}
