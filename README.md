# FinSight

Open-source financial connectors for AI agents.

FinSight discovers and hosts independent provider GraphQL APIs. Providers either
execute a local schema or forward their native API. FinSight owns connection,
authentication, and GraphQL query-only enforcement; it does not define a universal
financial model or recreate Wealthsimple's financial types.

## Run locally

Requires Node.js 24 LTS and npm. If you use nvm, run `nvm use` first.

```sh
npm ci
npm run dev
```

The server listens at `http://127.0.0.1:4000`. Use `PORT=4001 npm run dev` for
another port. The server is a trusted local, single-user service with no local
bearer authentication or multi-user isolation. It binds only to loopback; do not
expose it to a network. Wealthsimple uses an experimental unofficial API.
Credentials, cookies, and tokens stay in memory; restarting requires reconnecting.

## Discover providers and queries

```sh
curl http://127.0.0.1:4000/providers
curl http://127.0.0.1:4000/providers/wealthsimple/graphql
```

`GET /providers` returns sorted metadata: `id`, `name`, `description`, `mode`,
`graphqlEndpoint`, and an optional `connectionEndpoint`. Registration means an
endpoint exists, not that it is connected or healthy.

Wealthsimple uses `mode: "forward"`. Its single GraphQL URL supports two methods:

- **GET** returns `{ provider, introspection, queries }`, available even while
  disconnected. Each catalog entry has `id`, `description`, `operationName`,
  `query`, example `variables`, and `injectedVariables`.
- **POST** executes a JSON GraphQL request: `query`, optional `operationName`,
  and optional object `variables`.

GET never executes a query, even with query-string parameters or an HTML Accept
header. There is no separate catalog endpoint or browser UI for Wealthsimple.
The catalog provides examples, not an allowlist: callers may submit native query
fields that FinSight has never modeled. Accounts is the initial example.

Authenticated Wealthsimple introspection was observed to return HTTP 403 with
`INTROSPECTION_DISABLED`. Catalog metadata reports `introspection: "disabled"`.
Explicit POST introspection requests are still forwarded and return the native
response; FinSight does not synthesize a schema or automatically probe upstream.

Providers with `mode: "schema"` retain Yoga's GET/POST execution, local
introspection, and GraphiQL. There is no global `/graphql` endpoint.

## Connect to Wealthsimple manually

Read the provider's status and connection instructions:

```sh
curl http://127.0.0.1:4000/providers/wealthsimple/connection
```

POST JSON with `email` and `password` to that same endpoint. To keep credentials
out of command arguments and shell history, this manual terminal command prompts
through the terminal and pipes JSON directly to curl (requires Python 3):

```sh
python3 -c 'import getpass,json; print(json.dumps({"email":getpass.getpass("Email: "),"password":getpass.getpass("Password: ")}))' | curl --silent --show-error http://127.0.0.1:4000/providers/wealthsimple/connection -H 'Content-Type: application/json' --data-binary @-
```

Do not run the examples under shell tracing or save their credential input.
They are manual HTTP requests, not an installed connection client.

A successful response is `{"status":"connected"}`. If OTP may be required, the
response is `{"status":"mfa_required","attemptId":"…","expiresAt":"…"}`.
An initial `invalid_grant` can mean invalid credentials or an OTP challenge;
the challenge response does not confirm that the password was valid.

Complete the attempt within five minutes by submitting the same email/password,
the returned attempt ID, and one OTP:

```sh
python3 -c 'import getpass,json; print(json.dumps({"attemptId":getpass.getpass("Attempt ID: "),"email":getpass.getpass("Email: "),"password":getpass.getpass("Password: "),"otp":getpass.getpass("OTP: ")}))' | curl --silent --show-error http://127.0.0.1:4000/providers/wealthsimple/connection -H 'Content-Type: application/json' --data-binary @-
```

The server retains no password or OTP between requests. A rejected OTP consumes
the attempt. An expired attempt requires a new login. While connected or waiting
for OTP, disconnect before replacing the connection. GET reports only safe status
and static instructions, without the email, attempt ID, identity, or session data.

Connection errors use `{"error":{"code":"WEALTHSIMPLE_…","message":"…"}}`:
400 for invalid input (including oversized bodies), 401 for rejected login or a
session requiring reconnection, 409 for conflicting state, 429 for rate limits,
502 for upstream/protocol failures, and 504 for timeout. Error bodies never include
raw upstream responses. Statuses are Wealthsimple-specific; discovery does not
promise that a listed provider is connected or healthy.

### Query accounts

This replaces the former local `{ accounts { ... } }` API. Use Wealthsimple's
native `identity` root and field names instead. Retrieve and execute the catalog
example (requires `jq`):

```sh
curl --silent http://127.0.0.1:4000/providers/wealthsimple/graphql \
  | jq '.queries[] | select(.id == "accounts") | {query, operationName, variables}' \
  | curl http://127.0.0.1:4000/providers/wealthsimple/graphql \
      -H 'Content-Type: application/json' --data-binary @-
```

The example uses this native selection:

```graphql
query Accounts($identityId: ID!, $first: Int = 25, $after: String) {
  identity(id: $identityId) {
    accounts(filter: {}, first: $first, after: $after) {
      edges {
        cursor
        node {
          id nickname unifiedAccountType currency supportedCurrencies status createdAt
          custodianAccounts { id custodian status }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
```

Send `{"first":25,"after":null}` as variables. FinSight supplies `identityId`.
The response stays in Wealthsimple's `data.identity.accounts` structure. To read
another page, send `pageInfo.endCursor` as `after`. FinSight makes one request per
submitted query, except for one authentication retry. It does not follow cursors,
reshape fields, fill missing values, remove duplicates, validate account pages,
or enforce a local page-size range. Wealthsimple validates fields and pagination.

