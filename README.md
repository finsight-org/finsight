# FinSight

Open-source financial connectors for AI agents.

FinSight discovers and hosts independent, read-only provider GraphQL APIs.
Providers retain their own concepts and schemas; agents handle financial
reasoning. There is no universal financial model, schema federation, or outer
GraphQL operation wrapping a provider query.

## Run locally

Requires Node.js 24 LTS and npm. If you use nvm, run `nvm use` first.

```sh
npm ci
npm run dev
```

The server listens at `http://127.0.0.1:4000`. Use `PORT=4001 npm run dev` to
choose another port. Normal startup registers Wealthsimple:

```sh
curl http://127.0.0.1:4000/providers
# {"providers":[{"id":"wealthsimple","name":"Wealthsimple","description":"Read financial data from Wealthsimple.","graphqlEndpoint":"/providers/wealthsimple/graphql","connectionEndpoint":"/providers/wealthsimple/connection"}]}
```

The server is a trusted local, single-user service. It remains loopback-only,
with no local bearer authentication or multi-user isolation. Wealthsimple uses
an experimental unofficial API. Credentials, cookies, and tokens stay in memory;
restart or disconnect to discard the connection. Synthetic providers exist only
in tests. Do not expose this service to a network.

## Discover, introspect, query

`GET /providers` returns a process-wide catalog, sorted by provider ID. Each
entry contains `id`, `name`, `description`, and `graphqlEndpoint`, an
origin-relative path. Providers with a connection interface also advertise
`connectionEndpoint`. GET that endpoint for provider-owned instructions; other
providers may use entirely different connection mechanisms. Registration means
that the API is mounted, not that a provider is authenticated, connected, or healthy.

Wealthsimple is registered before login. An agent can inspect its schema even
while disconnected, without contacting Wealthsimple:

```sh
curl http://127.0.0.1:4000/providers/wealthsimple/graphql \
  -H 'Content-Type: application/json' \
  --data '{"query":"{ __schema { queryType { name fields { name description } } } }"}'
```

Then send a normal GraphQL request to the same endpoint with `query`, optional
`variables`, and optional `operationName`. Responses are standard GraphQL
`data` and `errors`, including partial results, error locations, paths, and
explicitly public extensions. FinSight does not interpret provider data.

Each provider endpoint supports GraphQL GET/POST requests and hosts GraphiQL
when opened in a browser. Normal GraphQL introspection is enabled. There is no
global `/graphql` endpoint or separate schema-download API. Unknown endpoints
return HTTP 404.

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

Once connected, request one account page from the separately discoverable
GraphQL endpoint:

```sh
curl http://127.0.0.1:4000/providers/wealthsimple/graphql \
  -H 'Content-Type: application/json' \
  --data '{"query":"query Accounts($after: String) { accounts(first: 25, after: $after) { edges { node { id nickname unifiedAccountType currency status } } pageInfo { hasNextPage endCursor } } }","variables":{"after":null}}'
```

When `pageInfo.hasNextPage` is true, send another request using the returned
`pageInfo.endCursor` as the `after` variable. Each account-field execution reads
one page, with a single retry only if authentication needs refreshing. FinSight
does not follow cursors, combine pages, flatten edges, or remove duplicates.
The agent decides when to request another page.

`accounts(first: Int! = 25, after: String)` returns a
`WealthsimpleAccountConnection` containing `edges { node { ... } }` and
`pageInfo { hasNextPage endCursor }`. Page sizes must be between 1 and 100;
this is FinSight's local limit. Omitted or null `after` requests the first page;
other cursor strings are passed unchanged. A missing continuation cursor on a
page that claims another page exists produces a safe error.

The page comes from the authenticated identity's direct account collection,
including non-open statuses. Account order and duplicate IDs are preserved.
Nicknames, account types, currencies, and statuses retain Wealthsimple's values;
unavailable optional fields are null. An empty page has `edges: []` with its
upstream page information. A failed/malformed page fails the `accounts` field
for that request. Earlier page responses remain valid. Nested field errors
follow normal GraphQL nullability and partial-result rules, with unexpected
diagnostics masked.

