import { Kind, parse } from 'graphql';
import { WealthsimpleError, type GraphQLRequest, type LoginInput } from './client.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WealthsimpleError('INVALID_REQUEST');
  return value as Record<string, unknown>;
}

export function loginInput(value: unknown): LoginInput {
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

export function graphqlInput(value: unknown): GraphQLRequest {
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

export function assertQueryOnly(query: string): void {
  let document;
  try { document = parse(query); }
  catch { throw new WealthsimpleError('INVALID_REQUEST', 'Invalid GraphQL syntax.'); }
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION && definition.operation !== 'query') {
      throw new WealthsimpleError('INVALID_REQUEST', 'Only GraphQL queries are allowed');
    }
  }
}
