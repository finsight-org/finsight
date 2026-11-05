# Working, isolated Wealthsimple sessions

- Date: 2026-11-05
- Status: Draft for approval
- Issue: [#26 — PR 3](https://github.com/finsight-org/finsight/issues/26)

## Intent and scope

Turn an existing user-owned Wealthsimple connection record into a working,
persistent provider session. Two FinSight users must be able to authenticate
different Wealthsimple identities, query their own data, restart FinSight, and
disconnect independently using backend requests. No web interface is built here.

The roadmap separates the work deliberately:

- [#23](https://github.com/finsight-org/finsight/issues/23) introduced FinSight
  identity and web sign-in. Its original follow-up summary predates the split below.
- [#25](https://github.com/finsight-org/finsight/issues/25), completed in #29,
  introduced connection records and ownership. Several records may use the same
  provider, including for one user.
- #26 adds live session behavior and persistence.
- [#27](https://github.com/finsight-org/finsight/issues/27) will expose the same
  connection capabilities in the web app.
- [#28](https://github.com/finsight-org/finsight/issues/28) will authorize individual
  AI-agent users and select their connections.

### Decisions made with the user

1. Support one FinSight backend process for simplicity.
2. Reject login attempts for a connection that is already working. The future UI
   will offer reconnect only when needed.
3. Encrypt durable session material in the FinSight backend.
4. Limit additional Supabase coupling because FinSight is open source.

All other choices below are proposed engineering decisions, subject to approval
of this document. They are not additional requirements attributed to the user.

### Goals

- Authenticate an owned record using the existing Wealthsimple password/OTP flow.
- Isolate tokens, cookies, identity, MFA state, refresh and cancellation by record.
- Preserve usable sessions across backend restarts and graceful shutdowns.
- Distinguish a disconnected connection from one requiring reconnection after
  terminal provider authentication failure.
- Enforce ownership before consulting any live session or encrypted snapshot.
- Keep passwords and OTPs within the current request; never persist them.
- Keep persistence replaceable without changing Wealthsimple authentication.

### Non-goals and anti-goals

- No UI, per-user MCP/OAuth authorization, financial-data cache or transaction store.
- No replacement of Supabase Auth or the existing connection-record implementation.
- No Vault dependency, distributed locks, background workers or multiple replicas.
- No automatic key-rotation service or additional storage adapters.
- No database transaction held open while calling Wealthsimple.
- No fallback from a user-owned request to the existing shared local session.
- No claim that a session is durable before its encrypted state is saved.

## Current architecture

`auth.ts` verifies the FinSight bearer token with Supabase. The connection routes
use the caller's token and `provider_connections` RLS to retrieve owned metadata.
Connection IDs, ownership and provider identity are immutable through that API.

`wealthsimpleProvider()` currently creates one memory-only `WealthsimpleClient`
for the private provider HTTP routes. The CLI and private MCP tools reach that
client. The client already implements login/OTP, private cookies, native GraphQL,
read-only document checks at the route boundary, token refresh, cancellation and
protection against late work updating a replacement session.

This PR adds an authenticated connection-scoped path alongside that local path.
The legacy client remains independent and memory-only. It never adopts, lists or
queries a user's persisted session. Its existing private deployment boundary
remains necessary until the separate AI-authorization work is done.

## Approaches

### A. Backend encryption and replaceable session storage — selected

FinSight encrypts a versioned session snapshot using Node's standard cryptography.
A small storage interface saves encrypted material, with an initial adapter using
the existing Supabase database. The provider client and encryption code do not
import Supabase. Operators supply and retain an encryption key.

This keeps ordinary database values portable and avoids requiring a database
encryption extension. The cost is operating the encryption key and maintaining a
small, tested encryption boundary. The user selected this approach after raising
open-source portability as a priority.

### B. Supabase Vault

Vault stores encrypted secrets and provides SQL access to their plaintext. Hosted
Supabase manages project encryption keys. This reduces application cryptography,
but adds extension, SQL privilege and key-management dependencies to deployments.
Vault is open source and can be installed locally; the concern is additional
deployment coupling, rather than requiring the hosted Supabase service.

## Proposed boundaries

Keep three responsibilities distinct:

1. **Authenticated HTTP adapter:** verify the FinSight user, validate the record
   ID and body, and retrieve owned metadata using the existing user-scoped store.
2. **Connection session service:** coordinate the record's client, lifecycle,
   encryption and persistence. This is an internal backend service, reusable by a
   future authorized MCP adapter. It accepts trusted ownership context, never a
   caller-supplied user ID as proof of ownership.
3. **Encrypted session store:** load, replace and remove durable state. Its
   contract uses primitive connection identifiers and encrypted envelopes, with
   no Supabase client, JWT or provider-token types.

Every operation obtains the per-connection execution slot and then checks current
ownership through the request's existing connection store. A missing/invisible
record produces the same 404. Unauthorized requests do not load snapshots,
decrypt data, create clients, wait on another user's queue or call Wealthsimple.
An initial ownership check before queue admission, followed by a check inside the
slot, provides this property without relying on cached ownership.

The authenticated adapter derives the encryption binding from the verified user,
record ID and record provider. The service checks that a cached entry has that
same binding. Provider calls, encryption and storage remain outside the web app.
Future authentication integrations must supply their own verified ownership
adapter; that does not require changing the session lifecycle implementation.

This PR supports Wealthsimple on these routes. Other/historical providers remain
manageable as records; their live operations return a safe unsupported-provider
error. Avoid introducing a general plugin lifecycle framework for one provider.

## Backend API

All routes require the same verified FinSight bearer token as `/api/connections`.
They use the existing exact-origin browser API mechanism, including narrowly
scoped OPTIONS handling, so #27 can consume them without creating a second API.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/connections/:id/session` | `{ "status": "disconnected" / "mfa_required" / "connected" / "expired" }` |
| POST | `/api/connections/:id/session` | Authenticate using `{ email, password, otp? }`; return `connected` or `mfa_required` |
| DELETE | `/api/connections/:id/session` | Disconnect this session, retain the record; return 204 |
| POST | `/api/connections/:id/graphql` | Native read-only GraphQL using this session |

The existing record CRUD response shapes stay unchanged. The existing public
provider documentation remains the source of GraphQL examples; another discovery
endpoint is unnecessary here. Login bodies retain the 16 KiB limit, GraphQL the
1 MiB limit, and upstream responses the existing 8 MiB limit. All session and
financial responses use `Cache-Control: no-store`.

Reject a login on a working session with HTTP 409 and a stable
`CONNECTION_ALREADY_CONNECTED` code. Reject mutations/subscriptions exactly as
the current provider route does, and share validation helpers rather than
maintaining two different GraphQL policies. Financial responses preserve the
upstream status and syntactically valid JSON, including partial data, GraphQL
errors and JSON responses with upstream 5xx status. Recognized authentication
failures still enter the existing refresh/retry or reconnection handling.
Transport failures and non-JSON/malformed responses become sanitized local 502s.

Use safe structured errors consistently: 400 invalid input, 401 missing FinSight
authentication or Wealthsimple authentication failure, 404 invisible/missing
record, 409 lifecycle/provider conflict, 502 upstream transport/provider failure,
and 503 auth/storage/configuration/decryption unavailability. Error codes must
distinguish FinSight authentication from provider authentication. Preserve 413
and 415 for oversized/unsupported request bodies. Session/status and local-error
responses expose no tokens, cookies, provider identity IDs, email addresses or
raw upstream diagnostics; authorized financial query results remain native JSON.
Builder may choose precise new error-code names except the connected conflict.

## Session behavior

### Login and MFA

A new record has no session and reports `disconnected`. Login uses a client owned
exclusively by that record. Each password/OTP submission contains its own
credentials; the service never saves them for a later submission. Preserve the
existing bootstrap/device identifiers and cookies while an OTP challenge is
pending in memory. Preserve the current handling of an ambiguous initial
`invalid_grant`; it does not establish that the password was valid.

A successful login must resolve the provider identity and save the encrypted
snapshot before returning `connected`. Invalid credentials return a safe login
error; the previous disconnected/expired state remains reconnectable.

Pending MFA is transient. A restart requires restarting authentication; the
durable status reverts to disconnected or the previous expired marker. This PR
does not promise to resume an incomplete login after restart.

For a record with a saved/cached connected session, login first checks whether
that session remains usable, without sending the newly submitted credentials.
If valid, return 409. If the provider establishes terminal expiration, persist
the expired state and permit the requested login. A temporary provider outage
returns 502 and does not discard the saved session or start a replacement login.

### Restoration, status and queries

Restore sessions lazily when an authorized request first uses the record. Decode,
authenticate and validate the snapshot before constructing the provider client.
Recreate the private cookie jar as well as the tokens and identifiers.

Add a client operation that validates the token through the existing token-info
endpoint, refreshes once on a recognized authentication failure, and checks that
the returned identity equals the snapshot's identity. Use it for restoration and
connected-status requests. A connected status therefore follows a successful
provider check, rather than merely finding a token in the database. Subsequent
GraphQL calls on the cached client retain the existing refresh-and-retry behavior.

Transient network failures, timeouts, malformed provider responses and login/
token-validation 5xx errors return 502 without labeling the session expired.
GraphQL JSON responses follow the pass-through contract above, including 5xx;
they do not by themselves establish session expiration. Terminal rejected
authentication or an identity mismatch clears live credentials, replaces durable
state with `expired` and reports reconnection required. A status request reports
`expired`; a financial query returns a provider-authentication error. A failure to
save that transition returns 503 and discards the cached client.

After any operation that changes durable session material, including token
rotation or cookies, save a fresh snapshot before returning success or financial
data. Track meaningful snapshot changes so unchanged queries do not force writes.
Do not lose cookie changes when the provider response itself is an error.

### Disconnect, record removal and FinSight sign-out

Disconnect runs in the record's execution slot, clears the runtime client/MFA
state and removes the durable session. It is idempotent for an owned record and
returns 204 only after durable removal succeeds. It does not revoke the remote
Wealthsimple session, matching the current provider behavior.

The existing DELETE-record route participates in the same coordination before
deleting metadata, invalidating any runtime entry as part of that operation.
The database foreign key also deletes durable session state. After a successful
disconnect/removal, previously queued work must reread the resulting state and
cannot restore the former session.

Signing out of FinSight does not disconnect Wealthsimple. Future requests must
authenticate again with FinSight, while the saved provider session survives.

## Concurrency and shutdown

Use one execution queue per connection for login, status, GraphQL, disconnect and
record removal, including snapshot writes. Different connections have independent
queues, including two records belonging to the same user. Serializing operations
on one record is the intentional simplicity tradeoff for this PR; no global lock
may serialize users or hold an open database transaction over provider calls.

This prevents two logins from racing, token rotations from overwriting one
another and a late persistence write from undoing disconnect. Two overlapping
login requests result in the second checking state after the first; if the first
connected successfully, the second receives 409. Existing client guards against
late work remain in place for abort/shutdown handling and the legacy routes.

Disconnect/removal can wait for the record's active operation, which is bounded
by existing upstream and storage timeouts. A query already active can finish
before disconnect succeeds; after the 204, the old session cannot be used.
Requests waiting in the queue observe caller cancellation and do no provider
work if cancelled before admission. Never retain credentials in a long-lived
client, snapshot, queue history or error object after a login request finishes.

On caller cancellation after a provider operation may have changed tokens or
cookies, finish a necessary bounded persistence write under a service-owned
signal before releasing that slot; do not abandon a rotated token simply because
the caller disconnected. Do not return financial data to an aborted caller.

At shutdown stop admitting work, abort provider requests, settle bounded state
writes and clear runtime clients. Capture immutable snapshots before clearing
mutable client state; the current client's `close()` clears credentials, so its
shutdown lifecycle needs to accommodate that ordering. Shutdown never invokes
the user-disconnect operation or deletes saved sessions. Closed/idle client
entries and empty queue entries must be releasable; do not retain every
connection forever in memory.
Builder may choose a modest idle eviction policy that preserves active work and
document its effect on pending MFA. Connected clients can always be reloaded.

## Durable storage and encryption

### Snapshot and encryption format

Use AES-256-GCM through `node:crypto`, a random 32-byte deployment key, a fresh
12-byte nonce for every encryption, and a 16-byte authentication tag. Use a
versioned envelope containing nonce, ciphertext and tag; encode binary fields
strictly. Bind the envelope format, purpose, verified FinSight user ID, connection
ID and provider ID as deterministic associated data. Copying a snapshot onto
another connection/user/provider must fail authentication.

The encrypted payload is a versioned, validated snapshot containing the provider
client/device/session identifiers, access token, refresh token, identity ID and
serialized cookie jar. It contains no password, OTP, FinSight bearer token,
financial query/result or unused login response fields. Bound the plaintext
snapshot to 256 KiB and validate all required fields when restoring it. Only
complete authenticated sessions are exportable as connected snapshots.

Use supported `tough-cookie` serialization/restoration rather than hand-parsing
cookie strings. Keep endpoint configuration application-controlled and retain
the client's existing destination/redirect restrictions.

An unreadable envelope, wrong key, authentication-tag failure or unknown format
returns a sanitized 503. Preserve the stored value for diagnosis/recovery rather
than silently overwriting it or presenting it as ordinary provider expiration.
An explicitly authorized disconnect or record removal can still delete it.

### Storage interface and initial adapter

The storage interface loads an optional durable state, replaces it and removes
it for one connection. Durable state is either connected with an encrypted
envelope or expired with no envelope. No row means disconnected. It never
receives plaintext provider credentials or deals with provider requests.

Add a separate `public.provider_sessions` table with:

- `connection_id`: primary key and foreign key to `provider_connections(id)`,
  `ON DELETE CASCADE`.
- `state`: constrained to connected/expired.
- `encrypted_session`: envelope, required for connected and null for expired.
- `updated_at`: database-managed timestamp on session writes.

The primary key indexes the foreign key; a second index on that same column is
unnecessary. Ownership remains in the existing metadata row rather than being
duplicated into independently mutable session columns. Encryption associated
data binds the trusted owner/provider to the snapshot.

The table is reached through the initial Supabase adapter, but is backend-only:
enable RLS, grant no policies or privileges to `PUBLIC`, `anon` or
`authenticated`, and explicitly grant the required operations to `service_role`.
Never extend the public connection DTO or its column selection with session data.
The adapter uses a dedicated server-only secret-key client, never a client
whose Authorization header can be replaced by an end-user token. The existing
metadata adapter continues using the caller's token and RLS. Check ownership
first on every operation; privileged storage access is not authorization.

Foreign keys prevent a late save from creating a session after its record has
been deleted, including deletion directly through the existing database API.
A direct database deletion does not cancel an already-authorized provider
request; every later operation rechecks the metadata and evicts stale runtime
state. Application-route removal has the stronger serialized 204 guarantee above.

Do not add Vault, plaintext SQL encryption functions or SECURITY DEFINER helpers.
Implementation will create an explicit migration and use the repository's local
Supabase workflow; application startup does not apply migrations.

### Failure and crash semantics

Storage calls have bounded timeouts and no transparent mutation retries. If a
snapshot save has an uncertain/failed outcome, report 503, close/evict the live
client and use durable state on the next attempt. Do not continue serving from
an unsaved new token. Likewise, failed durable removal cannot report a successful
disconnect or deletion; reconcile on the next authorized operation.

Wealthsimple token rotation and a local database write cannot be one atomic
transaction. An abrupt crash after rotation but before persistence, or loss of
the upstream response carrying rotated tokens, can require reconnection if
Wealthsimple rejects the previously saved refresh token. Ordinary
restarts restore sessions whose saved material the provider still accepts. Do
not promise to eliminate this provider-dependent crash window.

## Configuration, operations and portability

Introduce `SUPABASE_SECRET_KEY` for the initial backend session adapter and
`FINSIGHT_SESSION_ENCRYPTION_KEY` for the base64-encoded 32-byte encryption key.
Permit `FINSIGHT_SESSION_ENCRYPTION_KEY_FILE` as an alternative source so Compose
can mount a read-only secret. Exactly one encryption-key source may be present.
Validate key format and complete configuration at startup without printing values.

When both session storage and encryption configuration are absent, preserve the
current Auth/metadata/private-local workflows. Authenticated owned-session routes
then return a clear configuration 503. Partial session configuration fails startup;
enabling it also requires the existing Auth configuration. Tests can inject a
storage implementation and encryption dependency without real Supabase secrets.

Document interactive secret generation, local environment setup, Compose secret
mounting, migration application, restart testing and safe backup/restore. The
key must remain outside the database and images, persist across deployments, and
be backed up separately. Database backups contain encrypted provider sessions.
Replacing/losing the only key makes saved sessions unreadable; recovery requires
the original key or explicitly disconnecting and authenticating affected records
again. Automated re-encryption/key rotation is follow-up work.

No secret key enters `VITE_*`, frontend build arguments, checked-in configuration,
request logs, stack traces or API responses. Keep existing response sanitization,
disabled automatic request logging and upstream bounds.

This reduces new coupling. Supabase Auth, PostgREST and metadata RLS remain
existing dependencies; this PR does not claim plain PostgreSQL is a fully
supported standalone deployment. Future storage adapters can retain the encrypted
format and backend session service without depending on Vault.

## Verification required during implementation

Use synthetic Wealthsimple endpoints and controlled overlap barriers rather than
real accounts in routine tests. Extend the existing test runner and local
integration setup; no additional test framework is needed.

- Two users, plus two same-provider records owned by one user, have distinct
  provider identities, tokens, cookies, MFA state and lifecycle behavior.
- Requests with missing/invalid auth or another user's ID never reach live or
  encrypted session state; ownership checks precede every operation.
- Login/OTP succeeds; failed credentials are retryable; working-session login is
  rejected, including two overlapping requests. Expired sessions can reconnect.
- Session snapshots restore into a fresh backend/service and query successfully;
  refreshed tokens and changed cookies survive a subsequent restart.
- Temporary provider failures preserve sessions; terminal failure persists
  expired status; wrong keys/corrupt envelopes fail safely without destructive
  writes. Ciphertext copied between bindings fails to decrypt.
- Disconnect A while B is querying leaves B usable. Same-record overlapping
  login/query/disconnect/removal cannot restore the old session after a successful
  disconnect/removal. A fresh login ordered after disconnect can authenticate
  the retained record. Caller abort and shutdown do not delete saved sessions.
- Simulated persistence failure after login/refresh does not report success or
  serve from unpersisted state. A dropped caller still permits the required
  bounded token-rotation save.
- Direct anonymous/authenticated database access cannot read or mutate session
  rows; metadata/user deletion cascades correctly. Inspect stored values for
  absence of plaintext tokens, cookies, passwords and OTPs.
- Run real local Supabase tests with two verified users and the real persistence
  adapter. Restart the backend against the same database/key; include a retained-
  volume database restart in the documented full acceptance run.
- Existing provider, CLI, MCP, Auth and connection-record tests remain passing;
  adjust the PR 2 test that deliberately asserted no scoped GraphQL route exists.
- Run root tests, typecheck and build, plus the relevant local integration suite
  and Compose configuration validation. A real-account login/MFA smoke test is
  separate and requires an available account; do not claim one from synthetic tests.

## Left to the builder

Choose exact module/file names, the minimal snapshot-change mechanism, queue
implementation/idle eviction details and safe new error-code names. Preserve the
boundaries, API behavior, security properties and failure semantics above. Add
only dependencies that prove necessary; existing Node crypto, Supabase SDK,
cookie library and test tooling cover the proposed approach.

## References consulted

- [Node 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Vault](https://supabase.com/docs/guides/database/vault)
- [Vault source and installation](https://github.com/supabase/vault)

## Approval

The builder check returned two response-contract questions. Both were settled
from the existing provider behavior: session/local-error responses are sanitized,
and native GraphQL JSON retains its upstream fields and HTTP status, including
5xx responses, except when recognized authentication failures require handling.

Pending user review. Implementation and implementation planning begin only after
this document is approved.
