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
