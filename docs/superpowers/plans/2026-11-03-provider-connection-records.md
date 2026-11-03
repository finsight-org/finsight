# Provider Connection Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authenticated FinSight users persistent provider connection records that they can create, list, retrieve, rename, and remove without accessing another user's records.

**Architecture:** Fastify verifies each Supabase bearer token and exposes `/api/connections`. Request-scoped Supabase clients carry the verified user's JWT, while PostgreSQL RLS and column privileges independently protect ownership and immutable fields. Connection records do not interact with the existing Wealthsimple session or MCP routes.

**Tech Stack:** Existing Node.js 24, TypeScript, Fastify 5.12.7, Supabase JS 2.118.0, Zod 4.6.7, Supabase CLI 3.0.0, local PostgreSQL 17, and Node's built-in test runner. No new runtime dependencies.

**Spec:** [Approved design](../specs/2026-11-03-provider-connection-records-design.md). Read both documents before execution.

## Global Constraints

- "Do not add uniqueness on `(user_id, provider_id)` or labels."
- "Only a verified, non-anonymous Supabase user establishes identity."
- "Do not accept ownership in a path, query parameter, header, or JSON body."
- "Do not mutate a shared client's authentication state or use a privileged key for normal record operations."
- "There is no status column: no live state exists yet."
- "POST/PATCH JSON bodies are limited to 16 KiB."
- "`limit` defaults to 50 and ranges from 1 to 100."
- "Database requests have a five-second timeout and observe request cancellation; failed writes must not be retried automatically because their outcome may be unknown."
- "Responses use `Cache-Control: no-store`, and credential/request-body logging stays disabled."
- "The migration must work on a clean PR 1 database and on an existing local PR 1 installation without resetting Auth users or data volumes."
- "No frontend source change or browser acceptance flow is needed."
- "Mocked tests alone cannot complete PR 2 acceptance."
- All remaining requirements in the approved design apply, including optional labels of at most 100 Unicode characters, permanent deletion, and unchanged trusted-local provider/MCP behavior.

## Review Focus

1. An insert response is lost or returns 503: the SDK must issue only one POST, because repeating it can create another record (Task 4).
2. Labels contain emoji, Unicode whitespace, or a NUL character: count Unicode code points, normalize blank labels, and reject unstoreable NUL input as 400 (Tasks 1 and 3).
3. Database timestamps have microseconds, and cursors contain hostile filter syntax: pagination must preserve precision, avoid omissions, and reject malformed cursors before transport (Tasks 3 and 4).
4. A caller disconnects during Auth or storage work: stop before starting a write, abort pending storage, and release listeners (Task 5).
5. A registered provider disappears after a record is created: existing records remain retrievable, renameable, and removable, while new creation for that provider is refused (Task 5).

## Execution prerequisites and file map

This plan was prepared on `codex/pr2-provider-connection-records` from the existing PR 1 code. Local `node_modules` is absent; no implementation tests or CLI commands have been run during planning. At execution time, use the worktree skill to establish isolation while preserving both planning documents, then run `npm ci` and `npm --prefix web ci` under Node 24. Inspect the pinned CLI's `--help` before using its subcommands. Do not link or mutate a hosted project for this work.

