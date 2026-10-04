import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSchema, GraphQLSchema, GraphQLObjectType, GraphQLString } from 'graphql';
import { createProviderRegistry } from '../src/providers.js';
import { libraryProvider, weatherProvider } from './fixtures.js';

test('registry snapshots metadata, sorts registrations and freezes its collection', () => {
  const definition = { ...libraryProvider().provider };
  const definitions = [weatherProvider(), definition];
  const registry = createProviderRegistry(definitions);
  definition.name = 'Changed';
  definitions.length = 0;
  assert.deepEqual(registry.map(({ metadata }) => metadata.id), ['library', 'weather']);
  assert.equal(registry[0].metadata.name, 'Library');
  assert.equal(registry[0].metadata.graphqlEndpoint, '/providers/library/graphql');
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry[0]));
  assert.ok(Object.isFrozen(registry[0].metadata));
});

test('connection endpoints are optional and handlers are kept out of public metadata', () => {
  const connectionRoutes = async () => {};
  const definition = { ...libraryProvider().provider, connectionRoutes };
  const registry = createProviderRegistry([definition, weatherProvider()]);
  definition.connectionRoutes = async () => { throw new Error('changed'); };
  assert.equal(registry[0].connectionRoutes, connectionRoutes);
  assert.equal(registry[0].metadata.connectionEndpoint, '/providers/library/connection');
  assert.ok(!('connectionRoutes' in registry[0].metadata));
  assert.ok(!('connectionEndpoint' in registry[1].metadata));
});

test('registration rejects invalid identities and duplicate IDs', () => {
  const { provider } = libraryProvider();
  for (const id of ['', 'Library', 'a/b', '-a', 'a-', 'a--b', 'a_b', 'a.b', 'a b']) {
    assert.throws(() => createProviderRegistry([{ ...provider, id }]), /Provider IDs/);
  }
  assert.equal(createProviderRegistry([{ ...provider, id: 'library-2' }]).length, 1);
  for (const metadata of [{ name: '' }, { name: '  ' }, { description: '' }, { description: '\n' }]) {
    assert.throws(() => createProviderRegistry([{ ...provider, ...metadata }]), /name and description/);
  }
  assert.throws(() => createProviderRegistry([provider, provider]), /Duplicate provider ID/);
});

test('registration rejects missing query roots, invalid schemas and write/stream roots', () => {
  const { provider } = libraryProvider();
  const invalid = [
    new GraphQLSchema({}),
    new GraphQLSchema({ query: new GraphQLObjectType({ name: 'Query', fields: {} }) }),
    buildSchema('type Query { ok: String } type Mutation { write: String }'),
    buildSchema('type Query { ok: String } type Subscription { events: String }'),
  ];
  for (const schema of invalid) {
    assert.throws(() => createProviderRegistry([{ ...provider, schema }]));
  }
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: { ok: { type: GraphQLString } } }),
  });
  assert.equal(createProviderRegistry([{ ...provider, schema }]).length, 1);
});

test('forwarding definitions preserve their mode and snapshot catalogs', () => {
  const catalog = { introspection: 'disabled' as const, queries: [{ id: 'one', description: 'Example', operationName: 'One', query: 'query One { __typename }', variables: {}, injectedVariables: [] }] };
  const executor = async () => ({ status: 200, text: '{"data":null}' });
  const registry = createProviderRegistry([{ id: 'native', name: 'Native', description: 'Example native provider.', mode: 'forward', executor, catalog }]);
  catalog.queries[0].query = 'changed';
  const registered = registry[0];
  assert.equal(registered.metadata.mode, 'forward');
  assert.equal(registered.mode, 'forward');
  if (registered.mode !== 'forward') throw new Error('Expected forward mode');
  assert.equal(registered.executor, executor);
  assert.equal(registered.catalog!.queries[0]!.query, 'query One { __typename }');
  assert.ok(!('executor' in registered.metadata));
});

test('runtime registry rejects invalid mode combinations and catalogs', () => {
  const base = { id: 'native', name: 'Native', description: 'Example' };
  const schema = buildSchema('type Query { ok: String }');
  const executor = async () => ({ status: 200, text: '{"data":null}' });
  for (const invalid of [
    { ...base, schema },
    { ...base, mode: 'unknown', executor },
    { ...base, mode: 'schema', schema, executor },
    { ...base, mode: 'schema', schema, catalog: {} },
    { ...base, mode: 'forward' },
    { ...base, mode: 'forward', executor, catalog: null },
    { ...base, mode: 'forward', executor, schema },
    { ...base, mode: 'forward', executor, catalog: { introspection: 'unknown', queries: [{}] } },
  ]) {
    // Exercise JavaScript callers that bypass the discriminated TypeScript union.
    assert.throws(() => createProviderRegistry([invalid as unknown as import('../src/providers.js').ProviderDefinition]));
  }
});
