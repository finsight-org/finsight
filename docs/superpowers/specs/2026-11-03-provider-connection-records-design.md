# PR 2: User-owned provider connection records

Date: 2026-11-03

Status: Draft for approval. The user selected approach 1; the remaining technical
choices below are Codex proposals, not additional user decisions. Product
implementation starts after design approval.

## Intent and roadmap

Give each signed-in FinSight user a private, persistent collection of provider
connection records. A record expresses ownership and identifies a future
connection; creating one does not contact Wealthsimple or grant financial access.

The current roadmap is:

- [PR 1 / merged #24](https://github.com/finsight-org/finsight/pull/24): Supabase
  Auth, verified backend identity, and the standalone React application.
- [PR 2 / #25](https://github.com/finsight-org/finsight/issues/25): add, list,
  rename, and remove persistent connection records through backend requests.
- [PR 3 / #26](https://github.com/finsight-org/finsight/issues/26): authenticate
  records with Wealthsimple and isolate/persist live sessions and financial queries.
- [PR 4 / #27](https://github.com/finsight-org/finsight/issues/27): expose these
  capabilities through the existing web application.
- [PR 5 / #28](https://github.com/finsight-org/finsight/issues/28): authorize
  ChatGPT and other compatible agents as individual FinSight users.

The final roadmap paragraph in #23 describes an older grouping. The updated
issues #25–28 define the boundaries for this work.

## Goals, exclusions, and failure conditions

User A can create two Wealthsimple records while user B creates another, with
distinct stable IDs. Both users can list, retrieve, rename, and remove only their
own records. Signing out, signing in again, and restarting the application do not
lose records. Neither provider IDs nor labels are unique per user.

This PR adds no provider login, MFA, credentials, tokens, financial queries, live
status, frontend connection interface, or per-user MCP authorization. Existing
trusted-local provider and MCP routes keep their current behavior; these new
records do not bridge to the existing shared Wealthsimple client.

The work fails if ownership depends on caller-supplied identity, if knowing a
record ID enables cross-user access, if records exist only in process memory, or
if mocks are the only evidence that the database policies work.

## Approaches

1. **Fastify connection API backed by Supabase PostgreSQL and RLS — selected.**
   Reuse verified Supabase identity, enforce the API contract in Fastify, and send
   database requests using the same user's JWT. PostgreSQL policies independently
   enforce ownership. This adds a small API layer and gives PRs 3–5 an existing
   FinSight contract to extend.
2. **Supabase Data API as the primary record-management interface.** Fewer
   Fastify endpoints now, but connection metadata management would use a different
   application interface from the provider/session operations arriving in PR 3.

The user selected option 1. Keep the existing Node/TypeScript/Fastify stack and
the installed Supabase SDK; introduce no new application platform or database
driver.

## Data model

Add `public.provider_connections` through a reproducible Supabase migration:

| Column | Meaning and constraints |
| --- | --- |
| `id` | Database-generated UUID primary key; immutable |
| `user_id` | Non-null UUID referencing `auth.users(id)` with `ON DELETE CASCADE`; defaults to `auth.uid()`; immutable |
| `provider_id` | Non-null provider identifier using the existing registry's identifier syntax; immutable |
| `label` | Nullable user-supplied label, at most 100 Unicode characters |
| `created_at` | Non-null database-generated `timestamptz`; immutable |
| `updated_at` | Non-null database-generated `timestamptz`, maintained on rename |

Create an index beginning with `user_id`, followed by `created_at` and `id`, to
support owner-filtered listing and stable pagination. Do not add uniqueness on
`(user_id, provider_id)` or labels. Omitted, null, or blank labels become null;
trim surrounding whitespace from supplied labels and enforce the length after
normalization. Database checks also reject non-null blank/oversized labels.

Use the existing provider registry to validate provider availability on API
creation; initially `wealthsimple` is the supported provider. Do not introduce a
second provider catalog table or hard-code Wealthsimple into the generic record
API. If a provider is removed from the registry later, its existing records remain
readable, renameable, and removable.

There is no status column: no live state exists yet. PR 3 can associate a separate
session store with the stable connection ID. Its session/secret storage must not
be appended to this user-readable metadata table. Removing a record permanently
deletes it; a future provider disconnect can retain the record and has separate
semantics. PR 3 must account for record deletion when adding live sessions.

## Authentication and database authorization

Extract the existing `/api/me` bearer-token verification into reusable backend
authentication without changing its public behavior. Only a verified,
non-anonymous Supabase user establishes identity. Do not accept ownership in a
path, query parameter, header, or JSON body.

For each authenticated request, use a request-scoped Supabase data client with
the configured publishable key and that request's user JWT. Do not mutate a
shared client's authentication state or use a privileged key for normal record
operations. Reads, renames, and removals explicitly filter by the verified
`user_id`, plus the record ID where applicable. Inserts supply only provider and
label; PostgreSQL derives `user_id` from the JWT.

Enable RLS and explicitly define policies for `authenticated`:

- SELECT and DELETE require `(select auth.uid()) = user_id`.
- INSERT uses the same predicate in `WITH CHECK`.
- UPDATE has both `USING` and `WITH CHECK` for that owner predicate, together
  with the SELECT policy required for updates.

Revoke inherited/default table grants for `PUBLIC`, `anon`, and `authenticated`
on this new table before granting the exact intended access. Grant authenticated
users SELECT and DELETE, INSERT on `provider_id` and `label` only, and UPDATE on
`label` only. Database defaults and an invoker-rights timestamp trigger maintain
generated fields. The migration must not change unrelated tables, global default
privileges, or existing Supabase roles. No security-definer RPC is needed.

The Supabase Data API can reach this public metadata table using user JWTs;
Fastify is the supported application interface, not the only reachable path.
Therefore test ownership and immutable columns through the Data API directly,
too. Registry availability checks are Fastify behavior; the database accepts
syntactically valid provider identifiers, including historical/unregistered ones.
Such records still confer no provider access. Future session operations must
validate the provider implementation independently.

## Backend contract

Use `/api/connections` to distinguish user-owned records from the existing
trusted-local `/providers/:providerId/connection` session endpoints.

| Method and path | Input | Success |
| --- | --- | --- |
| `POST /api/connections` | `{ providerId, label? }` | 201, `{ connection }`, and a resource `Location` |
| `GET /api/connections` | Optional `limit` and `cursor` | 200, `{ connections, nextCursor }` |
| `GET /api/connections/:connectionId` | UUID | 200, `{ connection }` |
| `PATCH /api/connections/:connectionId` | `{ label }`, including null to clear | 200, `{ connection }` |
| `DELETE /api/connections/:connectionId` | UUID | 204, no body |

Public connection objects contain `id`, `providerId`, `label`, `createdAt`, and
`updatedAt`; ownership remains internal to this always-current-user API. Strictly
reject unknown JSON fields, malformed UUIDs, missing rename labels, wrong types,
and oversized labels. Provider changes require a new record. A create against an
unregistered provider is a 400 validation error. POST/PATCH JSON bodies are
limited to 16 KiB.

List oldest first by `(created_at, id)`, using an opaque base64url cursor for the
last returned timestamp/UUID and keyset pagination. Preserve database timestamp
precision in the cursor. `limit` defaults to 50 and ranges from 1 to 100. Fetch
one extra record to determine `nextCursor`, which is null at the end. Reject
malformed cursors before querying; cursors never select ownership. Normal
pagination is not a snapshot under concurrent writes. Do not silently truncate
the collection at Supabase's configured maximum rows.

All normal operations execute as the user. Rename and deletion check affected
rows atomically rather than authorizing with a separate existence query. A
missing ID and another user's existing ID both return the same 404 result. Empty
lists return 200 with an empty array. Repeating DELETE after removal returns 404.

Use the existing application error envelope `{ error: { code, message } }`:

- 400 for validated client input errors, including unknown providers/cursors.
- 401 `UNAUTHENTICATED` for missing, rejected, or expired user credentials,
  including a JWT rejected by the Data API after initial verification.
- 404 `CONNECTION_NOT_FOUND` for absent or invisible records.
- 503 for unconfigured Auth, unavailable Auth, or unavailable/misconfigured
  connection storage; retain existing Auth error codes and add a stable storage
  error code. A missing migration is not an empty list or an in-memory fallback.

Do not return SQL errors, upstream diagnostics, access tokens, or raw exception
messages. Use explicit selected columns and map database names to the API shape.
Database requests have a five-second timeout and observe request cancellation;
failed writes must not be retried automatically because their outcome may be
unknown. Authentication refresh remains the caller's responsibility. Responses
use `Cache-Control: no-store`, and credential/request-body logging stays disabled.

## Browser access and integration boundaries

These are application API routes, available to backend clients immediately and
to the web app in PR 4. Preserve exact-origin checks. Support preflight for the
specific methods on each resource and for `Authorization`/`Content-Type` where
needed, without authenticating OPTIONS. Keep `/api/me` limited to its existing
GET/Authorization policy. Do not enable browser access on legacy provider/MCP
routes, unknown paths, or arbitrary methods. HEAD must not create another read
path accidentally.

Separate record routes, input/output mapping, and persistence sufficiently to
test failure paths without a live database. Pass the already-validated registry
from application composition rather than importing Wealthsimple into the record
module. Reuse Auth configuration; a publishable key plus the caller JWT is enough
for storage access. Legacy operation with Auth unconfigured still starts, and
protected connection routes return 503.

## Migration and local setup

Inspect the actual local schema and pinned CLI help before implementing the
migration. Use the Supabase skill's local schema iteration and migration workflow;
commit the resulting migration and verify its history and advisors. Apply schema
changes explicitly during setup, never as application-startup side effects.

The migration must work on a clean PR 1 database and on an existing local PR 1
installation without resetting Auth users or data volumes. Document applying it,
starting the existing stack, and making authenticated CRUD requests. Extend the
local identity documentation and README to describe record management and its
roadmap boundary. No frontend source change or browser acceptance flow is needed.

## Verification and acceptance evidence

Use focused automated tests for validation, owner-scoped requests, error mapping,
pagination, and route-specific CORS, plus the real local Supabase stack for the
authorization and persistence claims:

1. Create two disposable confirmed FinSight users. Using real user JWTs, create
   two Wealthsimple records for A and one for B, with no Wealthsimple calls or
   credentials. Exercise concurrent requests from both users.
2. Verify list and individual retrieval expose only the owner's records. Test
   cross-user GET/PATCH/DELETE by known ID, forged ownership inputs, renaming,
   clearing labels, and deleting one record without affecting the others.
3. Bypass Fastify and exercise the Data API with user JWTs and with no user JWT.
   Confirm RLS blocks cross-user access/writes and grants prevent changes to ID,
   owner, provider, and generated timestamps. Verify rejected operations leave
   the original rows unchanged. Administrative fixture setup is permitted;
   successful user operations must not use an administrative key.
4. Sign out and sign in to acquire a new session, restart the compiled backend,
   then stop/start the local Supabase stack while preserving volumes. Assert the
   same surviving IDs, ownership, and labels after each step. Do not reset or
   remove existing user data to obtain a clean result.
5. Exercise multiple list pages, equal timestamp ordering, invalid cursors,
   unavailable storage, rejected tokens, and allowed/disallowed browser origins.
   Prove record operations do not invoke the Wealthsimple client or unlock
   legacy financial/MCP routes.

Run the backend tests, typecheck, and build, and the existing frontend checks to
detect integration regressions. Validate the additive migration against local
Supabase and run database advisors. Keep a concise local acceptance report with
actual commands, results, revision, and restart evidence; omit credentials and
tokens and use ignored output for runtime artifacts. Mocked tests alone cannot
complete PR 2 acceptance. If the local stack cannot run, report that limitation
and leave acceptance incomplete.

## Calls left to the builder

The implementation plan can choose file/module names, the reusable Fastify auth
helper's exact shape, SDK request construction, cursor encoding details within
the contract above, and local test fixture mechanics. Keep changes scoped to
record ownership and management; do not scaffold PRs 3–5.

## References

- [Supabase data security](https://supabase.com/docs/guides/database/secure-data)
- [Row-level policies, ownership, and indexes](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Column privileges and table-level grant precedence](https://supabase.com/docs/guides/database/postgres/column-level-security)

These references support the RLS and privilege choices; the endpoint contract,
schema details, deletion behavior, label rules, and pagination are Codex's
proposals for this PR.