| File | Responsibility |
| --- | --- |
| `supabase/migrations/<CLI-generated timestamp>_provider_connections.sql` | New table, constraints, index, defaults, timestamp trigger, RLS, and grants |
| `src/auth.ts` | Existing verifier plus a reusable request authenticator |
| `src/web-api.ts` | `/api/me` using the reusable authenticator |
| `src/browser-access.ts` | Route-specific application CORS policies |
| `src/connections/model.ts` | Public types, domain errors, strict inputs, cursor codec, and row mapping |
| `src/connections/store.ts` | Request-scoped Supabase persistence and transport failures |
| `src/connections/routes.ts` | Authenticated HTTP contract and cancellation lifecycle |
| `src/app.ts` | Compose the registry, authenticator, and connection routes |
| `tests/connections-model.test.ts` | Validation, labels, row mapping, and cursors |
| `tests/connections-store.test.ts` | Real SDK with controlled fetch responses and request inspection |
| `tests/connections-fixtures.ts` | Injected test-only store for route tests |
| `tests/connections-api.test.ts` | HTTP behavior, owner-scoped calls, and cancellation |
| `tests/auth.test.ts`, `tests/web-api.test.ts`, `tests/browser-access.test.ts` | Existing boundary regressions plus new auth/CORS cases |
| `tests/integration/supabase-fixture.ts` | Disposable local Auth identities and compiled backend lifecycle |
| `tests/integration/provider-connections.test.ts` | Actual Data API/RLS tests and full local acceptance |
| `package.json` | Explicit local integration-test script; default unit tests stay external-service independent |
| `README.md`, `docs/local-auth-development.md` | Migration setup, authenticated CRUD, and scope documentation |

The migration filename is intentionally generated at execution time, not guessed. Record its exact path in the task log once the CLI creates it.

---

### Task 1: Establish the persistent ownership boundary

**Files:** Create the CLI-generated migration, `tests/integration/supabase-fixture.ts`, and `tests/integration/provider-connections.test.ts`; modify `package.json` scripts.

**Interfaces:**

- Produce `public.provider_connections(id, user_id, provider_id, label, created_at, updated_at)` exactly as specified in the design.
- Produce `createLocalFixture(t: TestContext): Promise<LocalFixture>`. `LocalFixture` exposes `config: AuthConfig`, `a` and `b` as `{ id: string; accessToken: string; client: SupabaseClient; signOut(): Promise<void>; signIn(): Promise<string> }`, and `seedCreatedAt(ids: string[], timestamp: string): Promise<void>` for deterministic ordering tests.
- The fixture reads `FINSIGHT_TEST_SUPABASE_URL`, `FINSIGHT_TEST_SUPABASE_PUBLISHABLE_KEY`, and `FINSIGHT_TEST_SUPABASE_SECRET_KEY` from the environment. Require a loopback URL. Keep the administrative client private to fixture setup, timestamp seeding, and cleanup; create confirmed disposable users and delete only IDs the fixture created. `signIn()` updates the exposed access token and client session as well as returning the new token.
- Add `test:connections:integration` = `node --import tsx --test --test-concurrency=1 tests/integration/provider-connections.test.ts`. Keep this suite serial because it can restart shared local services. Missing local configuration fails with a safe actionable message rather than silently skipping this suite.

- [x] **Step 1: Write direct Data API tests before creating the table.** Use the real SDK and fixture users. The first test is `owners can independently create duplicate-provider and duplicate-label records`:

  ```ts
  const f = await createLocalFixture(t);
  const created = await f.a.client.from('provider_connections')
    .insert([{ provider_id: 'wealthsimple', label: 'Personal' },
      { provider_id: 'wealthsimple', label: 'Personal' }])
    .select('id,user_id,provider_id,label,created_at,updated_at');
  assert.equal(created.error, null);
  assert.equal(created.data?.length, 2);
  assert.equal(new Set(created.data!.map(row => row.id)).size, 2);
  assert.ok(created.data!.every(row => row.user_id === f.a.id));
  ```

  Add `user JWTs cannot read, rename, or delete another owner's rows`: B's selected rows and affected-row arrays for A's ID are empty, and A's row remains unchanged. Add `anonymous requests and immutable-column writes are denied`: unauthenticated access has an error; forged owner INSERT and own-row UPDATEs of `id`, `user_id`, `provider_id`, `created_at`, and `updated_at` fail. Test both explicit ID/timestamp INSERTs and blank/101-character labels. A valid historical provider identifier remains insertable through the Data API, as the design permits.

