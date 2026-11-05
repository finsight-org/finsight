# Isolated Wealthsimple Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate, query, persist, restore and disconnect isolated user-owned Wealthsimple sessions through the backend.

**Architecture:** One backend process coordinates operations per connection. Wealthsimple exports a validated snapshot; FinSight encrypts it before a replaceable store saves it. Existing user-token/RLS ownership checks authorize access before the backend-only Supabase session adapter runs; the private CLI/MCP client remains separate.

**Tech Stack:** Node.js 24, TypeScript, Fastify, `node:crypto`, existing `tough-cookie`/`fetch-cookie`, Supabase PostgreSQL/PostgREST and the existing Node test runner. No new runtime dependency is expected.

**Spec:** [Working, isolated Wealthsimple sessions](../specs/2026-11-05-wealthsimple-sessions-design.md). Read both documents before execution.

## Global Constraints

- Support one FinSight backend process for simplicity.
- No UI, per-user MCP/OAuth authorization, financial-data cache or transaction store.
- No replacement of Supabase Auth or the existing connection-record implementation.
- No Vault dependency, distributed locks, background workers or multiple replicas.
- No automatic key-rotation service or additional storage adapters.
- No database transaction held open while calling Wealthsimple.
- No fallback from a user-owned request to the existing shared local session.
- No claim that a session is durable before its encrypted state is saved.
- AES-256-GCM: random 32-byte key, fresh 12-byte nonce per encryption, 16-byte authentication tag; plaintext snapshot limit 256 KiB.
- Bind the envelope format, purpose, verified FinSight user ID, connection ID and provider ID as deterministic associated data.
- Login bodies retain the 16 KiB limit, GraphQL the 1 MiB limit, and upstream responses the existing 8 MiB limit.
- Preserve upstream GraphQL JSON bytes/status, including 5xx, except recognized authentication handling; sanitize local failures.
- Reject a working-session login with HTTP 409 and `CONNECTION_ALREADY_CONNECTED`.
- Every scoped route requires verified FinSight authentication, current record ownership and `Cache-Control: no-store`.
- Secrets never enter frontend values, images, source control, request logs or local error responses.
- Follow repository Node/version pins; do not upgrade dependencies as part of this feature.

## Review Focus

1. Another user's identifier while their connection is busy must return 404 without touching its queue/client/store — Task 6.
2. Caller cancellation immediately after token rotation must still permit a bounded durable save — Task 5.
3. A save that commits but loses its response must return 503, evict the client and reload durable state on retry — Task 5.
4. Corrupt/unknown-version snapshots must return 503 without overwrite; explicit disconnect must still work — Tasks 1 and 5.
5. SIGTERM during provider work must finish shutdown within Compose's 10-second grace while preserving saved sessions — Task 7.

---

## File Map and Dependency Order

| Files | Responsibility |
| --- | --- |
| `src/sessions/model.ts`, `crypto.ts`, `config.ts` | Portable state/envelope/error contracts, authenticated encryption and startup configuration |
| `src/sessions/store.ts`, `supabase-store.ts` | Encrypted storage contract and backend-only Supabase implementation |
| `src/providers/wealthsimple/snapshot.ts`, `client.ts`, `validation.ts`, `index.ts` | Snapshot validation, restore/check/abort operations and shared request/query validation |
| `src/sessions/queue.ts`, `wealthsimple-service.ts` | Per-record execution and live/durable lifecycle |
| `src/connections/session-routes.ts`, existing `routes.ts` | Authenticated session/query endpoints and coordinated record deletion |
| `src/app.ts`, `src/main.ts` | Dependency injection, configuration and shutdown hooks |
| `supabase/migrations/*_provider_sessions.sql` | Additive backend-only table, constraints, privileges and cascade |
| `tests/session-*.test.ts`, `tests/session-fixtures.ts`, `tests/wealthsimple-snapshot.test.ts` | Focused crypto/store/queue/service/API/transport regression tests |
| `tests/integration/provider-sessions.test.ts`, `session-backend.ts`, `session-child.ts`, existing `supabase-fixture.ts` | Real ownership/storage and child-process restart acceptance |
| `compose.sessions.yaml`, `.env.example`, `README.md`, deployment/Auth docs, `package.json` | Opt-in session deployment, operator instructions and integration command |

Tasks 1 and 2 establish independent contracts. Task 3 needs Task 1. Task 4 is
independent infrastructure. Task 5 needs Tasks 1–4; Task 6 needs Task 5; Task 7
verifies and packages the complete path. This is one deliverable, not separate
products. Execute sequentially unless the chosen execution method says otherwise.

At execution time use the worktree skill to obtain an isolated checkout, install
the existing lockfile with `npm ci`, and run baseline `npm test`,
`npm run typecheck`, `npm run build`. Check installed CLI help in that execution
checkout before selecting database command flags. Do not change databases during planning.

### Task 1: Encryption, Portable Contracts and Configuration

