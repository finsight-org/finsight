# FinSight

Open-source financial connectors for AI agents.

FinSight discovers providers and mounts their HTTP routes. Wealthsimple exposes
its native GraphQL API: agents inspect reference queries, construct queries,
and receive Wealthsimple's responses. FinSight handles authentication.

## Run locally

Requires Node.js 24 LTS and npm. If you use nvm, run `nvm use` first.

```sh
npm ci
npm run dev
```

The server listens at `http://127.0.0.1:4000`. Use `PORT=4001 npm run dev` to
choose another port. This is a trusted local, single-user service. Credentials,
cookies, and tokens stay in memory; restart or disconnect to discard the session.

```sh
curl http://127.0.0.1:4000/providers
# {"providers":[{"id":"wealthsimple","name":"Wealthsimple","description":"Read financial data from Wealthsimple.","graphqlEndpoint":"/providers/wealthsimple/graphql","connectionEndpoint":"/providers/wealthsimple/connection"}]}
```

The catalog is sorted by provider ID. Registration means a provider's routes
are mounted; it does not promise that the provider is connected or healthy.

## Discover Wealthsimple GraphQL

```sh
curl http://127.0.0.1:4000/providers/wealthsimple/graphql
```

GET returns documentation and complete reference query documents, even while
disconnected. Wealthsimple disables upstream introspection. These examples are
an initial knowledge base, not a complete schema or an allowlist. They cover
accounts, positions, activities, current and historical financials, securities,
dividends, and realized returns.

The nine reference documents were independently reconstructed and tested against
Wealthsimple through a connected local FinSight server on 2026-10-04. They cover
account inventory, account details, portfolio totals, holdings, activity, daily
history, investment income, security search, and security research.
See [the API exploration notes](docs/wealthsimple-api.md) for tested variables,
pagination, response shapes, and observed validation behavior.
Files are documentation only: submit their query text, never a filename.
Some files contain several examples; select one using `operationName`. Activity
examples include merchant details, and the portfolio file includes a combined
account-and-holdings performance query.
GET always returns documentation, including when a `query` URL parameter is present.

## Connect to Wealthsimple

```sh
curl http://127.0.0.1:4000/providers/wealthsimple/connection
```

GET returns safe status and instructions. POST accepts JSON with `email`,
`password`, and an optional `otp`. For a manual login without putting credentials
in command arguments or shell history:

```sh
python3 -c 'import getpass,json; print(json.dumps({"email":getpass.getpass("Email: "),"password":getpass.getpass("Password: ")}))' | curl --silent --show-error http://127.0.0.1:4000/providers/wealthsimple/connection -H 'Content-Type: application/json' --data-binary @-
```

A successful response is `{"status":"connected"}`. If OTP may be required,
the response is `{"status":"mfa_required"}`. An initial `invalid_grant` can
mean either invalid credentials or an OTP challenge; this does not confirm
that the password was valid.

Resubmit credentials with the OTP:

```sh
python3 -c 'import getpass,json; print(json.dumps({"email":getpass.getpass("Email: "),"password":getpass.getpass("Password: "),"otp":getpass.getpass("OTP: ")}))' | curl --silent --show-error http://127.0.0.1:4000/providers/wealthsimple/connection -H 'Content-Type: application/json' --data-binary @-
```

An OTP may also be supplied on the initial login. Bootstrap identifiers are
reused for OTP completion; there are no attempt IDs or local expiry timers.
Passwords and OTPs are never retained between requests. Identity lookup must
succeed before FinSight reports connected. Submit login and OTP requests
sequentially. A new login replaces
the current connection. Pending work from an older connection fails safely rather
than updating or querying the replacement connection.

Disconnect locally:

```sh
curl -X DELETE http://127.0.0.1:4000/providers/wealthsimple/connection
# HTTP 204
```

This clears the mutable session and cookie jar; it does not revoke Wealthsimple's
remote session or cancel pending requests. Caller abort signals control request
cancellation; late responses cannot restore the disconnected session or its cookies.
Server shutdown aborts active upstream requests, including shared token refresh,
before Fastify drains incoming requests.
Status is `disconnected`, `mfa_required`, or `connected`. A
terminal authentication failure clears the session and requires another login.

## Submit native GraphQL

After connecting, copy and run this command to list your accounts and balances:

```sh
curl --silent --show-error http://127.0.0.1:4000/providers/wealthsimple/graphql \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "query": "query Accounts($identityId: ID!, $pageSize: Int = 25, $cursor: String) { identity(id: $identityId) { accounts(filter: {}, first: $pageSize, after: $cursor) { edges { node { id nickname unifiedAccountType currency status financials { currentCombined { netLiquidationValue { amount currency } } } } } pageInfo { hasNextPage endCursor } } } }",
  "operationName": "Accounts",
  "variables": {}
}
JSON
```

The POST body is a normal GraphQL JSON envelope. `operationName` and `variables`
are optional and may be null. FinSight supplies the connected identity as `variables.identityId`,
replacing any caller value. Use `$identityId` for identity-scoped queries;
FinSight does not rewrite literal IDs or differently named variables.

FinSight parses the document and rejects every mutation or subscription
definition, even when `operationName` selects a query from a mixed document.
That is its only document check. Fields, arguments, types, fragment references,
directives, and operation selection are handled by Wealthsimple. Upstream errors
can guide corrections, but often contain only `UNPROCESSABLE_ENTITY` without field
or type details. Read-only OAuth scopes
`invest.read trade.read tax.read` remain the primary security boundary.

The query text and operation name are forwarded unchanged. Upstream GraphQL JSON
and HTTP status are preserved, including partial data, error messages, locations,
paths, and extensions. FinSight does not follow cursors, flatten edges, normalize
financial values, or execute predefined operations. The example returns
`data.identity.accounts`; choose the fields and pagination you need.

Recognized authentication failures cause one token refresh and one retry.
Concurrent expired requests share a refresh and reuse tokens already rotated
by another request.

Local connection and transport failures use
`{"error":{"code":"WEALTHSIMPLE_…","message":"…"}}`: 400 for invalid input or
rejected query documents, 401 for failed login or missing/expired authentication,
and 502 for upstream failures, including timeouts and malformed responses.
These local errors exclude raw upstream diagnostics and credentials.
Valid upstream GraphQL responses pass through unchanged.

Requests have a 1 MiB body limit, with 16 KiB for connection POSTs. Upstream
responses are limited to 8 MiB. Individual upstream requests time out after
30 seconds. Each request also observes its caller's abort signal. Shared refresh
uses its own request timeout; an aborted reader is not retried when refresh
finishes. Cookie storage, sending, and public redirects are handled by
[fetch-cookie](https://github.com/valeriangalliat/fetch-cookie) wrapping native
Node fetch.
Every request and redirect destination must use HTTPS on a Wealthsimple subdomain
or an explicitly configured endpoint origin. POST redirects are rejected.
Provider responses use `Cache-Control: no-store`; CORS and automatic request
logging are disabled.

## Register a provider

Implement the contract in `src/providers.ts`:

```typescript
interface Provider {
  metadata: ProviderMetadata;
  routes: FastifyPluginAsync;
}
```

Supply metadata with `id`, `name`, `description`, `graphqlEndpoint`, and an
optional `connectionEndpoint`. IDs use lowercase alphanumeric segments separated
by single hyphens. Names and descriptions must not be blank; IDs must be unique.

The Fastify plugin owns its routes, request shapes, errors, and lifecycle hooks.
Core mounts it beneath `/providers/{id}`; register `/graphql`, `/connection`,
or other paths relative to that prefix. Metadata advertises the provider's URLs.
Add the provider to `createApp([provider])` in `src/main.ts`. Core snapshots and
sorts metadata without inspecting schemas or implementation details.

## Verify and build

```sh
npm test
npm run typecheck
npm run build
npm start
```

Development and compiled runs both load reference documents from
`src/providers/wealthsimple/reference`. Run from the full repository; a deployment
containing only `dist` must also include that reference directory. The build is
plain `tsc`.
Tests use Node's built-in runner, synthetic providers, and a local synthetic
upstream. No real credentials or external services are needed. A real-account
smoke test can separately verify login, OTP, native queries, and disconnect.

## Architecture and compatibility

Wealthsimple's implementation is contained in `index.ts` (HTTP routes,
documentation, and query-only guard) and `client.ts` (mutable session,
authentication, cookies, refresh, and requests), plus `reference/*.graphql`.
Core consists of startup in `main.ts`, mounting/discovery in `app.ts`, and the
provider contract/registry in `providers.ts`.

Breaking interface changes: connection POSTs use an optional OTP without
`attemptId` or `expiresAt`; GraphQL GET returns documentation; POST uses native
Wealthsimple roots rather than the former local `accounts` root.