- [x] **Step 2: Run the suite against the existing PR 1 local stack and confirm the missing-table failure.** Install dependencies first, inspect `npx supabase --help` and the relevant `db`, `migration`, and `status` help, then start via `npm run supabase:start`. Store full CLI status only in ignored `.secrets/`; load fixture variables without printing keys or placing them in command arguments. Run `npm run test:connections:integration`. Expected RED: Auth fixture setup works, but record creation fails because `provider_connections` is absent.

- [x] **Step 3: Implement and capture the additive schema migration.** Inspect the actual local tables first. Iterate SQL with local `db query`/`execute_sql` without adding migration-history entries; run database advisors, then capture the final diff with the installed CLI's documented local `db pull provider_connections --local --yes` workflow. If manually creating a migration file is needed, use `supabase migration new provider_connections` first; never invent a timestamp. Retain one canonical migration containing only this PR's objects and required grants, not a dump of unrelated Supabase schemas.

  Use database-generated UUIDs, `auth.uid()` owner defaults, `ON DELETE CASCADE`, and `(user_id, created_at, id)` indexing. Match the registry ID regex `^[a-z0-9]+(-[a-z0-9]+)*$`. Use `char_length` for the label's 100-code-point limit. The database blank check must cover the ECMAScript trim whitespace set used by the API, including NBSP and BOM; express the characters explicitly in SQL rather than assuming PostgreSQL's locale-dependent whitespace class matches JavaScript. Maintain `updated_at` with a fixed-search-path, invoker-rights trigger. Revoke table-level grants before column grants; implement all four owner policies and both UPDATE predicates. Do not alter unrelated roles/default privileges.

- [x] **Step 4: Verify the real boundary and migration history.** Run `npm run test:connections:integration`, `npx supabase migration list --local`, and the installed CLI's local database advisors command. Expected GREEN: both users' CRUD succeeds only for their own rows; immutable fields and anonymous access are denied; one canonical migration is recorded; new objects introduce no unresolved security advisories. Verify the captured migration includes column grants and the trigger, which schema-diff tools can omit.

- [x] **Step 5: Commit this deliverable.** Stage the exact generated migration, both integration files, and `package.json`; commit as `feat: persist user-owned provider connection records`.

### Task 2: Reuse verified identity and make CORS resource-specific

**Files:** Modify `src/auth.ts:1–56`, `src/web-api.ts:1–21`, `src/browser-access.ts:1–26`, `src/app.ts:5–28`, and the existing auth/web-api/browser-access tests. Line references are the pre-implementation baseline.

**Interfaces:**

- Add to `src/auth.ts`: `RequestIdentity { user: VerifiedUser; accessToken: string }`; `AuthOptions { auth?: AuthConfig; verifyAccessToken?: VerifyAccessToken }`; `AuthenticateRequest = (request: FastifyRequest, reply: FastifyReply) => Promise<RequestIdentity | undefined>`; `createRequestAuthenticator(options: AuthOptions): AuthenticateRequest`.
- The authenticator sends the existing safe 401/503 envelopes on failure and returns undefined; callers stop immediately. It never stores identity on shared/global state.
- Change `registerWebApi(app: FastifyInstance, authenticate: AuthenticateRequest): void`; export `AppOptions extends AuthOptions` from `src/app.ts` and construct the authenticator once in `createApp`.
- Keep `browserApi?: true`; add route config `browserMethods?: readonly string[]` and `browserHeaders?: readonly string[]`. Defaults stay `['GET']` and `['Authorization']` for `/api/me`.