**Files:** Create `src/sessions/model.ts`, `src/sessions/crypto.ts`, `src/sessions/config.ts`, `src/sessions/store.ts`, `tests/session-crypto.test.ts`, `tests/session-config.test.ts`.

**Interfaces:**

```ts
interface SessionBinding { userId: string; connectionId: string; providerId: string }
interface EncryptedSessionEnvelope { version: 1; nonce: string; ciphertext: string; tag: string }
type DurableSession =
  | { state: 'connected'; envelope: EncryptedSessionEnvelope }
  | { state: 'expired'; envelope: null };
type SessionStatus = 'disconnected' | 'mfa_required' | 'connected' | 'expired';
interface SessionCipher {
  encrypt(binding: SessionBinding, plaintext: string): EncryptedSessionEnvelope;
  decrypt(binding: SessionBinding, envelope: unknown): string;
}
interface SessionStore {
  load(connectionId: string, signal: AbortSignal): Promise<DurableSession | null>;
  save(connectionId: string, state: DurableSession, signal: AbortSignal): Promise<void>;
  remove(connectionId: string, signal: AbortSignal): Promise<void>;
}
interface SessionConfig { supabaseSecretKey: string; encryptionKey: Uint8Array }
createSessionCipher(key: Uint8Array): SessionCipher;
readSessionConfig(env: NodeJS.ProcessEnv, authConfigured: boolean): Promise<SessionConfig | undefined>;
```

Export contracts from the named files; `SessionError` in `model.ts` exposes safe
`code`, `message`, `statusCode`. Define 503 codes `SESSION_NOT_CONFIGURED`,
`SESSION_STORAGE_UNAVAILABLE`, `SESSION_STATE_UNAVAILABLE`, `SESSION_SERVICE_CLOSED`
and 409 codes `CONNECTION_ALREADY_CONNECTED`, `CONNECTION_PROVIDER_UNSUPPORTED`.

- [x] **Step 1: Write crypto/configuration tests.** Use deterministic sentinel plaintext and temporary key files. Assertions include:

```ts
assert.equal(cipher.decrypt(binding, cipher.encrypt(binding, plaintext)), plaintext);
assert.notDeepEqual(cipher.encrypt(binding, plaintext), cipher.encrypt(binding, plaintext));
assert.equal(Buffer.from(envelope.nonce, 'base64').length, 12);
assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
assert.doesNotMatch(JSON.stringify(envelope), /ACCESS_SENTINEL|REFRESH_SENTINEL/);
assert.throws(() => cipher.decrypt({ ...binding, connectionId: otherId }, envelope),
  { code: 'SESSION_STATE_UNAVAILABLE', statusCode: 503 });
assert.throws(() => cipher.encrypt(binding, 'x'.repeat(256 * 1024 + 1)));
assert.equal(await readSessionConfig({}, false), undefined);
await assert.rejects(readSessionConfig(partialConfig, true));
await assert.rejects(readSessionConfig(bothKeySources, true));
```

Add named cases for wrong user/provider/key, modified nonce/tag/ciphertext,
noncanonical base64, oversized encrypted input, unknown envelope version, invalid
UTF-8 plaintext on decrypt, 31/33-byte keys, missing key file, session config
without Auth, and a file containing a valid key followed by one newline. Ensure
errors do not include supplied secret strings. Test the 256 KiB boundary in bytes,
including multibyte text. Reject before decoding/decrypting excessive envelopes.

- [x] **Step 2: Run the failing tests.** `node --import tsx --test tests/session-crypto.test.ts tests/session-config.test.ts`; expect missing-module/export failures before implementation.
- [x] **Step 3: Implement the contracts, cipher and config loader.** AAD is the UTF-8 JSON encoding of `['finsight.provider-session', 1, userId, connectionId, providerId]`. Envelope binary fields use canonical standard base64. Only expose decrypted text after GCM final/authentication succeeds. Trim surrounding whitespace for key-file/environment input, then validate canonical base64 decoding to exactly 32 bytes. Accept exactly one of `FINSIGHT_SESSION_ENCRYPTION_KEY` / `_FILE` together with `SUPABASE_SECRET_KEY` (`sb_secret_…`), and require existing Auth configuration. Missing all session values disables the feature; partial values throw a sanitized startup error. Keep reads local; never fetch a key from the database.
- [x] **Step 4: Verify.** Repeat Step 2 and `npm run typecheck`; expect all tests passing and exit 0.
- [x] **Step 5: Commit.** Stage only this task's files; `git commit -m "feat: add portable encrypted session contracts"`.

### Task 2: Restorable Wealthsimple Snapshots and Session Validation

**Files:** Create `src/providers/wealthsimple/snapshot.ts`, `src/providers/wealthsimple/validation.ts`, `tests/wealthsimple-snapshot.test.ts`; modify `src/providers/wealthsimple/client.ts:32`, `:80`, `:102`, `:158`, `:234`, `src/providers/wealthsimple/index.ts`, `tests/wealthsimple-fixtures.ts`.

**Interfaces:** Consumes existing `LoginInput`, `GraphQLRequest`, `WealthsimpleOptions` from `client.ts`. Produces:

```ts
interface WealthsimpleSnapshot {
  version: 1;
  session: { clientId: string; deviceId: string; sessionId: string;
    accessToken: string; refreshToken: string; identityId: string };
  cookies: ReturnType<import('tough-cookie').CookieJar['serializeSync']>;
}
parseWealthsimpleSnapshot(value: unknown): WealthsimpleSnapshot; // snapshot.ts
// Add to WealthsimpleClient:
exportSnapshot(): WealthsimpleSnapshot | null;
restoreSnapshot(value: unknown): void;
validateSession(signal: AbortSignal): Promise<'connected' | 'expired'>;
abortUpstream(): void; // abort work without clearing exportable state
// validation.ts:
loginInput(value: unknown): LoginInput;
graphqlInput(value: unknown): GraphQLRequest;
assertQueryOnly(query: string): void;
```

`close()` retains its legacy abort-and-clear behavior. Scoped-service shutdown
uses `abortUpstream()` followed by persistence and only then `close()`. The
fixture additionally returns `clientOptions: WealthsimpleOptions` to construct
clients against its existing synthetic server.

- [x] **Step 1: Write snapshot and validity tests.** Login client A, export, restore client B, query and inspect the existing upstream call log:

```ts
assert.equal(snapshot.version, 1);
assert.equal(restored.getStatus(), 'connected');
assert.equal(lastRead.headers.authorization, 'Bearer ACCESS_SENTINEL');
assert.match(String(lastRead.headers.cookie), /COOKIE_SENTINEL/);
assert.equal(lastRead.body.variables.identityId, 'IDENTITY_SENTINEL');
assert.doesNotMatch(JSON.stringify(snapshot), /PASSWORD_SENTINEL|OTP_SENTINEL/);
assert.equal(await restored.validateSession(signal), 'connected');
assert.equal(await terminallyRejected.validateSession(signal), 'expired');
assert.equal(terminallyRejected.exportSnapshot(), null);
await assert.rejects(temporarilyUnavailable.validateSession(signal), { code: 'WEALTHSIMPLE_UPSTREAM_FAILURE' });
assert.notEqual(temporarilyUnavailable.exportSnapshot(), null);
```

Add cases named `snapshot is detached from mutable client state`, `MFA cannot
export a connected snapshot`, `restore rejects extra/invalid fields and broken
cookie jars`, `info 401 refreshes once and persists rotated tokens`, `identity
mismatch expires`, `abortUpstream preserves completed session material`, and
`login/token-info 5xx is an upstream failure`. Assert mutation/subscription guards
still reject a mixed document when operationName selects a query. Do not change
the legacy route's repeated-login behavior; the scoped service enforces 409.

- [x] **Step 2: Run red.** `node --import tsx --test tests/wealthsimple-snapshot.test.ts`; expect missing methods/exports.
- [x] **Step 3: Implement the interfaces.** Validate strict snapshot shape, nonempty fields, version and a cookie jar restorable through `CookieJar.deserializeSync`; export a detached snapshot only when completely connected. Token-info validation compares canonical identity, shares existing refresh logic, retries once on recognized auth rejection and clears terminally invalid sessions. Temporary failures preserve state. Extract request/document validation into the shared file without broad provider refactoring. Keep endpoint origins application-controlled. Do not put snapshots into route responses or errors.
- [x] **Step 4: Verify.** `node --import tsx --test tests/wealthsimple*.test.ts` and `npm run typecheck`; expect new tests and existing transport/session/shutdown/CLI behavior passing.
- [x] **Step 5: Commit.** Stage this task's files; `git commit -m "feat: restore and validate Wealthsimple session snapshots"`.

### Task 3: Backend-Only Durable Storage and Additive Migration

**Files:** Create `src/sessions/supabase-store.ts`, `tests/session-store.test.ts`, `tests/integration/provider-sessions.test.ts`, one CLI-generated `supabase/migrations/*_provider_sessions.sql`; extend `tests/integration/supabase-fixture.ts`; add `test:sessions:integration` in `package.json`.

**Interfaces:** Consumes Task 1 `SessionStore`, `DurableSession`, `SessionError`. Produces:

```ts
createSupabaseSessionStore(config: { supabaseUrl: string; secretKey: string },
  options?: { fetch?: typeof globalThis.fetch; timeoutMs?: number }): SessionStore;
```

Extend `createLocalFixture(t)` with `sessionStore: SessionStore`,
`readSessionRow(id: string): Promise<unknown>`, and `deleteOwnedTestUser(id: string): Promise<void>`.
These helpers use the already validated local URL and test secret, operate only
on fixture-owned records/users, and never print credentials. `readSessionRow`
uses the fixture's privileged client solely for acceptance assertions.

- [x] **Step 1: Write adapter and database-permission tests.** Cover load/missing/save/replace/remove, malformed rows, timeout/abort, sanitized failures and no mutation retries. Capture fetch requests and assert only encrypted data is sent, with no user JWT override. Add integration assertions:

```ts
await f.sessionStore.save(id, connectedState, signal);
assert.deepEqual(await f.sessionStore.load(id, signal), connectedState);
assert.notEqual((await f.a.client.from('provider_sessions').select()).error, null);
assert.notEqual((await f.b.client.from('provider_sessions').insert(forgedRow)).error, null);
assert.notEqual((await anonymous.from('provider_sessions').select()).error, null);
await f.a.client.from('provider_connections').delete().eq('id', id);
assert.equal(await f.sessionStore.load(id, signal), null);
await assert.rejects(f.sessionStore.save(id, connectedState, signal));
assert.equal(mutationAttempts, 1);
```

Also assert direct authenticated UPDATE/DELETE denial, CHECK rejection for
connected/null and expired/non-null rows, and the auth-user deletion cascade.
Use synthetic encrypted envelopes, not real tokens. Existing metadata RLS tests
must remain unchanged and passing.

- [x] **Step 2: Run red.** `node --import tsx --test tests/session-store.test.ts`; expect missing adapter. After local setup, the integration test must fail because `provider_sessions` is absent, not because keys are missing.
- [x] **Step 3: Implement the adapter.** Use a dedicated secret-key Supabase client with no user auth, session persistence or auto-refresh. Set `db.retry: false`, `redirect: 'error'`, a 5,000 ms default timeout combined with the operation signal, explicit selected columns and `connection_id` filters. Validate returned state/envelope rows. Bound fetched envelopes and map every store error, including secret-key rejection, to sanitized storage 503. `save` upserts one row; `remove` is idempotent. No plaintext or provider-specific types cross this interface.
- [x] **Step 4: Inspect the local database and installed CLI.** Follow the existing local development guide for stack setup and private test environment loading. Read existing schema and run `npx supabase --help`, `npx supabase db query --help`, `npx supabase migration new --help`, `npx supabase db pull --help`, `npx supabase db advisors --help`. Flag forms must come from installed 3.0.0 help rather than older documentation. Never reset the shared database or target a hosted project.
- [x] **Step 5: Exercise the additive DDL locally without history writes.** Use the documented query command. Define `provider_sessions(connection_id uuid primary key references public.provider_connections(id) on delete cascade, state text not null, encrypted_session jsonb, updated_at timestamptz not null default now())`, constrain states and envelope nullability, enable RLS, revoke all from PUBLIC/anon/authenticated, and grant only SELECT/INSERT/UPDATE/DELETE to service_role. Use a SECURITY INVOKER update-timestamp trigger with fixed empty search_path and revoked public execution. Run the direct permission/cascade cases against this schema; expect Task 3 Step 1 assertions to pass.
- [x] **Step 6: Record the final additive migration.** Run local security advisors and fix issues introduced here. Follow the Supabase skill's final migration workflow using installed CLI help; keep only one nonempty provider-sessions migration, use its actual generated timestamp/path and verify history/grants. Do not use `apply_migration` for iteration. The migration must reproduce all DDL and privileges from Step 5, without unrelated schema changes. Add `test:sessions:integration` as `node --import tsx --test --test-concurrency=1 tests/integration/provider-sessions.test.ts`.
- [x] **Step 7: Verify.** Repeat adapter tests; run `npm run build`, `npm run test:connections:integration`, `npm run test:sessions:integration`, `npm run typecheck`. With the three existing `FINSIGHT_TEST_SUPABASE_*` variables loaded privately, expect all cases passing and no permission bypass. Fixture setup failures are not acceptance evidence.
- [x] **Step 8: Commit.** Stage the adapter/tests/fixture/script and actual generated migration; `git commit -m "feat: persist encrypted sessions in backend-only storage"`.

### Task 4: Per-Connection Execution Queue

**Files:** Create `src/sessions/queue.ts`, `tests/session-queue.test.ts`.

**Interfaces:** Consumes Task 1 `SessionError`; produces:

```ts
class ConnectionQueue {
  run<T>(connectionId: string, signal: AbortSignal, work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

`close` stops admission, rejects waiting jobs with `SESSION_SERVICE_CLOSED`, waits
for active work and releases queue state. It does not abort provider calls; the
owning service does that first. Empty-key entries are removed after settlement.

- [x] **Step 1: Write barrier-controlled queue tests.** Use the existing `deferred` helper; no timing-based sleeps:

```ts
assert.deepEqual(started, ['a-first', 'b-first']); // a-second waits, B runs
releaseA.resolve();
await Promise.all([aFirst, aSecond, bFirst]);
assert.deepEqual(started, ['a-first', 'b-first', 'a-second']);
abortWaiting.abort();
await assert.rejects(cancelledJob);
assert.equal(cancelledWorkCalls, 0);
await assert.rejects(afterClose, { code: 'SESSION_SERVICE_CLOSED' });
```

Add `rejected jobs release the next slot`, `closing rejects waiting work but
waits for active work`, `already aborted jobs never run`, and repeated same-key
reuse after completion without blocked/leaked queue state.

- [x] **Step 2: Run red.** `node --import tsx --test tests/session-queue.test.ts`; expect missing class.
- [x] **Step 3: Implement `ConnectionQueue`.** FIFO per key, independent keys, abortable queued admission, rejection-safe cleanup and a bounded ownership of job closures. Never retain resolved credential-capturing work functions in a history array or tail chain after settlement.
- [x] **Step 4: Verify.** Repeat Step 2 and `npm run typecheck`; expect passing tests and no unhandled rejections.
- [x] **Step 5: Commit.** Stage the two files; `git commit -m "feat: serialize session work per connection"`.

### Task 5: Isolated Live Session Lifecycle and Failure Handling

**Files:** Create `src/sessions/wealthsimple-service.ts`, `tests/session-fixtures.ts`, `tests/session-service.test.ts`, `tests/session-lifecycle.test.ts`.

**Interfaces:** Consumes Tasks 1–4. `SessionAccess` is internal trusted context:

```ts
interface SessionAccess {
  binding: SessionBinding;
  checkOwnership(signal: AbortSignal): Promise<void>;
}
interface WealthsimpleSessionServiceOptions {
  store: SessionStore; cipher: SessionCipher;
  createClient?: () => WealthsimpleClient;
  now?: () => number;
}
class WealthsimpleSessionService {
  constructor(options: WealthsimpleSessionServiceOptions);
  status(access: SessionAccess, signal: AbortSignal): Promise<{ status: SessionStatus }>;
  login(access: SessionAccess, input: LoginInput, signal: AbortSignal): Promise<{ status: 'connected' | 'mfa_required' }>;
  graphql(access: SessionAccess, input: GraphQLRequest, signal: AbortSignal): Promise<{ status: number; text: string }>;
  disconnect(access: SessionAccess, signal: AbortSignal): Promise<void>;
  removeRecord(access: SessionAccess, remove: () => Promise<boolean>, signal: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}
```

The HTTP adapter performs the first ownership check; each service method repeats
`access.checkOwnership` inside its queue slot before cache/store/provider access.
`removeRecord` works for any provider, clears cached state without decrypting,
then calls the supplied user-scoped remove callback in the same slot; metadata
cascade removes durable state. It returns the callback's boolean, evicting on an
uncertain outcome. Live methods reject unsupported providers with 409.

Create `sessionFixture(t)` with `{ service, store, a1, a2, b1, signal, calls,
restart(), passwordGrants() }`: three trusted accesses with distinct UUIDs, two
users, an encrypted in-memory store retained by `restart`, and a synthetic
Wealthsimple fetch implementation that ties token/info/query/cookie values to
the submitted login. Expose store fail-before-save and commit-then-fail modes,
plus upstream barriers and token rejection flags for lifecycle tests. Never add
test-only upstream URLs or credential logging to production startup.

- [x] **Step 1: Write service behavior tests.** Assertions include:

```ts
assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'disconnected' });
assert.deepEqual(await f.service.login(f.a1, credentials, f.signal), { status: 'connected' });
await assert.rejects(f.service.login(f.a1, credentials, f.signal),
  { code: 'CONNECTION_ALREADY_CONNECTED', statusCode: 409 });
