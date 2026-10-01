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
choose another port. The default application has no providers:

```sh
curl http://127.0.0.1:4000/providers
# {"providers":[]}
```

This foundation has no provider authentication, connections, sessions, or real
financial integrations. It remains loopback-only and has no gateway
authentication or multi-user isolation. Synthetic providers exist only in tests.

## Discover, introspect, query

`GET /providers` returns a process-wide catalog, sorted by provider ID. Each
entry contains `id`, `name`, `description`, and `graphqlEndpoint`, an
origin-relative path. Registration means that the API is mounted, not that a
provider is authenticated, connected, or healthy.

For example, **after registering** a provider named `example`, its catalog
entry points to `/providers/example/graphql`. An agent can inspect its schema:

```sh
curl http://127.0.0.1:4000/providers/example/graphql \
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

## Register a provider

1. Construct an executable `GraphQLSchema` with the provider's types, resolvers,
   descriptions, and custom scalars. Yoga's `createSchema` or GraphQL's schema
   constructors can be used. Capture private dependencies in provider-owned
   resolver closures.
2. Export a definition implementing `ProviderDefinition` (from `src/providers.ts`)
   containing `id`, `name`, `description`, and `schema`. IDs use lowercase
   alphanumeric segments separated by single hyphens (for example, `example-2`).
   Names and descriptions must not be blank.
3. At application composition in `src/main.ts`, supply provider definitions to
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
Fastify and Yoga transport context internals are not part of the provider contract.

## Execution policy

- Only queries are accepted. Documents containing any mutation or subscription
  are rejected even if another operation is selected. Provider resolvers must
  perform financial reads only; GraphQL validation cannot enforce upstream intent.
- Each provider has its own Yoga instance, schema, and parser/validation caches.
- Unexpected exceptions are masked without development diagnostics. A deliberate
  `GraphQLError` is public: providers must keep its message and extensions safe.
- Fastify and Yoga enforce a 1 MiB request-body ceiling. Batching, multipart
  uploads, and incremental-delivery directives are disabled.
- Provider responses use `Cache-Control: no-store`. Cross-origin browser access
  is not enabled. Automatic request logging is disabled to avoid logging GET
  query strings; GraphQL bodies and results are not logged.

This foundation does not implement dynamic plugins, provider lifecycle APIs,
connection selection, remote providers, or provider-specific query-cost limits.

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
policy, and cancellation on an actual client disconnect. Tests have a separate
no-emit TypeScript configuration and are excluded from production build output.

## Components

- `src/main.ts`: application composition, startup, and shutdown.
- `src/app.ts`: REST discovery and Fastify endpoint mounting.
- `src/providers.ts`: provider contracts and registry validation.
- `src/provider-api.ts`: shared Yoga configuration and read-only policy.

The request flow is `agent → discovery → provider endpoint → provider resolvers`.