This is a Wealthsimple-shaped subset with a local `accounts` root and private
identity resolution. The endpoint uses a fixed minimal upstream operation and
normal local GraphQL selection; it does not forward arbitrary queries upstream.
The former flat-list query shape is replaced by the paginated connection.

The provider obtains the canonical identity privately during login. Reads reuse
the session and refresh tokens lazily on recognized authentication failures,
retrying the failed read once. Concurrent expired reads share a token rotation.
Rejected refresh or another authentication failure requires reconnection. There
is no background keep-alive, token persistence, or financial cache. Upstream
requests have 30-second timeouts and 8 MiB response limits; login and account
operations have 60-second deadlines. Client disconnect, local disconnect, and
server shutdown cancel associated work.

Disconnect locally:

```sh
curl -X DELETE http://127.0.0.1:4000/providers/wealthsimple/connection
# HTTP 204
```

This clears local state; it does not claim to revoke Wealthsimple's remote session.

### Transport compatibility and manual smoke test

Native Node fetch and a private cookie jar are used. A public bootstrap check
successfully fetched the login page and app bundle and extracted device/client
identifiers. Authenticated transport and account coverage still require a real
local smoke test: discover, connect (including OTP if requested), introspect,
query accounts, disconnect, and confirm account reads then require connection.
Restarting must also require login again. Do not commit credentials, tokens,
account output, or real upstream response fixtures.

Wealthsimple/Cloudflare may reject clients based on their browser/TLS fingerprint.
Public bootstrap success does not establish authenticated compatibility. Rate
limits or challenge HTML produce safe errors, without retrying authentication or
installing browser impersonation workarounds. If fingerprint enforcement blocks
the flow, investigate transport compatibility before expanding runtime requirements.

