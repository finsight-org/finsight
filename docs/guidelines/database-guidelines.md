# Database Access

Finsight uses PostgreSQL as the durable source of truth.

Application code accesses PostgreSQL through generated sqlc queries owned by backend feature components. OpenAPI generated code, MCP code, and frontend code must not query the database directly.

## Runtime Access

The Go API uses `pgx` for runtime PostgreSQL access.

- Connection pooling is handled with `pgxpool`.
- Application startup constructs sqlc `Queries` values over the shared connection pool.
- Feature components receive concrete sqlc queries and call generated methods directly.
- Feature components own database error translation and transactions.

## Migrations

Schema changes are managed with Goose.

Migration files live in:

```text
apps/api/migrations
```

See the [Database Migrations](#database-migrations) section below for Goose commands and local setup notes.

## Query Generation

Finsight uses `sqlc` for typed query generation where SQL is non-trivial.

Query files live in:

```text
apps/api/internal/postgres/queries
```

Generated database code lives in:

```text
apps/api/internal/postgres/generated
```

Do not edit generated database files manually.

The `sqlc` configuration lives in:

```text
apps/api/sqlc.yaml
```

It reads schema from Goose migrations and generates pgx/v5-compatible Go code.

## Regenerate Code

From the API module:

```bash
cd apps/api
go generate ./...
```

This regenerates both:

- OpenAPI server/types code
- sqlc database query code

Generator CLIs are invoked by `go generate` with pinned `go run ...@version` commands. They are intentionally not tracked as application runtime dependencies in `apps/api/go.mod`.

The underlying sqlc command is:

```bash
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.29.0 generate
```

## Boundary Rules

- SQL belongs in migration files or query files, not as large raw strings in Go.
- Generated sqlc rows and params may represent table-shaped feature data directly.
- HTTP adapters map generated OpenAPI DTOs into meaningful feature inputs or pass simple values directly. Feature components construct generated sqlc parameters internally.
- Handwritten domain models should represent meaningful behavior, aggregates, or derived data rather than duplicate table rows.
- Interfaces are reserved for meaningful boundaries or multiple production implementations, not database mocking.

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
