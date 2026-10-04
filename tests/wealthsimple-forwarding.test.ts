import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_REQUEST_BODY_SIZE } from '../src/provider-api.js';
import { fixture, graphql, respond, tokens } from './wealthsimple-fixtures.js';

const identity = 'identity(id: $identityId) { accounts { edges { node { id } } } }';

test('forwards native aliases, fragments and unknown fields with exact response bytes', async t => {
  const text = '{\n "data": {"chosen": {"amount": 1.2300, "large": 9007199254740993, "newField": [null, "native"]}},\n "errors": [{"message":"native diagnostic", "path":["chosen","optional"], "locations":[{"line":2,"column":3}],"extensions":{"code":"NATIVE"}}], "extensions":{"future":true}\n}';
  const f = await fixture(t, { '/graphql': (_call, _req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'upstream_private=secret', 'x-private': 'secret' });
    res.end(text);
  } });
  await f.login();
  const query = `query Unused { __typename }
    query Read($identityId: ID!, $size: Int) { ...Root }
    fragment Root on Query { chosen: identity(id: $identityId) { accounts(first: $size) { edges { node { ...Details } } } } }
    fragment Details on Account { id futureField }`;
  const response = await f.app.inject({ method: 'POST', url: graphql, payload: { query, operationName: 'Read', variables: { identityId: 'caller-id', size: 500 } } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, text);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers['x-private'], undefined);
  assert.deepEqual(f.calls.at(-1)!.body, { query, operationName: 'Read', variables: { identityId: 'IDENTITY_SENTINEL', size: 500 } });
  assert.equal(f.calls.filter(c => c.path === '/graphql').length, 1);
});

test('identity policy rejects literals, alternate variables and fragment bypasses before upstream', async t => {
  const f = await fixture(t);
  await f.login();
  const queries = [
    '{ identity(id: "other") { id } }',
    'query($id: ID!) { identity(id: $id) { id } }',
    '{ identity { id } }',
    'query($identityId: ID!) { identity(id: $identityId, id: $identityId) { id } }',
    `query { ${identity} }`,
    `query($identityId: ID) { ${identity} }`,
    `query($identityId: String!) { ${identity} }`,
    `query($identityId: [ID!]!) { ${identity} }`,
    `query($identityId: ID!, $identityId: ID!) { ${identity} }`,
    '{ renamed: identity(id: "other") { id } }',
    '{ ... on Query { identity(id: "other") { id } } }',
    '{ ...Hidden } fragment Hidden on Query { identity(id: "other") { id } }',
    `query Good($identityId: ID!) { ${identity} } query Bad { ...Hidden } fragment Hidden on Query { ${identity} }`,
    `query Good($identityId: ID!) { ${identity} } fragment Unused on Query { identity(id: "other") { id } }`,
    `query Good($identityId: ID!) { ${identity} } fragment Hidden on Query { ...Other } fragment Other on Query { ...Hidden identity(id: "other") { id } }`,
  ];
  const before = f.calls.length;
  for (const query of queries) {
    const response = await f.app.inject({ method: 'POST', url: graphql, payload: { query, ...(query.includes('query Good') ? { operationName: 'Good' } : {}) } });
    assert.equal(response.statusCode, 400, query);
    assert.ok(response.json().errors.length);
  }
  assert.equal(f.calls.length, before);
});

test('shared fragments bind each operation, cycles terminate, and identity-free requests stay native', async t => {
  const f = await fixture(t);
  await f.login();
  const queries = [
    { query: `query A($identityId: ID!) { ...Shared } query B($identityId: ID!) { ...Shared } fragment Shared on Query { ${identity} }`, operationName: 'B' },
    { query: `query($identityId: ID!) { ...A } fragment A on Query { ...B } fragment B on Query { ...A ${identity} }` },
    { query: 'query($identityId: ID!) { __typename }' },
  ];
  for (const payload of queries) {
    assert.equal((await f.app.inject({ method: 'POST', url: graphql, payload })).statusCode, 200);
    assert.equal(f.calls.at(-1)!.body.variables.identityId, 'IDENTITY_SENTINEL');
    assert.equal(f.calls.at(-1)!.body.query, payload.query);
  }
  // Fragment validity belongs to upstream; FinSight's graph traversal must terminate.
  for (const payload of [
    { query: '{ __schema { queryType { name } } }' },
    { query: 'query($term: String!) { arbitrarySearch(term: $term) { id } }', variables: { term: 'native' } },
  ]) {
    assert.equal((await f.app.inject({ method: 'POST', url: graphql, payload })).statusCode, 200);
    assert.deepEqual(f.calls.at(-1)!.body, payload);
  }
});

