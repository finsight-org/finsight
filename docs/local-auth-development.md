# Local identity development

PR 1 uses one Supabase Auth project for the React application and the Fastify
backend. Users live in Supabase's built-in `auth.users`. PR 2 adds the
`public.provider_connections` table and its ownership policies through a tracked
migration. Encrypted provider sessions use `public.provider_sessions`, accessible
only through the backend privileged adapter. ChatGPT OAuth remains follow-up work.

## Start local Supabase

Use Node.js 24, npm, and a running Docker-compatible runtime. The repository pins
Supabase CLI 3.0.0 as a development dependency. From the repository root:

```sh
npm ci
npm run supabase:start
```

The tracked `supabase/config.toml` initializes project `finsight`, PostgreSQL 17,
Auth, its API gateway, and a local Mailpit inbox. Email confirmation is enabled.
No hosted Supabase project or access token is required. First startup downloads
the service images. The startup helper creates/verifies bridge
`finsight-supabase-local` with Docker's loopback binding option, starts the CLI
on that network, and verifies actual API/database/mail port bindings. It
recreates only this Supabase project's containers if an earlier start used
all-interface bindings; data volumes are preserved. An unsafe existing network
fails closed. Other Docker workloads are not stopped.
This follows [Supabase's local network guidance](https://supabase.com/docs/guides/local-development).

Inspect the installed commands before using additional flags:

```sh
npx supabase --help
npx supabase status --help
npx supabase db query --help
```

The CLI's complete status contains local secrets. Store it in an ignored file
and retrieve only the public fields needed by the applications:

```sh
mkdir -p .secrets
chmod 700 .secrets
npm run --silent supabase:status -- --output json > .secrets/supabase-status.json
npx supabase db query --read-only "select to_regclass('auth.users')"
```

Expect `auth.users`. The API is at `http://127.0.0.1:54321`; the mail viewer is
at `http://127.0.0.1:54324`. The pinned CLI's status identifies the public API URL
and publishable key. Use the `sb_publishable_…` key, never a secret/service-role
key. Keep status files, credentials, local `.env` files, and signing keys out of
Git and Docker build contexts.

```sh
npm run supabase:stop
npm run supabase:start
```

Stop affects this project's Supabase containers and preserves its data volumes.
Restart resumes the same local project. Do not use `stop --all`, Docker prune,
or `stop --no-backup` for ordinary development. Delete only disposable users
created for this project when cleaning up acceptance data; do not delete other
projects or real account records.

## Application configuration

Copy root `.env.example` to ignored `.env`. Host development uses
`SUPABASE_URL=http://127.0.0.1:54321`, the local publishable key, and
`WEB_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:8080`.
For local backend containers, include `compose.local-auth.yaml`; it attaches
only FinSight to the private Auth bridge and uses
`http://supabase_kong_finsight:8000`. Browser and host development still use
loopback. This avoids routing through a host-published port from Linux containers.
The default Compose file remains independent of local Supabase.

The frontend's `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and
`VITE_FINSIGHT_API_URL` are public build-time values. They use the browser-facing
URLs, not Docker service names. Canonical frontend URLs are
`http://127.0.0.1:5173` for Vite and `http://127.0.0.1:8080` for the built UI.
The exact `/auth/callback` URL for each is allowlisted in local Supabase config.
Use the same hostname throughout signup and confirmation so the browser's PKCE
verifier remains available.

Leave all backend Auth values blank to retain legacy backend-only operation.
Partial Auth configuration is invalid. Supabase login does not authenticate the
existing provider/MCP routes, which retain their trusted local session model.

## Acceptance

Implementation acceptance requires the real local Supabase stack, built frontend
and backend containers, and the full Playwright UI flow. Capture and visually
review registration, the real local confirmation email, confirmed home, failed
and successful sign-in, restored session after reload, sign-out after reload,
and registration with confirmation temporarily disabled. Restore confirmation
after that check. Unit tests or a hosted project do not substitute for this run.

Keep screenshots and the actual validation report in ignored
`output/playwright/pr1-auth/`. Use disposable local identities and omit passwords,
tokens, confirmation codes, and token-bearing URLs from shared evidence.

For host backend development, copy `.env.example` to `.env`, fill the public
Auth values, and run `npm run dev`. Node loads that ignored file explicitly.
`npm start` runs the compiled backend with the same optional environment file.
`GET /api/me` requires a user bearer token; missing/invalid credentials return
401, unavailable Auth returns 503, and unconfigured legacy operation returns
`AUTH_NOT_CONFIGURED` without disabling the existing provider or MCP service.

## Run and check the independent frontend

```sh
npm --prefix web ci
cp web/.env.example web/.env
# Fill the three public values in web/.env from the same local project.
npm run dev
# In a second terminal:
npm --prefix web run dev
```

Open `http://127.0.0.1:5173`. The browser session is not trusted as backend
identity until `/api/me` verifies it. Auth and refresh outages permit retry without deleting
the session; a rejected session returns to sign-in. Sign-out affects the local
FinSight browser session and does not instantly revoke already issued tokens.

```sh
npm test
npm run typecheck
npm run build
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
```

Production frontend builds reject missing or privileged Auth key configuration
before bundling. The frontend accepts only publishable keys.

## Build and run separate containers

Fill root `.env` with the public values from `.secrets/supabase-status.json`:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_DOCKER_URL=http://host.docker.internal:54321
SUPABASE_PUBLISHABLE_KEY=<local publishable key>
WEB_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:8080
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<same local publishable key>
VITE_FINSIGHT_API_URL=http://127.0.0.1:4000
FINSIGHT_PORT=4000
```

```sh
npm run supabase:start
docker compose -f compose.yaml -f compose.local-auth.yaml --profile web config --quiet
docker compose -f compose.yaml -f compose.local-auth.yaml --profile web build finsight web
docker compose -f compose.yaml -f compose.local-auth.yaml --profile web up -d --wait finsight web
```

Open `http://127.0.0.1:8080`. `web` is a separate non-root static-server container;
its `/auth/callback` path falls back to the React application. It publishes only
on host loopback. API and frontend use independent build contexts; neither copies
local environment/status files or the other project's dependencies. Frontend
access logging is disabled because confirmation callback URLs contain codes.

The local Auth override is required for the documented local container flow:
it joins the loopback-publishing Supabase bridge without opening database or mail
ports to other hosts. The browser continues to use `127.0.0.1`; it cannot use
Docker service names. Verify both routes reach the same local project. Changing any Vite value requires rebuilding
the web image, not merely restarting it.

To coexist with an existing FinSight instance, set `FINSIGHT_PORT=4001` and
`VITE_FINSIGHT_API_URL=http://127.0.0.1:4001` in this checkout's `.env`, and add
`-p finsight-pr1` to every Compose command. This isolates the application's
containers/network and preserves an existing service on port 4000. Stop a host
development server on port 4001 before starting that container. The frontend
still uses port 8080 and the same callback allowlist.

```sh
docker compose -p finsight-pr1 -f compose.yaml -f compose.local-auth.yaml --profile web up -d --build --wait finsight web
docker compose -p finsight-pr1 -f compose.yaml -f compose.local-auth.yaml --profile web down
```

The optional `tunnel` profile remains dedicated to the trusted private MCP
endpoint. Keep its existing secret file/configuration separate. Neither frontend
sign-in nor enabling the web profile turns that endpoint into a public multi-user
service. Do not deploy this combination as public financial-account access until
authenticated per-user MCP authorization is delivered. Scoped API sessions are
isolated; the shared MCP session remains independent.

## Hosted Auth configuration

For hosted Auth, omit `compose.local-auth.yaml`. For development with a hosted Supabase project, enable email/password sign-in,
set its Auth site URL, and allowlist the exact frontend `/auth/callback` URLs.
Use the project's HTTPS API URL for both `SUPABASE_URL` and
`SUPABASE_DOCKER_URL`; use that same URL for `VITE_SUPABASE_URL`. Copy only its
publishable key into the two public key settings. Built-in `auth.users` is
sufficient; do not create a second users table or run a financial-data migration.
Configure confirmation email delivery/SMTP for the hosted environment as needed.
See [Supabase's email setup](https://supabase.com/docs/guides/auth/passwords).
Hosted Auth is optional and does not replace the required local acceptance run.

## Required Playwright acceptance sequence

Use the Playwright CLI to drive a clean browser against the built UI on port
8080, with the real local backend and Supabase. Take a fresh snapshot before
using element references and after navigation. Do not mock authentication or
preload an authenticated storage state.

1. Register a unique disposable local user through the UI. Capture the signed-out
   screen and the confirmation-required message.
2. Open Mailpit in another tab in the same browser context, open that actual
   user's confirmation email, and follow the link. Capture the readable HTML
   email without exposing its link URL/code. Confirm `/api/me` succeeds and
   capture the verified home after callback parameters have been removed.
3. Sign out, try a wrong password, then sign in correctly. Capture the rejected
   and successful sign-in states. Reload and capture the restored verified home.
4. Sign out and reload; capture the signed-out screen. A separate browser fetch
   without a bearer header must receive 401 from `/api/me`.
5. Temporarily change only `[auth.email].enable_confirmations` to `false`, stop
   and restart this Supabase project, and register another unique user in a fresh
   browser context. Capture its immediate verified home. Restore `true` and
   restart again before finishing.

Visually inspect all nine screenshots and record actual API statuses, revision,
service/CLI versions, exact setup overrides, and test results in
`output/playwright/pr1-auth/validation.md`. Keep screenshots and all Playwright
runtime state ignored. Do not include credential headers, passwords, token
responses, or confirmation-code values in the report. A required step that
cannot run leaves implementation validation incomplete.

SDK restoration owns its initial result: a transient refresh error is retryable
even when the SDK emits an initial null session. Confirmation callbacks require
the SDK to consume the code; recovery of a previously signed-in account does not
count as confirmation. If local sign-out succeeds but the remote logout fails,
the UI reports both facts. A production asset regression also checks that
unrelated `VITE_` environment values never enter the browser bundle.

## Connection record integration tests

After `npm run supabase:start`, apply the additive migration with the pinned CLI:

```sh
npx supabase migration up --help
npx supabase migration up
npx supabase migration list
npx supabase db advisors --type security
```

CLI 3 targets the local project by default. Do not reset an existing database or
remove its volumes. Migration application preserves existing Auth identities.
No application startup migration runs. Connection metadata uses user JWTs and
the publishable key; enabling durable sessions additionally requires the backend
Supabase secret key and a deployment encryption key.

Backend tests remain independent of external services. For actual database tests,
set `FINSIGHT_TEST_SUPABASE_URL`, `FINSIGHT_TEST_SUPABASE_PUBLISHABLE_KEY`, and
`FINSIGHT_TEST_SUPABASE_SECRET_KEY` from the ignored local status JSON. The secret
key creates/cleans up disposable test identities, seeds ordering fixtures, and
accesses backend-only encrypted session rows in session acceptance. The fixture
refuses hosted URLs; metadata application requests use user JWTs and the
publishable key, while the session adapter alone uses the privileged key.
Never print keys or put them in shell arguments.

```sh
npm run build
npm run test:connections:integration
# Full acceptance also stops/starts this local project, preserving its volumes:
FINSIGHT_TEST_RESTART_SUPABASE=1 npm run test:connections:integration
```

Without the restart flag the restart subtest is skipped and full acceptance is
incomplete. The suite creates two confirmed disposable users, checks direct Data
API restrictions and compiled-backend CRUD, restores sessions, restarts its own
backend, and optionally restarts local Supabase. It deletes only its own users.
Existing services using the local Supabase project briefly lose Auth/database
access during the opt-in stop/start test.

For manual calls, save the user access token in a mode-0600 ignored file such as
`.secrets/user-token` using interactive input. This example reads it without
putting its value in command arguments or output:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const token = readFileSync('.secrets/user-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:4000/api/connections', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ providerId: 'wealthsimple', label: 'Personal' }),
});
console.log(response.status, await response.json());
JS
```

Only connection metadata is returned. Use the scoped session API below to log
in to Wealthsimple; browser management and per-user agent authorization remain
separate work.

## Provider session integration tests

Apply the tracked additive migrations and run `npm run build` first. Both
integration scripts execute built backend modules; the session child runs with
Node's existing tsx import hook and receives synthetic endpoint origins over
private IPC. No real Wealthsimple account is used. Load the ignored local status
file directly into the subprocess environment; do not export or print its keys:

```sh
npm run build
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const status = JSON.parse(readFileSync('.secrets/supabase-status.json', 'utf8'));
const env = { ...process.env,
  FINSIGHT_TEST_SUPABASE_URL: status.API_URL,
  FINSIGHT_TEST_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  FINSIGHT_TEST_SUPABASE_SECRET_KEY: status.SECRET_KEY,
};
for (const script of ['test:connections:integration', 'test:sessions:integration']) {
  const result = spawnSync('npm', ['run', script], { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
// This briefly interrupts all consumers of the local project. Keep its volumes.
const result = spawnSync('npm', ['run', 'test:sessions:integration'], {
  env: { ...env, FINSIGHT_TEST_RESTART_SUPABASE: '1' }, stdio: 'inherit',
});
process.exit(result.status ?? 1);
JS
```

The full run must include the retained-volume Supabase restart without a skipped
restart case. It signs fixture users in again, restarts the backend with the same
key, and checks A1/A2/B1 isolation, refreshed tokens/cookies, encrypted rows,
privileged-table denial, expiration/reconnection, sign-out preservation and
cascades. A separate SIGTERM test blocks an abort-aware upstream request and
requires an IPC signal barrier, exit code 0 within 10 seconds, preserved storage
and a successful query after restarting. Ordinary runs skip only the optional
database interruption. A real-account smoke test is separate and needs an
authorized interactive login.

## Scoped provider session API

Use an owned connection ID and your FinSight access token (the existing browser
login supplies that token). Store manual credentials only in mode-0600 ignored
files under mode-0700 `.secrets`; never pass them as shell arguments. This Node
example reads `.secrets/user-token`, `.secrets/ws-email` and `.secrets/ws-password`,
and reads an optional OTP from `.secrets/ws-otp`. The file-based example
resubmits all credentials when completing MFA.
Create `.secrets/ws-otp` locally only when a current challenge requires it; remove
it and the password file when finished. The script prints statuses, never tokens,
credentials or financial results.

```sh
node --input-type=module <<'JS'
import { readFileSync, existsSync } from 'node:fs';
const read = name => readFileSync(`.secrets/${name}`, 'utf8').replace(/\r?\n$/, '');
const base = 'http://127.0.0.1:4000';
const id = read('connection-id'); // UUID of a record you own
const headers = { Authorization: `Bearer ${read('user-token')}`, 'Content-Type': 'application/json' };
async function call(path, method = 'GET', body) {
  return fetch(`${base}/api/connections/${id}${path}`, { method, headers,
    redirect: 'error', body: body === undefined ? undefined : JSON.stringify(body) });
}
const input = { email: read('ws-email'), password: read('ws-password') };
let response = await call('/session', 'POST', input);
let state = await response.json();
if (state.status === 'mfa_required' && existsSync('.secrets/ws-otp')) {
  response = await call('/session', 'POST', { ...input, otp: read('ws-otp') });
  state = await response.json();
}
console.log('Login HTTP', response.status, 'state', state.status ?? state.error?.code);
if (state.status === 'connected') {
  const query = 'query Accounts($identityId: ID!) { identity(id: $identityId) { id } }';
  const result = await call('/graphql', 'POST', { query });
  console.log('GraphQL HTTP', result.status); // Read result locally; contains account data.
  await result.body?.cancel();
}
// To disconnect this provider session while retaining metadata:
// console.log('Disconnect HTTP', (await call('/session', 'DELETE')).status);
JS
```

If the first request needs MFA and no OTP file exists, save the current OTP
locally, then rerun while the challenge is pending. No password or OTP is retained
server-side; always resubmit both credentials. Cache eviction after 15 minutes
idle, cache pressure and process restart discard pending MFA and require starting
the login again. The existing `npm run wealthsimple -- login` interactive command
has hidden password/OTP prompts for the shared local/MCP session only.
