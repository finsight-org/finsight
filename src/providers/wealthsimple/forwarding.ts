import { GraphQLError, Kind, visit, type FragmentDefinitionNode, type SelectionSetNode } from 'graphql';
import { queryDocument } from '../../forwarding-api.js';
import type { ForwardingExecutor, ForwardingRequest } from '../../providers.js';
import { publicError } from './errors.js';
import type { WealthsimpleApiClient } from './upstream/client.js';

/** Bind all identity accesses, including aliases and reusable fragments. */
export function bindsIdentity(request: ForwardingRequest): boolean {
  const { document, operation } = queryDocument(request);
  const fragments = new Map<string, FragmentDefinitionNode>();
  visit(document, {
    FragmentDefinition(node) { fragments.set(node.name.value, node); },
    Field(node) {
      if (node.name.value !== 'identity') return;
      const ids = node.arguments?.filter(arg => arg.name.value === 'id') ?? [];
      if (ids.length !== 1 || ids[0]!.value.kind !== Kind.VARIABLE || ids[0]!.value.name.value !== 'identityId') {
        throw new GraphQLError('Every identity field must use id: $identityId.');
      }
    },
  });
  // Iterative traversal avoids recursion through long or cyclic fragment chains.
  function accessesIdentity(selection: SelectionSetNode): boolean {
    const pending = [selection];
    const seen = new Set<string>();
    let found = false;
    while (pending.length) {
      for (const node of pending.pop()!.selections) {
        if (node.kind === Kind.FIELD) {
          if (node.name.value === 'identity') found = true;
          if (node.selectionSet) pending.push(node.selectionSet);
        } else if (node.kind === Kind.INLINE_FRAGMENT) pending.push(node.selectionSet);
        else if (!seen.has(node.name.value)) {
          seen.add(node.name.value);
          const fragment = fragments.get(node.name.value);
          if (fragment) pending.push(fragment.selectionSet);
        }
      }
    }
    return found;
  }
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    const declarations = definition.variableDefinitions?.filter(v => v.variable.name.value === 'identityId') ?? [];
    if (declarations.length || accessesIdentity(definition.selectionSet)) {
      const type = declarations[0]?.type;
      if (declarations.length !== 1 || type?.kind !== Kind.NON_NULL_TYPE || type.type.kind !== Kind.NAMED_TYPE || type.type.name.value !== 'ID') {
        throw new GraphQLError('Declare the reserved identity variable as $identityId: ID!.');
      }
    }
  }
  return !!operation.variableDefinitions?.some(v => v.variable.name.value === 'identityId');
}

export function createForwarder(client: WealthsimpleApiClient): ForwardingExecutor {
  return async (request, signal) => {
    const injectIdentity = bindsIdentity(request);
    try { return await client.query(request, signal, injectIdentity); }
    catch (error) {
      const safe = publicError(error);
      const status = safe.kind === 'NOT_CONNECTED' || safe.kind === 'CONNECTION_CONFLICT' || safe.kind === 'CANCELLED' ? 409 :
        safe.kind === 'RECONNECT_REQUIRED' ? 401 : safe.kind === 'RATE_LIMITED' ? 429 : safe.kind === 'TIMEOUT' ? 504 : 502;
      return { status, text: JSON.stringify({ errors: [{ message: safe.message, extensions: { code: safe.code } }] }) };
    }
  };
}