test('non-authentication HTTP errors and introspection denial pass through without refresh', async t => {
  for (const [status, code] of [[401, 'ACCESS_DENIED'], [403, 'INTROSPECTION_DISABLED'], [429, 'RATE_LIMITED'], [500, 'SERVER_ERROR']] as const) await t.test(String(status), async t => {
    const text = JSON.stringify({ errors: [{ message: code === 'INTROSPECTION_DISABLED' ? 'Introspection queries are disabled' : 'Upstream error', extensions: { code } }] });
    const f = await fixture(t, { '/graphql': (_call, _req, res) => { res.writeHead(status); res.end(text); } });
    await f.login();
    const response = await f.app.inject({ method: 'POST', url: graphql, payload: { query: '{ __schema { queryType { name } } }' } });
    assert.equal(response.statusCode, status);
    assert.equal(response.body, text);
    assert.equal(f.calls.filter(c => c.path === '/token').length, 1);
    assert.equal(f.calls.filter(c => c.path === '/graphql').length, 1);
  });
});

test('bare 401 is not evidence of expired authentication; semantic 403 refreshes once', async t => {
  let mode = 'bare';
  const f = await fixture(t, {
    '/token': (call, _req, res) => respond(res, call.body.grant_type === 'password' ? tokens : { access_token: 'fresh', refresh_token: 'fresh-refresh' }),
    '/graphql': (call, _req, res) => {
      if (mode === 'bare') respond(res, {}, 401);
      else if (call.headers.authorization !== 'Bearer fresh') respond(res, { errors: [{ message: 'Not Authorized.' }] }, 403);
      else respond(res, { data: { __typename: 'Query' } });
    },
  });
  await f.login();
  assert.equal((await f.query()).json().errors[0].extensions.code, 'WEALTHSIMPLE_UPSTREAM_FAILURE');
  assert.equal(f.calls.filter(c => c.path === '/token').length, 1);
  mode = 'semantic';
  assert.equal((await f.query()).statusCode, 200);
  assert.equal(f.calls.filter(c => c.path === '/token').length, 2);
});

test('malformed GraphQL envelopes are masked without validating financial data', async t => {
  for (const body of [{}, [], { data: 42 }, { errors: [] }, { errors: 'private' }, { errors: [{ message: { private: 'secret' } }] }]) await t.test(JSON.stringify(body), async t => {
    const f = await fixture(t, { '/graphql': (_call, _req, res) => respond(res, body) });
    await f.login();
    const response = await f.query();
    assert.equal(response.json().errors[0].extensions.code, 'WEALTHSIMPLE_INVALID_RESPONSE');
    assert.doesNotMatch(response.body, /secret|private/);
  });
  const f = await fixture(t, { '/graphql': (_call, _req, res) => respond(res, { data: { identity: null } }) });
  await f.login();
  assert.deepEqual((await f.query()).json(), { data: { identity: null } });
});

test('POST rejects invalid envelopes and query policy violations before upstream execution', async t => {
  const f = await fixture(t);
  for (const payload of [
    {}, [], [{ query: '{ __typename }' }], { query: 12 }, { query: '' },
    { query: '{ __typename }', variables: [] }, { query: '{ __typename }', variables: null },
    { query: '{ __typename }', extensions: { persistedQuery: {} } },
    { query: '{ __typename }', operationName: 3 },
    { query: '{' }, { query: 'mutation { anything }' }, { query: 'subscription { anything }' },
    { query: 'query Read { __typename } mutation Write { anything }', operationName: 'Read' },
    { query: 'query Read { __typename } subscription Watch { anything }', operationName: 'Read' },
    { query: 'query A { __typename } query B { __typename }' },
    { query: 'query A { __typename }', operationName: 'Missing' },
    { query: 'query A { __typename } query A { __typename }', operationName: 'A' },
    { query: 'query { __typename } query A { __typename }', operationName: 'A' },
    { query: '{ ... @defer { __typename } }' }, { query: '{ unknown @stream }' },
    { query: '{ __typename } type Custom { id: ID }' },
    { query: '{ ...A } fragment A on Query { __typename } fragment A on Query { __typename }' },
  ]) {
    const response = await f.app.inject({ method: 'POST', url: graphql, payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.ok(response.json().errors.length);
  }
  for (const [headers, payload, status] of [
    [{ 'content-type': 'application/json' }, '{invalid', 400],
    [{ 'content-type': 'multipart/form-data; boundary=x' }, '--x--', 415],
    [{ 'content-type': 'application/json' }, JSON.stringify({ query: ' '.repeat(MAX_REQUEST_BODY_SIZE) }), 413],
  ] as const) {
    const response = await f.app.inject({ method: 'POST', url: graphql, headers, payload });
    assert.equal(response.statusCode, status);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.json().errors.length);
  }
  const preflight = await f.app.inject({ method: 'OPTIONS', url: graphql, headers: { origin: 'https://example.org', 'access-control-request-method': 'POST' } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  assert.equal(f.calls.length, 0);
});
