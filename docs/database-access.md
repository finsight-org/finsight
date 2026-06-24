# Database Access

Finsight uses PostgreSQL as the durable source of truth.

Application code should access PostgreSQL only through backend persistence boundaries. HTTP handlers, OpenAPI generated code, MCP code, and frontend code must not query the database directly.

## Runtime Access

The Go API uses `pgx` for runtime PostgreSQL access.

- Connection pooling is handled with `pgxpool`.
- Application repositories receive database handles and expose domain-oriented methods.
- Domain services call repositories; services do not depend on SQL, pgx rows, or generated database types.

## Migrations

Schema changes are managed with Goose.

Migration files live in:

```text
apps/api/migrations
```

See [Database Migrations](database-migrations.md) for Goose commands and local setup notes.

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
- Repositories adapt generated sqlc rows and params to domain structs.
- Domain structs use typed values such as `uuid.UUID`, not arbitrary string IDs.
- HTTP/OpenAPI adapters adapt generated OpenAPI types to domain types.
- Generated OpenAPI types and generated sqlc types should not leak into business logic.
