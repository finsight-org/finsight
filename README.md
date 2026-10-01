# FinSight

Open-source financial connectors for AI agents.

FinSight gives agents read-only access to financial providers. Providers retain
their own data models; agents handle reasoning and analysis. The first provider
is Wealthsimple, using an **experimental, unofficial API** that may change.

## Development

Requires Go 1.27.0 or newer. The root command is the bootstrap entry point:

```sh
go run .
```

### Connect to Wealthsimple and view accounts

Run the development CLI in your terminal:

```sh
go run ./cmd/wsdev accounts
# Or return structured account data:
go run ./cmd/wsdev accounts --json
```

Enter your email, password, and MFA code when prompted. Passwords and MFA codes
are hidden. Prompts and errors go to stderr; results go to stdout. Credentials
are not accepted through command arguments or saved to disk. The unofficial
login flow can report the same challenge for invalid credentials and MFA, so
the CLI prompts for a code at most once before reporting a failed login.

Each invocation creates a new connection and signs in again. Access tokens,
refresh tokens, and cookies stay in process memory and disappear when it exits.
There is no session file, keychain integration, or financial data cache.

Results include open accounts, provider account types, IDs, and current balances:

- Investment and cash accounts use Wealthsimple's current net liquidation value.
  This is the account value, not buying power or available cash.
- Credit cards use the current amount owed when Wealthsimple supplies it.
- Amounts remain decimal strings, with their reported currency. FinSight does
  not convert currencies or add balances together.
- Missing balances are `null` in JSON and `unavailable` in the table. Partial
  results include warnings and return a nonzero exit status.

The CLI exits with status 0 on success, 1 on a failed or incomplete request,
and 2 on invalid arguments. When using `go run`, Go wraps a nonzero program exit;
build the CLI if a script needs the exact exit status.

### Session refresh

The provider refreshes tokens on demand when an authenticated read returns an
expired-session response. It rotates both tokens and retries the read once.
Concurrent reads share one refresh attempt for the expired token. Network
failures and rate limits do not trigger repeated login or refresh attempts.
If the refresh token is rejected, a new login is required.

Refresh happens while the process is alive and making requests; there is no
background keep-alive. Provider expiry or revocation can still require login.

### Components

```text
cmd/wsdev/main.go                   Terminal prompts and account output
main.go                             Local API server entry point
internal/server/                    Bearer auth and connection lifecycle
internal/gateway/                   Gateway schema and executor
internal/wealthsimple/schema.graphqls  Public provider schema
internal/wealthsimple/
  client.go                        HTTP transport and authenticated requests
  auth.go                          Login, MFA, public configuration discovery, refresh
  session.go                       Private in-memory session state
  accounts.go                      Account pagination and balance mapping
  types.go                         Provider result types and safe errors
  queries/accounts.graphql         Read query sent to Wealthsimple
  generated/                       gqlgen provider execution
```

The CLI and local API both call the provider directly. The provider has no
terminal, gateway, or MCP dependency. Its embedded account query targets
Wealthsimple's upstream GraphQL API; the checked-in provider schema describes
FinSight's separate read-only GraphQL interface.

### Local API server

The local API is a single-user, in-memory service. It listens on
`127.0.0.1:8080` by default, accepts JSON POST requests, and requires a bearer
token on every route. The optional `--addr` flag only accepts a loopback IP and
a valid port. It has no browser CORS access. Restarting the process discards
the Wealthsimple session. Disconnect locally before another login;
disconnecting does not claim to revoke the provider's remote session.

Generate a token in your shell and start the server. The generated token value
is not part of the command history:

```sh
export FINSIGHT_API_TOKEN="$(openssl rand -hex 32)"
go run . serve
```

If the default port is already in use, choose another loopback port:

```sh
go run . serve --addr 127.0.0.1:8081
```

Connect with `POST /connections/wealthsimple/login` and JSON fields `email`,
`password`, and optional `mfaCode`. The first login can return
`{"status":"mfa_required"}`; send the same email, password, and MFA code to
complete it. The pending challenge lasts five minutes and does not retain the
password or MFA code. A connected session stays in memory until disconnect or
process exit.

Use a local client that reads the token from the environment and prompts for
the provider password instead of putting credentials in command arguments or
request literals in shell history. For example, this Python snippet prompts
interactively and keeps the password out of the source file and shell command:

```python
import getpass, json, os, urllib.request

token = os.environ["FINSIGHT_API_TOKEN"]
email = input("Wealthsimple email: ")
password = getpass.getpass("Wealthsimple password: ")

def post(path, payload):
    request = urllib.request.Request(
        "http://127.0.0.1:8080" + path,
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)

result = post("/connections/wealthsimple/login",
              {"email": email, "password": password})
if result["status"] == "mfa_required":
    result = post("/connections/wealthsimple/login", {
        "email": email, "password": password,
        "mfaCode": getpass.getpass("MFA code: "),
    })
password = ""
```

`POST /graphql` accepts `{ "query", "variables", "operationName" }`. The
gateway schema exposes `connectedProviders`, `providerSchema(provider:)`, and
`executeProviderQuery(provider:, query:, variables:, operationName:)`. Provider
queries run in-process against the checked-in Wealthsimple schema. Account
amounts are exact decimal strings. `DELETE /connections/wealthsimple` clears
the local session and returns 204; account reads can discover provider revocation
and require a new login. The API has 256 KiB request and 64 KiB query limits,
60 second request deadlines, and a GraphQL complexity limit of 1000.

The gateway accepts authenticated GraphQL introspection. These three requests
show provider discovery, schema retrieval, and an account read:

```graphql
{ connectedProviders { id name } }
```

```graphql
{ providerSchema(provider: "wealthsimple") }
```

```graphql
query AccountRead($providerQuery: String!) {
  executeProviderQuery(provider: "wealthsimple", query: $providerQuery) {
    data
    errors { message path extensions }
  }
}
```

Send the third query with variables:

```json
{
  "providerQuery": "{ accounts { accounts { id name type currency balanceKind balance { amount currency } } warnings { accountId code message } } }"
}
```

Do not expose this single-user server to a network or use it for multiple
people. It has no hosted authentication, persistence, or multi-user isolation.

### Verify

```sh
go test -race ./... -timeout=60s
go vet ./...
go build ./...
```

Automated tests use local mock servers and synthetic financial data. They cover
login/MFA, refresh and token rotation, concurrent reads, account pagination,
decimal precision, partial responses, cancellation, and CLI output. To check
your real account, run the development CLI interactively. Do not put credentials,
tokens, or account output in bug reports.

Regenerate the checked-in gqlgen files with the pinned `v0.17.95` generator:

```sh
go run github.com/99designs/gqlgen generate --config internal/wealthsimple/gqlgen.yml
```

```sh
go run github.com/99designs/gqlgen generate --config internal/gateway/gqlgen.yml
```

The provider uses the API behavior documented by
[ws-api-python](https://github.com/gboudreau/ws-api-python) as a reference, with
an independent Go implementation. No financial write operations are exposed.

## License

Apache 2.0. See [LICENSE](LICENSE).
