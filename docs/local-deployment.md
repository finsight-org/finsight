# Local deployment and private MCP

Run one Finsight process and an optional OpenAI tunnel client. Provider sessions
stay in memory. This setup is for one trusted user on a trusted computer.
It does not publish an internet-facing Finsight endpoint.

## Start Finsight

Install and start a Docker runtime with Docker Compose v2. Node.js 24 and npm
are needed only for host development and automated tests. If your installation
exposes Compose as `docker-compose`, substitute it for `docker compose` below.

```sh
docker compose up -d --build --wait finsight
curl --fail http://127.0.0.1:4000/healthz
docker compose exec finsight node dist/cli/wealthsimple.js status
```

Only `127.0.0.1:4000` is published. The dedicated bridge network permits outbound
HTTPS to providers and OpenAI. No database, persistent session volume, reverse
proxy, or Docker socket mount is required. A disconnected provider is healthy.
Finsight runs as a non-root user with a read-only filesystem, production
dependencies, compiled code, and all nine GraphQL reference documents.

## Connect manually

```sh
docker compose exec finsight node dist/cli/wealthsimple.js login
docker compose exec finsight node dist/cli/wealthsimple.js status
docker compose exec finsight node dist/cli/wealthsimple.js disconnect
```

Keep the default interactive TTY for login; do not use `exec -T` for that command.
The helper prompts for email and a hidden password. If necessary, it prompts
once for a hidden OTP and completes login sequentially. Failures exit nonzero
without retrying or printing provider diagnostics. Ctrl-C cancels and restores
the terminal. Passwords and OTPs cannot be provided as arguments.

For host development:

```sh
npm ci
npm run dev
# In another terminal:
npm run wealthsimple -- login
npm run wealthsimple -- status
# Any helper command accepts --url with a trusted HTTP(S) server origin:
npm run wealthsimple -- login --url http://127.0.0.1:4001
```

The helper defaults to `http://127.0.0.1:4000`, including inside the container.
If you change the server's port outside Compose, pass `--url`. Never paste
credentials or OTPs into ChatGPT. Provider tokens and cookies exist only in
Finsight's memory. Restarting/rebuilding Finsight requires another login;
restarting just the tunnel client does not.

## Configure the private tunnel

Follow [OpenAI's Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
to create a tunnel associated with the intended Platform organization and
ChatGPT workspace. Creation requires Tunnels Read + Manage; runtime and connector
use require Read + Use. Create a restricted runtime API key, not an admin key.
Only the tunnel client needs that key.

Copy `.env.example` to `.env` and set `CONTROL_PLANE_TUNNEL_ID` to the actual
identifier. This is non-secret configuration. Store the runtime key in the
ignored `.secrets/openai_tunnel_key` file. For example, this prompts locally
without placing the key in arguments, shell history, or an environment:

```sh
mkdir -p .secrets
chmod 700 .secrets
python3 - <<'PY'
import getpass, os
key = getpass.getpass("OpenAI restricted tunnel runtime key: ").strip()
if not key:
    raise SystemExit("No key supplied.")
fd = os.open(".secrets/openai_tunnel_key", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.fchmod(fd, 0o600)
with os.fdopen(fd, "w") as secret:
    secret.write(key)
PY
```

Compose mounts the file only into the tunnel container. It is not included in
the image or forwarded to Finsight. File-backed Compose secrets are not an
encrypted vault; protect the host file. The Docker build context uses an
allowlist to exclude environment files, secrets, tests, and local artifacts.

The official multi-architecture tunnel image is pinned to the OCI digest for
v0.0.17. To update it, select a stable release from
[OpenAI's releases](https://github.com/openai/tunnel-client/releases/latest),
resolve its published image digest, and update the version comment and image
reference together. Do not silently switch to `latest`.

```sh
docker compose --profile tunnel up -d --wait
docker compose --profile tunnel exec tunnel-client \
  /usr/bin/tunnel-client doctor \
  --control-plane.api-key=file:/run/secrets/openai_tunnel_key --explain
docker compose --profile tunnel exec tunnel-client \
  wget -q -O - http://127.0.0.1:8080/readyz
docker compose --profile tunnel logs --tail=50 tunnel-client
```

The image's entrypoint already includes `run`; Compose supplies only the secret
reference flag. It connects to `http://finsight:4000/mcp`. Keep raw HTTP logging
disabled. Tunnel health and admin endpoints remain inside the container;
no tunnel port is published.

In ChatGPT on the web, add a custom MCP server, select **Tunnel**, choose the
same tunnel ID, and select **No authentication**. Install the resulting private
connection and select it in a conversation. Workspace permissions still apply.
Do not share this connection: every authorized caller reaches the same session.
Requests and returned financial data travel through OpenAI even though Finsight
does not have a public listener.

## Verify end to end

Before login, use ChatGPT to:

1. Call `list_providers`.
2. Call `describe_provider_graphql` with `providerId: "wealthsimple"`.
3. Construct a small query using the references and call
   `query_provider_graphql`. Expect a tool error with HTTP status 401.

Complete login in your terminal, then repeat the small query. Compare the result
with the same request sent directly to Finsight. Use native operation names,
variables, and cursors. Reference filenames are not executable operation IDs.
There are no MCP login, status, disconnect, arbitrary HTTP, or trading tools.
Provider routes remain responsible for rejecting mutations and subscriptions.

Tool text is JSON with `statusCode` and `body`; body is the exact provider
response text, so parse it separately when it is JSON. HTTP-200 partial GraphQL
errors remain successful transport responses. Other HTTP statuses set
`isError: true`. Requests are capped at 1 MiB including the MCP envelope;
provider response bodies at 8 MiB; bridge calls at 95 seconds total.

Cancellation closes the active loopback request. Modern MCP clients cancel their
HTTP exchange automatically. Legacy stateless clients must close the outstanding
HTTP exchange as well: a separate cancellation notification cannot identify an
exchange across fresh stateless instances. No global request-ID map or MCP
session store is maintained.

After disconnecting, queries must return 401. After reconnecting, restart only
`tunnel-client` and confirm reads still work. Restart Finsight and confirm reads
need login again. Health should stay green while disconnected.

```sh
docker compose --profile tunnel restart tunnel-client
docker compose restart finsight
docker compose --profile tunnel down
```

## Automated checks

```sh
npm ci
npm test
npm run typecheck
npm run build
docker compose --profile tunnel config --quiet
docker compose build finsight
```

Tests use SDK clients, two synthetic providers, and synthetic Wealthsimple
responses. They cover discovery, route parity, bounds, cancellation, shared
refresh, shutdown, and terminal-helper flows without real account access.
Live ChatGPT/tunnel/account validation is separate and requires your runtime
key, account permissions, and interactive login. Do not commit account data
or turn real responses into test fixtures.