- [x] **Step 1: Extend boundary tests before refactoring.** Preserve every existing assertion in `tests/web-api.test.ts`. Add `authenticator returns each verified token with only its own identity`:

  ```ts
  assert.deepEqual(a.json(), { user: { id: 'user-a', email: null } });
  assert.deepEqual(b.json(), { user: { id: 'user-b', email: null } });
  assert.equal(rejected.statusCode, 401);
  assert.equal(unavailable.statusCode, 503);
  ```

  Drive concurrent requests with distinct tokens, malformed/duplicate bearer credentials, a verifier that throws, and unconfigured Auth. Capture the helper's return value inside a test-only route and assert `identity.accessToken` equals the originating token, without returning it over HTTP; failures return undefined. Add a small test-only application route with explicit POST/Content-Type policy: its allowed preflight returns 204 without verifier calls, while unsupported methods/headers/origins fail. `/api/me` must still reject POST preflight, and legacy/unknown paths must still reject browser Origin.

- [x] **Step 2: Run the focused tests and establish RED for the new policy/helper.** Run `node --import tsx --test tests/auth.test.ts tests/web-api.test.ts tests/browser-access.test.ts`. Expected: new configurable-policy tests fail while existing baseline behavior passes.

- [x] **Step 3: Implement the interfaces and preserve the existing boundary.** Extract the single-bearer parsing and failure responses from `/api/me`, reuse `createSupabaseVerifier`, and sanitize thrown verification failures as `AUTH_UNAVAILABLE`. Use per-route metadata for preflight and actual browser method checks, preserving exact-origin and Host validation. Do not authenticate OPTIONS or enable browser credentials.

- [x] **Step 4: Run focused tests and backend typecheck.** Run the same test command, then `npm run typecheck`. Expected: all pass; `/api/me` output/error codes remain unchanged and the fixture policy expands only its own route.

- [x] **Step 5: Commit.** Stage only this task's source/tests and commit as `refactor: share application authentication and route CORS policies`.

### Task 3: Define strict records, label handling, and pagination

**Files:** Create `src/connections/model.ts` and `tests/connections-model.test.ts`.

**Interfaces:**

```ts
interface ConnectionRecord {
  id: string; providerId: string; label: string | null;
  createdAt: string; updatedAt: string;
}
interface ConnectionCursor { createdAt: string; id: string }
interface CreateConnectionInput { providerId: string; label: string | null }
interface ListConnectionsInput { limit: number; after: ConnectionCursor | null }
interface ConnectionPage { connections: ConnectionRecord[]; nextCursor: string | null }
// Export these types and functions from src/connections/model.ts:
parseCreateInput(value: unknown, providerIds: ReadonlySet<string>): CreateConnectionInput;
parseRenameInput(value: unknown): { label: string | null };
parseConnectionId(value: unknown): string;
parseListInput(value: unknown): ListConnectionsInput;
encodeConnectionCursor(value: ConnectionCursor): string;
mapConnectionRow(value: unknown, ownerId: string): ConnectionRecord;
```

Export `ConnectionError` with `code` and `statusCode`. Fixed code/status mappings are `CONNECTION_INPUT_INVALID`/400, `UNAUTHENTICATED`/401, `CONNECTION_NOT_FOUND`/404, and `CONNECTION_STORAGE_UNAVAILABLE`/503; messages are fixed safe text, never arbitrary input or SDK diagnostics. `mapConnectionRow` validates all seven selected DB columns, checks `user_id === ownerId`, preserves timestamp strings, and raises the storage error for malformed rows.

- [x] **Step 1: Write model tests with exact boundaries.** Include `labels count Unicode code points rather than UTF-16 units` and `inputs reject ownership, NUL, and unknown properties`:

  ```ts
  assert.equal(parseRenameInput({ label: '😀'.repeat(100) }).label, '😀'.repeat(100));
  assert.throws(() => parseRenameInput({ label: '😀'.repeat(101) }), { code: 'CONNECTION_INPUT_INVALID' });
  assert.deepEqual(parseRenameInput({ label: '\u00a0\ufeff ' }), { label: null });
  assert.deepEqual(parseRenameInput({ label: '  Savings  ' }), { label: 'Savings' });
  assert.throws(() => parseRenameInput({ label: '\0' }), { statusCode: 400 });
  assert.throws(() => parseCreateInput({ providerId: 'wealthsimple', userId: 'other' }, ids));
  assert.throws(() => parseRenameInput({}));
  assert.deepEqual(parseListInput({}), { limit: 50, after: null });
  ```

  Also test null/array/wrong-type bodies, unknown provider, null/omitted labels, UUIDs, limit 1/100/0/101/fractions, repeated query values, unknown query keys, invalid base64/JSON, oversized cursors, invalid date/UUID, and cursor-injected PostgREST syntax. Round-trip a cursor containing `2026-11-03T12:00:00.123456+00:00` with every digit intact. A mismatched-owner/malformed DB row must raise 503 and expose no input diagnostics.

