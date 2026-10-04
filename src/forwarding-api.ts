import { GraphQLError, Kind, parse, visit, type DocumentNode, type OperationDefinitionNode } from 'graphql';
import type { FastifyPluginAsync } from 'fastify';
import type { ForwardingRequest, RegisteredProvider } from './providers.js';

export function parseForwardingRequest(value: unknown): ForwardingRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GraphQLError('Invalid GraphQL request.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['query', 'operationName', 'variables'].includes(key)) ||
      typeof input.query !== 'string' || !input.query.trim() ||
      (input.operationName !== undefined && (typeof input.operationName !== 'string' || !input.operationName)) ||
      (input.variables !== undefined && (!input.variables || typeof input.variables !== 'object' || Array.isArray(input.variables)))) {
    throw new GraphQLError('Invalid GraphQL request.');
  }
  return input as unknown as ForwardingRequest;
}

/** Schema-free operation policy. Upstream owns field and value validation. */
export function queryDocument(request: ForwardingRequest): { document: DocumentNode; operation: OperationDefinitionNode } {
  let document: DocumentNode;
  try { document = parse(request.query, { maxTokens: 50_000 }); }
  catch { throw new GraphQLError('Invalid GraphQL syntax.'); }
  const operations: OperationDefinitionNode[] = [];
  const names = new Set<string>();
  const fragments = new Set<string>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      if (definition.operation !== 'query') throw new GraphQLError('Only query operations are supported.');
      if (definition.name && names.has(definition.name.value)) throw new GraphQLError('Duplicate operation name.');
      if (definition.name) names.add(definition.name.value);
      operations.push(definition);
    } else if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      if (fragments.has(definition.name.value)) throw new GraphQLError('Duplicate fragment name.');
      fragments.add(definition.name.value);
    } else throw new GraphQLError('Only executable query documents are supported.');
  }
  visit(document, { Directive(node) {
    if (node.name.value === 'defer' || node.name.value === 'stream') throw new GraphQLError('Incremental delivery is not supported.');
  } });
  if (operations.length > 1 && operations.some(op => !op.name)) throw new GraphQLError('Multiple operations must be named.');
  const operation = request.operationName === undefined ? (operations.length === 1 ? operations[0] : undefined) : operations.find(op => op.name?.value === request.operationName);
  if (!operation) throw new GraphQLError('Select one existing query operation.');
  return { document, operation };
}

export function createForwardingApi(provider: Extract<RegisteredProvider, { mode: 'forward' }>): FastifyPluginAsync {
  return async app => {
    app.setErrorHandler((error, _request, reply) => {
      const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      reply.code(typeof status === 'number' && status >= 400 && status < 500 ? status : 500)
        .send({ errors: [{ message: 'Invalid GraphQL request.' }] });
    });
    app.get(provider.metadata.graphqlEndpoint, async () => ({ provider: provider.metadata, ...(provider.catalog ?? { introspection: 'unknown', queries: [] }) }));
    app.options(provider.metadata.graphqlEndpoint, async (_req, reply) => reply.code(204).send());
    app.post(provider.metadata.graphqlEndpoint, async (req, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const close = () => { if (!reply.raw.writableFinished) abort(); };
      req.raw.once('aborted', abort);
      reply.raw.once('close', close);
      try {
        const request = parseForwardingRequest(req.body);
        queryDocument(request);
        const response = await provider.executor(request, controller.signal);
        return reply.code(response.status).type('application/json').send(response.text);
      } catch (error) {
        if (error instanceof GraphQLError) return reply.code(400).send({ errors: [error.toJSON()] });
        return reply.code(500).send({ errors: [{ message: 'Unexpected error.' }] });
      } finally {
        req.raw.removeListener('aborted', abort);
        reply.raw.removeListener('close', close);
      }
    });
  };
}
