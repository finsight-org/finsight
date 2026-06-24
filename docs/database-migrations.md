# Database Migrations

Finsight uses Goose for PostgreSQL database migrations.

Migration files live in:

```text
apps/api/migrations
```

The API runs pending Goose migrations during startup for local and user-operated deployments. Goose records applied migrations in its default `goose_db_version` table.

The initial migration creates the identity/workspace foundation tables:

- `workspaces`
- `users`
- `workspace_memberships`
- `portfolios`

## Create a Migration

From the API module:

```bash
cd apps/api
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations create add_accounts sql
```

## Check Migration Status

```bash
cd apps/api
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations postgres "$FINSIGHT_DATABASE_URL" status
```

## Run Migrations Manually

```bash
cd apps/api
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations postgres "$FINSIGHT_DATABASE_URL" up
```

The Goose CLI is invoked with pinned `go run ...@version` commands and is not tracked as an application runtime dependency. The API still uses the Goose library at runtime to apply embedded migrations during startup.

## SQL Migration Format

Future SQL migrations should use Goose directives:

```sql
-- +goose Up
-- migration SQL here

-- +goose Down
-- rollback SQL here
```

Use statement blocks when PostgreSQL functions or other multi-statement bodies are needed:

```sql
-- +goose StatementBegin
create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;
-- +goose StatementEnd
```

## Local Development Notes

For normal local setup, use Docker Compose from the repository root:

```bash
docker compose up --build
```

The API applies pending migrations automatically before serving requests.

If a local development Postgres volume was created with an incompatible old schema or role setup, reset it with:

```bash
docker compose down -v
docker compose up --build
```

This deletes the local Postgres volume, so only use it when existing local data is disposable.