- [x] **Step 2: Run `node --import tsx --test tests/connections-model.test.ts` and confirm RED.** Expected: missing model exports before implementation.

- [x] **Step 3: Implement the model interfaces using existing Zod and small mapping helpers.** Strictly reject unknown fields. Count labels with Unicode code points after `.trim()` and reject NUL before transport. Encode cursors as base64url UTF-8 JSON `{ createdAt, id }`; cap encoded input at 512 bytes, validate its exact shape and real UTC ISO timestamp/UUID, and retain the original timestamp instead of serializing through `Date`. Query `limit` accepts decimal integer strings only. Do not put registry state into stored/public records.

- [x] **Step 4: Run model tests and `npm run typecheck`.** Expected: all pass, including emoji, microseconds, and hostile cursor cases.

- [x] **Step 5: Commit.** Commit the two files as `feat: define connection record validation and pagination`.

### Task 4: Implement request-scoped Supabase persistence

**Files:** Create `src/connections/store.ts` and `tests/connections-store.test.ts`.

**Interfaces:** Consume Task 2's `AuthConfig`/`RequestIdentity` and Task 3's model types/errors. Export:

```ts
interface ConnectionStore {
  create(input: CreateConnectionInput): Promise<ConnectionRecord>;
  list(input: ListConnectionsInput): Promise<ConnectionPage>;
  get(id: string): Promise<ConnectionRecord | null>;
  rename(id: string, label: string | null): Promise<ConnectionRecord | null>;
  remove(id: string): Promise<boolean>;
}
type ConnectionStoreFactory = (identity: RequestIdentity, signal: AbortSignal) => ConnectionStore;
createSupabaseConnectionStoreFactory(
  config: AuthConfig,
  options?: { fetch?: typeof globalThis.fetch; timeoutMs?: number },
): ConnectionStoreFactory;
```

- [x] **Step 1: Write transport tests using the real SDK and an injected fetch.** `failed inserts issue exactly one POST` must count requests, return HTTP 503, call `store.create({ providerId: 'wealthsimple', label: null })`, assert rejection with `CONNECTION_STORAGE_UNAVAILABLE`, and assert `calls === 1`. Repeat with a thrown network error. Add `overlapping user stores never share Authorization`: capture each request and assert its Bearer token and owner filter match that store's identity.

  Assert insert payload contains only `provider_id` and `label`; get/rename/remove include both owner and ID filters; PATCH contains only `label`; explicit SELECT columns replace `*`. Zero-row arrays become null/false, including PATCH/DELETE, without an existence request. Exercise an expired downstream JWT (401), missing schema (404 must become 503), malformed rows/JSON, empty lists, 5-second default plus injected shorter deadlines, and caller abort. Exercise lookahead pagination: 51 fetched rows yield 50 results and a cursor for row 50, not row 51; equal timestamps order by UUID; microsecond cursor comparisons retain their precision.

- [x] **Step 2: Run `node --import tsx --test tests/connections-store.test.ts` and confirm RED.** Expected: missing store exports.

