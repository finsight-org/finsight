# FinSight MCP over HTTPS

The HTTPS deployment serves the FinSight web app and authenticated MCP at one
origin. Each OAuth grant lets its client discover and query the consenting
user's current and future provider connections. Wealthsimple sign-in and MFA
take place in the FinSight web app.

## Configure the deployment

1. Point a public DNS hostname at the Compose host and make TCP ports 80 and
   443 reachable so Caddy can obtain and serve a certificate. Use the canonical
   HTTPS URL of the Supabase project.
2. Apply the FinSight migrations to that project. Enable the Supabase
   [OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
   with the authorization path `/oauth/consent` and dynamic client registration
   disabled. Set the Auth Site URL to the FinSight HTTPS origin and allowlist
   its exact `/auth/callback` URL for FinSight email confirmation. Configure
   an asymmetric Auth signing key for OpenID Connect. Verify the hosted
   account-management restriction below before handing out connector access.
3. Configure the
   [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
   to use Postgres function `finsight_private.mcp_access_token_hook`. If another
   token hook is already active, compose its logic with this hook before
   switching. The hook binds dedicated OAuth clients to their configured resource
   while retaining Supabase's primary audience for the user-scoped Data API.
4. Create a confidential OAuth client for each ChatGPT connector installation
   that needs a distinct callback. In [ChatGPT's custom MCP server settings](https://developers.openai.com/api/docs/guides/custom-mcp-server),
   choose HTTPS, enter the FinSight `/mcp` URL, and select OAuth with predefined
   credentials. Copy the exact callback URI displayed for that installation into
   the Supabase client allowlist. Choose `client_secret_basic` for the token
   endpoint and store the issued client secret in ChatGPT's credentials field.
   Use a dedicated registration with the exact callback URI for each additional
   compatible MCP client.
5. For each registered client, insert its exact UUID and the canonical MCP URL
   as a project database administrator. Replace the example values below.

   ```sql
   insert into finsight_private.mcp_oauth_clients (client_id, resource)
   values ('00000000-0000-4000-8000-000000000001', 'https://finsight.example.com/mcp');
   ```

6. Set `FINSIGHT_PUBLIC_HOST`, `SUPABASE_DOCKER_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and
   `VITE_FINSIGHT_MCP_CLIENT_IDS` in the deployment environment. The last
   value is the comma-separated set of client UUIDs inserted above. Store the
   encryption key at `.secrets/finsight_session_key` using the
   [session setup procedure](local-deployment.md#durable-user-owned-sessions).
   Preserve the matching key if the database already contains encrypted
   sessions.
7. Run one FinSight backend per Supabase project and encryption key. If a
   backend already manages those encrypted sessions, stop it before starting
   the HTTPS project. For rollback, stop the HTTPS project before restarting
   the previous backend with the same key.

```sh
docker compose -p finsight-https -f compose.yaml -f compose.sessions.yaml -f compose.https.yaml config --quiet
docker compose -p finsight-https -f compose.yaml -f compose.sessions.yaml -f compose.https.yaml up -d --build --wait
```

Caddy exposes the HTTPS origin. The server also publishes protected resource
metadata at `/.well-known/oauth-protected-resource/mcp`. A request to `/mcp`
without a token should return `401` with a Bearer challenge. The OAuth
authorization server uses Supabase's project origin. The dedicated client
registration and hook provide a fixed MCP audience per client while Supabase's
[native resource binding](https://github.com/supabase/auth/pull/2894) is pending.

## Pilot acceptance

1. In the hosted project, use an OAuth token issued for a disposable test
   account to confirm that Supabase Auth rejects account changes on
   `PUT /auth/v1/user`. Use a release that restricts delegated tokens to OAuth
   operations. See [the Supabase Auth change](https://github.com/supabase/auth/pull/2898).
2. With two distinct FinSight accounts and two ChatGPT accounts with access to
   the custom MCP connector, create and connect one labeled Wealthsimple
   connection per FinSight user. Create a second labeled connection on one
   account to exercise selection.
3. Install or open the connector in each ChatGPT account and sign in to the
   matching FinSight account. Confirm the account shown, then allow read access. Use `list_connections` and query a known account balance through the
   appropriate connection on both accounts.
4. Repeat a read with the other user's connection UUID and then with a
   nonexistent UUID. Both calls should return `Connection not found.`
5. In the first FinSight account, revoke ChatGPT under **Agent access**. Verify
   that the next tool call requires authorization and the other account can
   still query. Verify that the first FinSight account can still use its
   Wealthsimple connection from the web app.

To pause a deployed pilot, remove the applicable client rows from
`finsight_private.mcp_oauth_clients` and stop the public ingress. Re-enabling
a pilot uses the same origin and client bindings.

## Local integration test

The local Supabase configuration includes OAuth and the token hook. Use a
disposable local Supabase instance with the migrations applied and `psql`
installed, then set `FINSIGHT_TEST_SUPABASE_URL`,
`FINSIGHT_TEST_SUPABASE_PUBLISHABLE_KEY`, `FINSIGHT_TEST_SUPABASE_SECRET_KEY`,
and `FINSIGHT_TEST_SUPABASE_DB_URL` from its CLI status output. Run
`npm run test:mcp:integration`. The test creates temporary users and a
temporary OAuth client, then exercises actual Supabase grants with synthetic
Wealthsimple data. Set `FINSIGHT_TEST_REQUIRE_AUTH_GUARD=1` to also verify
GoTrue rejects account changes made with a delegated token. GoTrue v2.197.0
allows those changes. The check requires a build that includes
[Supabase Auth #2898](https://github.com/supabase/auth/pull/2898).