The behavioral reference is
[ws-api-python at 109010a](https://github.com/gboudreau/ws-api-python/tree/109010addc514eda037aa177c0078a71577f25a3).
The implementation and synthetic fixtures are independent; no GPL source or large
reference GraphQL fragments are incorporated. Balances, positions, transactions,
performance, tax data, market data, persistence, web UI, and multi-user support
remain out of scope.

## Register a provider

1. Construct an executable `GraphQLSchema` with the provider's types, resolvers,
   descriptions, and custom scalars. Yoga's `createSchema` or GraphQL's schema
   constructors can be used. Capture private dependencies in provider-owned
   resolver closures.
2. Export a definition implementing `ProviderDefinition` (from `src/providers.ts`)
   containing `id`, `name`, `description`, and `schema`. IDs use lowercase
   alphanumeric segments separated by single hyphens (for example, `example-2`).
   Names and descriptions must not be blank.
3. Optionally provide a `connectionRoutes` Fastify async plugin. Core mounts it
   beneath `/providers/{id}/connection`; register `/` with
   `prefixTrailingSlash: 'both'` for the entry point. The provider owns request
   shapes, statuses, errors, and any subroutes. Use lifecycle hooks to cancel
   work and dispose private state. Core only advertises and mounts the interface.
4. At application composition in `src/main.ts`, supply provider definitions to
   `createApp([provider])`. Core infrastructure does not import concrete providers.

Registration validates schemas, rejects duplicate IDs and mutation/subscription
roots, snapshots public metadata, and derives endpoint paths. A query root is
required. The registry is immutable; treat registered schema objects as immutable
too. Restart the application to change registrations or schemas.

Providers can use unrelated schemas, including identically named types with
different fields. Adding provider capabilities changes only that provider.
There is no required account, balance, or transaction model.

The supported resolver context is `ProviderContext`, whose `signal` is fresh
for each request. Pass this cancellation signal to asynchronous work, including
upstream fetches. Cancellation is cooperative: providers must observe it.
Fastify and Yoga transport context internals are not part of the GraphQL resolver
contract. Only the optional HTTP connection adapter depends on Fastify.

## Execution policy

- Only queries are accepted. Documents containing any mutation or subscription
  are rejected even if another operation is selected. Provider resolvers must
  perform financial reads only; GraphQL validation cannot enforce upstream intent.
- Each provider has its own Yoga instance, schema, and parser/validation caches.
- Unexpected exceptions are masked without development diagnostics. A deliberate
  `GraphQLError` is public: providers must keep its message and extensions safe.
- Fastify and Yoga enforce a 1 MiB request-body ceiling; Wealthsimple connection
  POSTs have a tighter 16 KiB ceiling. Batching, multipart
  uploads, and incremental-delivery directives are disabled.
- Provider responses use `Cache-Control: no-store`. Cross-origin browser access
  is not enabled. Automatic request logging is disabled to avoid logging GET
  query strings; GraphQL bodies and results are not logged.

There is no dynamic plugin system, generic authentication/session framework,
connection selection, remote providers, or provider-specific query-cost limit.

## Verify and build

```sh
npm test
npm run typecheck
npm run build
npm start
```

Tests use Node's built-in runner and `tsx`, with no external services or real
credentials. Two unrelated synthetic providers demonstrate discovery, direct
introspection, isolated schemas, standard execution, safe errors, transport
policy, and cancellation on an actual client disconnect. Wealthsimple tests
exercise the full HTTP surface against a local synthetic upstream, including
authentication, OTP, token refresh, pagination, safe errors,
and cancellation. Tests have a separate no-emit TypeScript configuration and are
excluded from production build output.

## Components

- `src/main.ts`: application composition, startup, and shutdown.
- `src/app.ts`: REST discovery and Fastify endpoint mounting.
- `src/providers.ts`: provider contracts and registry validation.
- `src/provider-api.ts`: shared Yoga configuration and read-only policy.

### Provider convention

Wealthsimple is the reference for how provider responsibilities are organized:

```text
src/providers/wealthsimple/
├── index.ts
├── schema.ts
├── errors.ts
├── protocol.ts
├── connection/
│   ├── routes.ts
│   ├── connection.ts
│   └── auth.ts
├── upstream/
│   ├── client.ts
│   └── http.ts
└── operations/
    └── accounts.ts
```

| Component | Responsibility |
| --- | --- |
| `index.ts` | Provider composition only: creates one connection, one shared API client, operations, schema, and connection routes per provider instance. |
| `schema.ts` | What FinSight exposes to the AI agent: GraphQL types, descriptions, input validation, resolvers calling the supplied operations, and public GraphQL errors. Receives operations already created by `index.ts`. |
| `operations/*` | Provider capabilities, upstream queries, variables, and capability-specific response validation. Account operations are bound to the shared client once. |
| `upstream/client.ts` | Authenticated API boundary: request construction, GraphQL decoding, authentication interception, and one refresh/retry. Holds no persistent authentication state. |
| `upstream/http.ts` | `WealthsimpleHttpClient` with `WealthsimpleHttpOptions`: provider-specific fetch, private cookies, endpoints, trusted destinations, redirects, request timeout, and response limits. |
| `connection/routes.ts` | Manual connection HTTP adapter: instructions, incoming request validation, status/error mapping, request cancellation, and shutdown hooks. |
| `connection/connection.ts` | How access is maintained: session state, OTP attempts, lifetime cancellation, token commits, shared refresh coordination, and cleanup. |
| `connection/auth.ts` | Wealthsimple authentication protocol: bootstrap, device/client discovery, password/OTP login, refresh exchange, and identity lookup. Returns results for connection to commit. |
| `errors.ts` | Safe provider error types, codes, messages, and allowlisted public error selection. |
| `protocol.ts` | Small shared JSON, object, and HTTP-status decoding helpers; no state or request orchestration. |

Two rules define the boundaries:

1. **Operations never know how authentication works.**
2. **Connection/authentication code never knows what financial operations exist.**

A new Wealthsimple capability belongs in `operations/`, such as
`transactions.ts`, `positions.ts`, or `performance.ts`, with its public fields
and resolver added to `schema.ts`. It uses the authenticated client without
handling MFA, tokens, cookies, or refresh.

These are organizational conventions, not a shared provider framework. Each
provider owns its schema, upstream protocol, and connection mechanism; another
provider may use OAuth redirects, an API key, or a public wallet address.

The public request flow is
`agent → discovery → provider endpoint → provider resolvers`.
Wealthsimple account reads follow
`adapter → accounts → API client/interceptor → transport → Wealthsimple`.
The interceptor consults connection state for authentication and shared refresh;
accounts never handles tokens or retries. Each request retains one overall
operation deadline across refresh and retry. Disconnect cancels session work,
while cancelling one reader leaves a shared refresh available to other readers.