- [x] **Step 3: Implement the store factory.** Create a new SDK client per factory invocation with the publishable key, the request JWT in Authorization, disabled Auth session persistence/refresh, and **`db: { retry: false }`**. The pinned SDK enables POST retries by default; do not rely on its defaults. Use `.abortSignal()` with the caller signal plus `AbortSignal.timeout(options.timeoutMs ?? 5000)`, and prevent redirects. Catch transport errors without logging diagnostics.

  Query only the named table/columns. Apply `.eq('user_id', identity.user.id)` to reads/updates/deletes; PostgreSQL supplies insert ownership. Use ordered arrays for affected rows, not `.single()` error heuristics. List with `(created_at > timestamp) OR (created_at = timestamp AND id > id)`, followed by ascending `created_at,id` and `limit + 1`. Construct filter text only from Task 3's validated cursor values. Map every row with `mapConnectionRow`; reject unexpected cardinality or malformed payloads as storage unavailable. Map rejected user JWTs to 401 and every other unclassified Data API failure to the safe 503 storage error. Never retry a failed operation.

- [x] **Step 4: Run model/store tests and `npm run typecheck`.** Expected: all pass; fetch assertions prove token isolation, owner filters, disabled retries, and cancellation.

- [x] **Step 5: Commit.** Commit both files as `feat: add user-scoped connection record persistence`.

### Task 5: Expose the authenticated connection API

**Files:** Create `src/connections/routes.ts`, `tests/connections-fixtures.ts`, and `tests/connections-api.test.ts`; modify `src/app.ts` and `tests/browser-access.test.ts`.

**Interfaces:**

- `registerConnectionRoutes(app: FastifyInstance, options: { authenticate: AuthenticateRequest; registry: readonly Provider[]; createStore?: ConnectionStoreFactory }): void` registers an encapsulated plugin with its own safe error handling.
- Extend `AppOptions` with optional `createConnectionStore?: ConnectionStoreFactory` for tests. `createApp` passes the validated registry and shared authenticator; choose the injected factory or `createSupabaseConnectionStoreFactory(options.auth)` when Auth exists. Auth-unconfigured requests return 503 before factory use.
- Produce the five endpoint methods, response fields, status codes, Location header, and pagination envelope from the design. The test fixture exposes `{ app, calls }`, where `calls` records method, verified owner, input, and signal for a test-only injected store. It is never a production fallback.

- [x] **Step 1: Write HTTP tests against `createApp` before mounting routes.** Cover create/list/get/rename/clear/delete, empty lists, unique IDs for duplicate provider/label, 201 Location, 204 empty body, and repeated DELETE/foreign IDs returning identical 404 envelopes. Assert object keys are exactly `id,providerId,label,createdAt,updatedAt` and the create/get/rename/list wrappers match the design. All responses, including errors, have no-store.

  Add `record management never invokes provider routes`: use the existing synthetic provider and assert its call count remains zero. Add the removed-provider case by reusing one test store across app instances with and without that provider: existing operations succeed, creation fails 400. Assert invalid/ownership input, unknown provider, and malformed cursors cause zero store calls. Assert missing/rejected Auth prevents all store calls; Auth/storage outages preserve safe error codes.

  Add real HTTP cancellation with a pending injected store: close the client connection, assert its captured signal becomes aborted, then verify a later request succeeds without leaked state. Also disconnect while Auth is pending, release the verifier, and assert no store/write was started. Test malformed JSON, 16 KiB body overflow, and unsupported content type: preserve HTTP 400/413/415 respectively with a safe connection error envelope. Confirm no implicit HEAD read endpoint.

- [x] **Step 2: Run `node --import tsx --test tests/connections-api.test.ts tests/browser-access.test.ts` and confirm RED.** Expected: new connection routes return 404 before implementation.

- [x] **Step 3: Implement the route plugin and composition.** Install cancellation listeners before the first awaited Auth call; authenticate, validate using Task 3, then create the request store only if the caller is still connected. Stop after an authenticator failure. Couple storage signals to request `aborted` and unfinished response `close`; always remove listeners in finally. A scoped error handler translates domain and Fastify parsing/body errors into safe envelopes without changing provider/global handlers. Create returns `Location: /api/connections/<id>`; missing get/rename/remove results raise `CONNECTION_NOT_FOUND`.

  Configure collection preflight as GET/POST and item preflight as GET/PATCH/DELETE, with Authorization/Content-Type. OPTIONS returns 204 without Auth work; GET disables automatic HEAD. Keep the existing `/api/me` policy and legacy routes untouched.

