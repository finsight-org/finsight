import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProviderRegistry } from '../src/providers.js';
import { libraryProvider, weatherProvider } from './fixtures.js';

test('registry snapshots metadata, sorts providers and freezes its collection', () => {
  const provider = libraryProvider().provider;
  const definition = { metadata: { ...provider.metadata }, routes: provider.routes };
  const definitions = [weatherProvider(), definition];
  const registry = createProviderRegistry(definitions);
  definition.metadata.name = 'Changed';
  definition.routes = async () => {};
  definitions.length = 0;
  assert.deepEqual(registry.map(({ metadata }) => metadata.id), ['library', 'weather']);
  assert.equal(registry[0].metadata.name, 'Library');
  assert.equal(registry[0].routes, provider.routes);
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry[0]));
  assert.ok(Object.isFrozen(registry[0].metadata));
});

test('providers supply endpoint metadata without exposing their routes', () => {
  const provider = libraryProvider().provider;
  const registry = createProviderRegistry([{
    ...provider, metadata: { ...provider.metadata, connectionEndpoint: '/providers/library/sign-in' },
  }, weatherProvider()]);
  assert.equal(registry[0].metadata.connectionEndpoint, '/providers/library/sign-in');
  assert.ok(!('routes' in registry[0].metadata));
  assert.ok(!('connectionEndpoint' in registry[1].metadata));
});

test('registry rejects invalid identities, duplicate IDs and blank descriptions', () => {
  const provider = libraryProvider().provider;
  for (const id of ['', 'Library', 'a/b', '-a', 'a-', 'a--b', 'a_b', 'a.b', 'a b']) {
    assert.throws(() => createProviderRegistry([{ ...provider, metadata: { ...provider.metadata, id } }]), /Provider IDs/);
  }
  assert.equal(createProviderRegistry([{ ...provider, metadata: { ...provider.metadata, id: 'library-2' } }]).length, 1);
  for (const fields of [{ name: '' }, { name: '  ' }, { description: '' }, { description: '\n' }]) {
    assert.throws(() => createProviderRegistry([{ ...provider, metadata: { ...provider.metadata, ...fields } }]), /name and description/);
  }
  assert.throws(() => createProviderRegistry([provider, provider]), /Duplicate provider ID/);
});