assert.equal(f.passwordGrants(), 1);
assert.doesNotMatch(JSON.stringify([...f.store.rows.values()]), /ACCESS_SENTINEL|REFRESH_SENTINEL|COOKIE_SENTINEL|PASSWORD_SENTINEL/);
await f.restart();
assert.equal((await f.service.graphql(f.a1, query, f.signal)).status, 200);
await f.service.disconnect(f.a1, f.signal);
assert.deepEqual(await f.service.status(f.a1, f.signal), { status: 'disconnected' });
```

Add cases asserting distinct A1/A2/B1 identities/cookies, OTP isolation and
restart reset, connected-status provider validation, expiration persistence and
reconnection, temporary outage retention, rotated token and changed-cookie
restoration, no save for unchanged material, JSON-5xx pass-through, corrupt or
unknown-version snapshots returning 503 without save, and explicit disconnect
success on unreadable state. Assert unknown snapshot payload versions also fail
safely after envelope decryption, and preserve native financial fields.

- [x] **Step 2: Write lifecycle failure/race tests.** Named tests and core assertions:

```ts
// caller abort after refresh response: release the save barrier after abort
assert.notEqual(savedSnapshot.session.refreshToken, oldRefreshToken);
assert.equal(saveSignal.aborted, false);
// commit-then-fail save
await assert.rejects(operation, { code: 'SESSION_STORAGE_UNAVAILABLE' });
assert.equal(nextRequestRestoredClient, true);
assert.equal(restoredRefreshToken, committedRefreshToken);
// A disconnect while B queries; same-record work waits until durable deletion
assert.equal(bResult.status, 200);
assert.equal(await f.store.load(f.a1.binding.connectionId, f.signal), null);
// closing never calls durable remove and rejects new work
assert.equal(durableRemovalsDuringClose, 0);
await assert.rejects(afterClose, { code: 'SESSION_SERVICE_CLOSED' });
```

Also test ownership disappearing inside the slot (no provider/store activity),
two overlapping logins (one password grant, second 409), failed save after login
or cookies changed on an upstream error (503, evicted), failed durable remove
(503, no false success), same-record query/refresh then disconnect/removal (no
late save), cancellation while queued (zero upstream calls), close during a
bounded save (await save, keep row), and transient cache eviction/reload.

- [x] **Step 3: Run red.** `node --import tsx --test tests/session-service.test.ts tests/session-lifecycle.test.ts`; expect missing service.
- [x] **Step 4: Implement the lifecycle.** Lazily decrypt/parse/restore and validate a client after ownership checks. Reject cached binding mismatch. Use one private client/queue per record; validate existing connected sessions before refusing login. Persist only completed snapshots; retain prior expired markers during MFA/failed login. After each operation, including caught upstream errors/abort, finalize meaningful token/cookie changes before releasing the slot. Compare detached snapshots while ignoring cookie `lastAccessed` only; preserve expiry/creation/value/security fields. Use a service-owned 5,000 ms persistence signal, independent of caller cancellation. Save terminal failures as expired with no envelope; do not mark expiry merely because of an abort, shutdown or temporary failure. Storage/decryption errors take precedence over returning success; evict after uncertain writes. Disconnect bypasses decryption and deletes durable state; record removal relies on FK cascade. Shutdown marks closing, aborts clients without clearing exportable material, rejects queued work, drains finalization, then clears clients. Cap inactive cache entries at 256 and evict after 15 minutes idle, sweeping on operation boundaries with the injectable clock; never evict active entries. MFA evicted by age/pressure must restart authentication. The queue map releases empty entries independently.
- [x] **Step 5: Verify.** Repeat Step 3, Task 4 tests, `node --import tsx --test tests/wealthsimple-session.test.ts tests/wealthsimple-shutdown.test.ts` and `npm run typecheck`; all must pass without real services or credentials.
- [x] **Step 6: Commit.** Stage this task's files; `git commit -m "feat: manage isolated persistent Wealthsimple sessions"`.

### Task 6: Authenticated Routes, Record Deletion and Startup Wiring

**Files:** Create `src/connections/session-routes.ts`, `tests/session-api.test.ts`; modify `src/connections/routes.ts:12`, `:45`, `:132`, `src/app.ts`, `src/main.ts`, `tests/browser-access.test.ts`, `tests/connections-api.test.ts`, `tests/integration/provider-connections.test.ts`.

**Interfaces:** Consumes `SessionAccess`, `WealthsimpleSessionService`, shared provider validation and existing `AuthenticateRequest`/`ConnectionStoreFactory`. Produces:

```ts
registerConnectionSessionRoutes(app: FastifyInstance, options: {
  authenticate: AuthenticateRequest;
  createStore?: ConnectionStoreFactory;
  sessions?: WealthsimpleSessionService;
}): void;
// AppOptions addition:
connectionSessions?: WealthsimpleSessionService;
```

Extend `registerConnectionRoutes` options with `sessions?: WealthsimpleSessionService`.
This remains optional so existing test providers and session-disabled deployments
work. `createApp` passes one service to both route registrations and owns its
`preClose` hook. `main.ts` loads config, creates cipher/store/service and passes
the service; it never creates per-user clients inside the legacy provider factory.

- [x] **Step 1: Write HTTP boundary tests using injected stores/verifier/service.** Assert exact routes and outcomes:

```ts
assert.equal((await requestWithoutAuth()).statusCode, 401);
assert.equal((await requestOtherUsersBusyId()).statusCode, 404);
assert.deepEqual([queueCalls, snapshotLoads, providerCalls], [0, 0, 0]);
assert.equal((await postLoginTwice()).json().error.code, 'CONNECTION_ALREADY_CONNECTED');
assert.equal((await unsupportedOwnedProvider()).statusCode, 409);
assert.equal((await oversizedLogin()).statusCode, 413);
assert.equal((await unsupportedMedia()).statusCode, 415);
assert.equal((await ownedButSessionDisabled()).json().error.code, 'SESSION_NOT_CONFIGURED');
assert.equal((await getStatus()).headers['cache-control'], 'no-store');
assert.equal((await nativeJson500()).statusCode, 500);
assert.equal((await nativeJson500()).body, upstreamJsonBytes);
```

For denied-request counters, assert deltas from just before that request, after
the other user's active operation has entered its barrier. Add OPTIONS
allowed-origin/method/header assertions; unapproved origins and
legacy provider/MCP browser access remain 403. Assert malformed IDs/body/query
never reach session storage, invisible and missing records are indistinguishable,
status/errors omit sentinel credentials/identity fields, connection DTOs retain
their exact fields, and DELETE metadata participates in the same queue. Simulate
ownership removal after the first lookup and ensure the second lookup rejects.
Capture logger output and assert submitted password/OTP/token/key sentinels never
appear. Do not forbid those field names inside authorized native financial JSON.

- [x] **Step 2: Run red.** `node --import tsx --test tests/session-api.test.ts`; expect scoped route 404s before wiring.
- [x] **Step 3: Implement routes and app wiring.** Expose GET/POST/DELETE `/api/connections/:connectionId/session` and POST `/api/connections/:connectionId/graphql`. Reuse auth, ID/body validation, cancellation cleanup and browser metadata. Construct trusted access only after retrieving owned metadata; revalidation callbacks use the current user-scoped connection store. Keep error handling scoped to these routes, preserving 413/415 and existing legacy behavior. For metadata DELETE, precheck ownership then call `sessions.removeRecord` when configured; no live service means the old remove path. Never decrypt to remove a record. Load full session configuration before listen, add early service shutdown, and keep Auth-disabled/private workflows operational. Update the old integration assertion that `/api/connections/:id/graphql` does not exist: with owned record but disabled session service it now returns 503, while unknown/foreign records remain 404. Do not change MCP tools or CLI parameters.
- [x] **Step 4: Verify.** Run `npm test`, `npm run typecheck`, `npm run build`; expect full existing and new suites passing. Run local connection/session integration suites if the stack is available; report missing prerequisites distinctly.
- [x] **Step 5: Commit.** Stage this task's files; `git commit -m "feat: expose authenticated connection session endpoints"`.

### Task 7: Deployment, Child-Process Restarts and Acceptance

**Files:** Create `compose.sessions.yaml`, `tests/integration/session-backend.ts`, `tests/integration/session-child.ts`, `tests/session-deployment.test.ts`; extend `tests/integration/provider-sessions.test.ts`, `tests/integration/supabase-fixture.ts`, `.env.example`, `README.md`, `docs/local-auth-development.md`, `docs/local-deployment.md`. Keep base `compose.yaml` working without session secrets.

**Interfaces:** Consumes the complete app/service/config. Produces test helper:

```ts
startSessionBackend(t: TestContext, config: AuthConfig, options: {
  secretKey: string; encryptionKey: string; wealthsimple: WealthsimpleOptions;
}): Promise<{ url: string; restart(): Promise<void>; stop(): Promise<void> }>;
```

`session-backend.ts` is the parent helper; `session-child.ts` is the test-only child
entrypoint. Launch it with Node's existing tsx import hook and dynamically import
built modules by file URL, typed using the corresponding source module types, so
root typecheck does not require emitted declaration files in `dist`. The parent
privately supplies local test configuration and synthetic endpoint origins over
IPC; readiness/shutdown use IPC messages. Add no production endpoint override env
vars. Keep synthetic provider state alive in the parent across child restarts.
Document `npm run build` as the integration command's explicit prerequisite,
consistent with the existing connection integration script.

- [x] **Step 1: Write full acceptance cases.** Authenticate A1/A2/B1 with distinct synthetic logins through real HTTP, including OTP; assert each native result identity/account/cookie matches its selected owned record, and all cross-user requests are 404. Inspect actual stored rows for plaintext absence. Restart the child, query again, force refresh/cookie change, restart again and query successfully. Assert app sign-out/sign-in preserves provider state, expiration/reconnection works and deleting A leaves B queryable. For `FINSIGHT_TEST_RESTART_SUPABASE=1`, stop/start the local stack preserving volumes, sign test users in again, restart the child with the same key and verify saved provider sessions. Cover privileged table denial and cascades from Task 3.

Add `SIGTERM during blocked provider request preserves saved sessions` with these
assertions using an abort-aware synthetic endpoint and an IPC signal barrier:

```ts
assert.equal(childExitCode, 0);
assert.ok(elapsedMs < 10_000);
assert.notEqual(await f.sessionStore.load(a1Id, signal), null);
assert.equal(afterRestartQuery.status, 200);
```

Add deployment config assertions for absent/present/partial session config,
base Compose working without key files, read-only key mounting in the opt-in
override, unchanged frontend build arguments, and no secret image COPY paths.
Use synthetic environment values and never print interpolated real configuration.

- [x] **Step 2: Run red.** `node --import tsx --test tests/session-deployment.test.ts`, then `npm run test:sessions:integration` with local credentials loaded privately; expect missing override/helper or unimplemented acceptance cases, not unexplained setup errors.
- [x] **Step 3: Implement child-process acceptance support.** Implement `startSessionBackend` and its IPC child entrypoint as specified above. Preserve the same database, deployment key and synthetic provider state through child restart; use `SIGTERM` for the shutdown test, not a test-only close shortcut.
- [x] **Step 4: Add the opt-in deployment override.** Set `SUPABASE_SECRET_KEY` from the backend runtime environment and mount `./.secrets/finsight_session_key` as `/run/secrets/finsight_session_key`, read-only; set `FINSIGHT_SESSION_ENCRYPTION_KEY_FILE` to that path. Preserve base Compose loopback publishing/read-only filesystem/non-root user and the existing 10-second grace. Keep the key out of build context via the existing allowlist. Add blank runtime secret placeholders to `.env.example` without frontend exposure.
- [x] **Step 5: Write operator and API documentation.** Document correct host permissions so the container's node user can read only its intended key. Provide Node-based interactive login/OTP/API examples that read secret files or prompt rather than passing credentials in shell arguments. Explain 15-minute/cache-pressure MFA restart, persistence guarantees, independent local/MCP sessions, expired vs temporarily unavailable status, key backup/recovery and the provider-rotation crash window. Remove outdated claims that all sessions are memory-only or privileged application keys are never required; distinguish the metadata and session adapters. Document integration build/secret-loading prerequisites and deployment commands using the explicit opt-in override.
- [x] **Step 6: Run final verification.** From the isolated checkout:

```sh
npm test
npm run typecheck
npm run build
npm run test:connections:integration
npm run test:sessions:integration
FINSIGHT_TEST_RESTART_SUPABASE=1 npm run test:sessions:integration
docker compose config --quiet
docker compose -f compose.yaml -f compose.local-auth.yaml -f compose.sessions.yaml config --quiet
git diff --check
```

Load secrets using the existing ignored local status-file workflow; never print
them. The session integration tests must refuse hosted URLs. The restart run
briefly interrupts other local-stack consumers; schedule it within the local
acceptance run and preserve all volumes/data. Require no skipped restart case in
the full acceptance report. If Docker/local Supabase is unavailable, document
which checks remain unrun and do not claim complete acceptance. A real-account
smoke test is separate and only performed with an available authorized login.

- [x] **Step 7: Commit.** Stage this task's files; `git commit -m "test: verify isolated sessions across restarts and deployment"`.

## Self-Review and Handoff

- Spec coverage: scope/portability/encryption/config → Task 1; client identity,
  snapshots/MFA/validation → Task 2; schema/backend access/cascade → Task 3;
  independent serialization → Task 4; persistence/failure/abort/eviction/shutdown
  → Task 5; ownership/routes/deletion/legacy compatibility → Task 6; deployment,
  process/database restart and full acceptance → Task 7.
- Interface check: `SessionBinding`, `EncryptedSessionEnvelope`, `DurableSession`,
  `SessionCipher`, `SessionStore`, `SessionAccess` and service method names are
  shared exactly as defined above. External auth types do not enter cipher/store
  contracts, and provider code never imports the Supabase session adapter.
- The five Review Focus cases have named/asserted tests in their owning tasks.
- The migration timestamp is generated by the installed CLI during execution;
  every other new source/test path is fixed above.
- Save task checkboxes as execution proceeds. The user selected subagent-driven execution; all seven tasks are complete.

Recommended execution: **subagent-driven**, because the seven tasks cross
encryption, ownership and concurrent session boundaries where an independent
check before integration is useful. Native execution remains the option with
less coordination overhead. The user selected subagent-driven execution.


## Execution Results

All seven tasks completed using fresh implementers and independent task reviews.
The whole-branch review found two Important issues, both fixed in `2785700` and
confirmed by scoped re-review: canonical UUID bindings across queues/cache/AAD,
and nonblank provider identifiers/tokens preserving sessions on malformed replies.
The earlier ambiguous-refresh classification issue was fixed in `6bac6c3`.

Final verification on the fixed code:

- `npm test`: 242 pass, zero failures/skips.
- `npm run typecheck` and `npm run build`: pass.
- `npm run test:deployment`: one pass; default Node tests also pass without Docker on PATH.
- Real metadata integration: two pass; its optional legacy restart subcase skipped.
- `FINSIGHT_TEST_RESTART_SUPABASE=1 npm run test:sessions:integration`: five pass, zero skips, retained volumes.
- Blocked-provider SIGTERM exits cleanly; saved session works after restart.
- Base/opt-in Compose configuration and non-root mounted key readability verified.

No real Wealthsimple login/OTP smoke or separate native Linux host run was
performed. Provider traffic in tests was synthetic. A private Pino stream symbol
used by a log-sanitization test remains a nonblocking maintenance item.

### Rulings made during execution

- schema migration workflow may use a clean additive CLI-generated manual migration applied once after local checks — installed CLI and existing repository workflow decide flags; no destructive resets or hosted writes; cost if wrong: local migration history may need a corrective additive migration.
- Task 5 uses a service-owned provider-operation signal while caller cancellation invokes client.abortUpstream(), awaits refresh/finalization inside the queue slot, then evicts the aborted client — the existing client caller-cancellable refresh waiter otherwise could release a slot before shared refresh settles; cost if wrong: cancellation may require a service/client lifecycle correction, covered by rotation-abort tests.
- Task 5 may include the minimal provider-boundary correction discovered by HTTP200/null token-info regression — malformed provider responses must be safe 502s with retained sessions under the approved lifecycle spec; cost if wrong: small provider hunk may need revision, reviewed with Task5.
- Task 5 fix round may minimally change provider refresh classification outside its listed files — independent review proved malformed HTTP400/unrecognized HTTP200 errors can destructively persist expired, violating binding spec; cost if wrong: legacy refresh behavior needs a narrow compatibility correction, covered by provider regressions.