### Identity binding and response behavior

Every field actually named `identity`, including aliases and fields in fragments,
must use exactly `id: $identityId`. Literals, other variables, missing IDs, and
duplicate ID arguments are rejected. Each operation accessing identity must
declare `$identityId: ID!`. The selected operation's declared identity variable
is overwritten with the connected identity; other variables and the query text
are preserved. The reserved variable must have this type whenever declared.
Queries without that declaration receive no injected variable.

This binds `identity(id: ...)` access only. Wealthsimple remains responsible for
authorizing other roots, account IDs, and resources. FinSight does not claim
comprehensive resource isolation.

Valid non-authentication GraphQL responses retain their original response text
and HTTP status, including partial data, unknown fields, numeric representations,
errors, locations, paths, and extensions. **Upstream GraphQL diagnostics now pass
through**, replacing the old generic error masking for those responses. Upstream
cookies and headers are not forwarded. Local exceptions, malformed responses,
and transport failures still become safe FinSight GraphQL errors.

Recognized `UNAUTHENTICATED` errors and exact `Not Authorized` messages trigger
at most one refresh and retry. Status 401 or 403 alone does not trigger refresh.
Non-authentication GraphQL responses, including introspection denial, pass
through unchanged. Concurrent expired reads share refresh coordination. Rejected
refresh or a second authentication failure requires reconnecting. Authentication
endpoint error handling is separate from financial GraphQL response forwarding.

Requests have 30-second upstream timeouts and 8 MiB response limits. Login and
GraphQL operations have 60-second overall deadlines. Client disconnect, local
disconnect, and shutdown cancel associated work. There is no background refresh,
token persistence, or financial cache.

```sh
curl -X DELETE http://127.0.0.1:4000/providers/wealthsimple/connection
```

Disconnect clears local state; it does not revoke the remote Wealthsimple session.

### Transport compatibility

Native Node fetch and a private cookie jar are used. Wealthsimple/Cloudflare may
reject clients based on their browser/TLS fingerprint. Public bootstrap success
does not establish authenticated compatibility. Challenge HTML produces safe
errors. Tests use synthetic upstreams; the accounts catalog is based on the
known native query, not a schema introspection result. Do not commit credentials,
tokens, account output, or real upstream response fixtures.

## Register a provider

`ProviderDefinition` is a discriminated union with common `id`, `name`,
`description`, and optional `connectionRoutes`:

- `mode: "schema"` requires an executable `schema`. Local types, resolvers,
  descriptions, and scalars belong to that provider. Only a query root is allowed.
- `mode: "forward"` requires an `executor(request, signal)` returning
  `{ status, text }` and optionally a `catalog`. The executor owns provider-specific
  authentication and identity policy. The common adapter owns request parsing
  and query-only policy. Expected public request errors may use `GraphQLError`;
  other exceptions are masked.

The registry validates metadata and mode configuration, rejects duplicate IDs,
and snapshots metadata and catalogs. IDs use lowercase alphanumeric segments
separated by single hyphens. Treat registered configuration as immutable.

Connection routes are a provider-owned Fastify async plugin mounted beneath
`/providers/{id}/connection`. Register `/` with `prefixTrailingSlash: 'both'`.
The provider owns inputs, statuses, errors, and lifecycle cleanup. Compose
providers with `createApp([provider])`; core infrastructure never imports concrete
providers. Schema resolvers receive `ProviderContext.signal`; forwarding
executors receive the signal directly. Cancellation is cooperative.

## Execution policy

- FinSight enforces **GraphQL query-only operations**. Any mutation or subscription
  in a document is rejected, even if another query is selected. Only the upstream
  controls whether its query fields have side effects; there is no field allowlist.
- Forwarding rejects invalid request envelopes, syntax, operation selection,
  schema definitions, duplicate operation/fragment names, and `@defer`/`@stream`.
  It delegates financial fields, argument types, and fragment validity to upstream.
- JSON POST is the forwarding execution interface. Persisted-query extensions,
  batches, and multipart uploads are unsupported. The parser limits documents to
  50,000 tokens, and request bodies to 1 MiB. Connection POSTs have a 16 KiB limit.
- Provider responses are `Cache-Control: no-store`; CORS is not enabled. Automatic
  request logging is disabled. Queries, variables, and results are not logged.
- Schema-mode providers retain independent Yoga schemas and masked unexpected
  resolver exceptions. Deliberate `GraphQLError` messages and extensions are public.

## Architecture

Shared provider infrastructure registers both modes and mounts their endpoints.
Schema mode uses Yoga. Forward mode validates the operation, calls the provider's
executor, and returns its response text. Wealthsimple's flow is:

```text
POST native query → query-only policy → identity binding
  → authenticated API client → transport → Wealthsimple
  → original GraphQL response text and status → caller
```

Wealthsimple's `index.ts` composes the connection, shared API client, forwarding
executor, and catalog. `forwarding.ts` owns identity binding and safe local error
mapping. `catalog.ts` contains query examples, not financial models.
`upstream/client.ts` owns GraphQL authentication interception and response
classification; `upstream/http.ts` owns cookies, destinations, limits, and fetch.
`connection/` owns login, OTP, identity resolution, refresh coordination, and
session lifecycle. Connection code does not know what financial queries exist.

## Verify and build

```sh
npm test
npm run typecheck
npm run build
npm start
```

Tests use Node's test runner and synthetic local upstreams with no real credentials.
They cover both provider modes, catalog discovery, exact response passthrough,
identity binding, query policy, authentication, refresh coordination, pagination,
transport limits, cancellation, and masked local errors. Restarting after an
upgrade discards the in-memory connection and requires login again.