- [x] **Step 4: Run API, browser, and existing boundary tests.** Run `node --import tsx --test tests/connections-api.test.ts tests/browser-access.test.ts tests/web-api.test.ts tests/app.test.ts tests/providers.test.ts tests/mcp.test.ts`, then `npm run typecheck`. Expected: all pass; CORS rejects unsupported origins/methods/headers and never grants access to provider/MCP/unknown paths.

- [x] **Step 5: Commit.** Commit this task's files as `feat: expose authenticated provider connection management`.

### Task 6: Prove local persistence and document the supported workflow

**Files:** Extend `tests/integration/supabase-fixture.ts` and `tests/integration/provider-connections.test.ts`; update `README.md` and `docs/local-auth-development.md`. Keep runtime evidence in ignored `output/playwright/pr2-connections/validation.md`; add no screenshots or UI code.

**Interfaces:**

- Add `startCompiledBackend(t: TestContext, config: AuthConfig): Promise<{ url: string; restart(): Promise<void> }>` to the fixture. Spawn `dist/main.js` on a free loopback port with explicit public Auth config, wait for health, sanitize captured logs, and stop only its own child process on cleanup.
- Extend the integration suite with `real user sessions retain isolated record IDs across application and database restarts`. `FINSIGHT_TEST_RESTART_SUPABASE=1` enables the explicit local Supabase stop/start portion. Its absence marks that portion skipped and leaves full acceptance incomplete; it must be enabled for the final acceptance run.

- [x] **Step 1: Add end-to-end assertions for the shipped API and restart sequence.** With actual user JWTs, A creates two Wealthsimple records and B one. Assert A/B lists are disjoint and forged GET/PATCH/DELETE return 404; rename one, clear another label, and delete only the intended row. Save surviving IDs/labels in memory. Sign out and back in, then restart the compiled backend, checking the same records after each step. With the restart flag, run this project's `npm run supabase:stop` and `npm run supabase:start`, reacquire user sessions, and assert the same surviving records again. Keep administrative clients out of every successful application request.

  Include concurrent A/B CRUD and microsecond/equal-timestamp pagination seeded through the fixture. Reuse Task 1's direct Data API attacks after API setup to prove no endpoint change weakened the database boundary. Add a regression asserting the old provider/MCP routes still reject browser-origin requests and records expose no financial-query endpoint.

- [x] **Step 2: Build and run the expanded integration suite.** Run `npm run build`, then `FINSIGHT_TEST_RESTART_SUPABASE=1 npm run test:connections:integration`. Fix actual failures before documenting success. Expected: all checks pass with no skipped restart acceptance, stable surviving IDs, and no output containing tokens/passwords. If the stack cannot run, retain the failure details and explicitly leave acceptance incomplete.

- [x] **Step 3: Verify fresh replay and additive upgrade.** On a separate disposable local Supabase project with its own ID and free ports, create a sentinel confirmed Auth user in the PR 1 schema before applying the canonical migration. Apply the migration, verify that user can still sign in, and rerun the Data API ownership tests. This proves clean application-schema replay and an upgrade preserving existing Auth data. For the existing local installation, inspect migration history and apply only pending migrations using the pinned CLI's local migration command; verify pre-existing Auth users remain. Never use a database reset or volume removal on the existing project. Run local advisors again and fix new findings. Remove only the disposable project's resources when finished.

