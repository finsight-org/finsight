# Database Guidelines

Finsight uses PostgreSQL for durable storage, pgx for runtime access, sqlc for typed queries, and Goose for migrations.

## Runtime Access

- Application construction opens one `pgxpool` connection pool.
- Concrete feature types and functions call generated sqlc queries directly.
- A focused persistence type such as a `Store` may own validation or transactional behavior; do not add wrappers that only forward calls.
- Feature code owns database error translation and explicit transactions.
- HTTP and frontend code do not query PostgreSQL directly.
- SQL belongs in migration or sqlc query files rather than large strings in application code.

A persistence boundary keeps database concerns out of transport and presentation code. It does not require a repository layer.

## Migrations

Goose migrations live in `apps/api/migrations` and are embedded into the API executable. The API applies pending migrations during startup before serving requests in both supported configuration modes. Local mode then bootstraps its default local data; managed mode skips that bootstrap.

Create a migration from `apps/api`:

```bash
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations create add_feature sql
```

SQL migrations use Goose directives:

```sql
-- +goose Up
-- migration SQL

-- +goose Down
-- rollback SQL
```

Use `StatementBegin` and `StatementEnd` around PostgreSQL functions or other bodies Goose cannot split safely.

Check or apply migrations manually with a configured database URL:

```bash
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations postgres "$FINSIGHT_DATABASE_URL" status
go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations postgres "$FINSIGHT_DATABASE_URL" up
```

Prefer database constraints for durable invariants and translate expected constraint failures at the owning feature boundary.

## sqlc Queries

Query sources live in `apps/api/internal/postgres/queries`. Generated Go code lives in `apps/api/internal/postgres/generated` and must not be edited manually.

The configuration in `apps/api/sqlc.yaml` reads the Goose migrations as its schema and generates pgx/v5-compatible code.

After changing a migration or query, regenerate from `apps/api`:

```bash
go generate ./...
```

This also regenerates the Go OpenAPI boundary. The pinned underlying sqlc command is:

```bash
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.29.0 generate
```

Generated rows and parameters may represent table-shaped feature data directly. Add handwritten types only when they express behavior, calculations, aggregates, or another meaning distinct from storage.

## Transactions

Use an explicit pgx transaction when multiple writes must succeed or fail together.

- Begin and commit the transaction in the feature-owned persistence operation.
- Defer rollback so error paths remain safe.
- Construct sqlc queries over the transaction handle.
- Validate relationships required for data integrity within the same transaction when concurrent changes could matter.
- Return enough context to identify whether begin, query, mapping, or commit failed.

## PostgreSQL Integration Tests

Database integration tests run only when `FINSIGHT_TEST_DATABASE_URL` is set. Without it, `go test ./...` runs the remaining tests and reports the PostgreSQL tests as skipped.

Point the variable at a dedicated disposable test database, not a database containing valuable local data. With the local Compose PostgreSQL service running, create the test database once and run the complete suite from the repository root:

```bash
docker compose exec postgres createdb -U finsight finsight_test
cd apps/api
FINSIGHT_TEST_DATABASE_URL='postgres://finsight:finsight@localhost:5432/finsight_test?sslmode=disable' go test ./...
```

The tests apply current migrations and isolate their records with unique identifiers and cleanup. Tests that change migration or global database behavior must remain safe to run repeatedly against the designated test database.

## Local Development

From the repository root:

```bash
docker compose up --build
```

The API applies pending migrations automatically. If an incompatible old local volume contains only disposable data, reset it with:

```bash
docker compose down -v
docker compose up --build
```

The first command deletes the local PostgreSQL volume and its data.