- [x] **Step 4: Update setup and API documentation.** Replace PR 1-only claims about absent application tables; document explicit migration application, the local integration environment variables, and all five authenticated endpoints including labels, errors, pagination, and removal semantics. Show commands that load bearer tokens from ignored local files or interactive input, never literal credentials in history. Preserve the PR 1 Auth/browser instructions and clearly assign live sessions, UI, and agent authorization to PRs 3, 4, and 5. Record actual local validation revision, commands, versions, counts, advisors, and restart results in the ignored report.

- [x] **Step 5: Run the complete required checks once after final changes.** Run `npm test`, `npm run typecheck`, `npm run build`, `npm --prefix web test`, `npm --prefix web run typecheck`, `npm --prefix web run build`, and `git diff --check`. Expected: all exit 0. The real integration/restart evidence from Steps 2–3 is additionally required; unit/build success does not replace it. Repeat only checks affected by any subsequent fixes.

- [x] **Step 6: Commit the acceptance harness and docs.** Stage only this task's tracked files and commit as `test: verify connection ownership and restart persistence`. Confirm a clean working tree and provide the final acceptance evidence before claiming implementation complete.

## Self-review and execution handoff

Coverage: schema/RLS/grants → Task 1; reusable identity and exact-route CORS → Task 2; labels/cursors/public shape → Task 3; JWT-scoped storage/errors/deadlines → Task 4; HTTP contract/provider isolation → Task 5; actual persistence/migration replay/docs/full checks → Task 6. The five Review Focus cases each have an explicit owning test above. All cross-task type and function names match the Interfaces blocks.

Recommended execution method: **Native**, followed by one independent whole-branch review. These six tasks share a small set of identity/store interfaces, and local database acceptance is inherently sequential; keeping implementation in one session reduces repeated setup. A subagent-driven implementation remains available if the user prefers independent task-by-task review.

This document is a plan, not authorization to start execution. After the user reviews it and selects an execution method, invoke that method's required skill, establish worktree isolation, and execute task-by-task.

## Verified documentation references

- [Supabase migration workflow](https://supabase.com/docs/guides/local-development/database-migrations): capture migrations and replay them; preserve existing data for this project rather than using the tutorial's reset example.
- [Supabase JS automatic retries](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js): disable default PostgREST retries with `db.retry: false`.
- [Supabase JS AbortSignal](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal): combine cancellation and the storage deadline at the query boundary.


## Execution outcome — 2026-11-03

Implemented natively in the managed `pr2-provider-connections` worktree. All six
implementation tasks are committed. Backend: 137 tests pass; frontend: 23 tests
pass; both typechecks and builds pass. Real local acceptance passes all three
checks without skips, including renewed sessions and backend/database restarts.
The canonical migration replayed on a separate local project and preserved an
existing sentinel Auth user. Security advisors reported no issues on both stacks.
The fresh stack has been stopped; original Auth data and volumes are retained.

Independent whole-branch review found no Critical or Important issues. Deferred
minor: lone UTF-16 surrogate labels reach PostgreSQL and return a safe 503 rather
than a 400 validation response. Valid Unicode, emoji, length limits, whitespace,
and NUL validation are covered. Review considered all five Review Focus cases.

Rulings made during execution, in order:

1. Created the managed worktree as the approved plan's isolation prerequisite;
   the cost is another local checkout.
2. Used local container psql because CLI query rejects multi-statement files,
   then captured with db pull and retained equivalent readable SQL. Migration
   drift was the risk; fresh replay and actual ownership tests passed.
3. Used CLI 3's default local target in place of unsupported --local flags;
   hosted projects were never accessed.
4. Supplied existing public frontend settings through ignored web/.env to
   validate the required production build; no privileged key enters the browser.
5. Consolidated supplemental cancellation/malformed-response tests and formatting
   in the acceptance commit; the cost is additional review noise.

Runtime commands and local evidence are in ignored
`output/playwright/pr2-connections/validation.md`. One intermediate existing MCP
body-limit test encountered ECONNRESET; its targeted rerun and subsequent full
runs passed. No merge or remote publication has been performed.
