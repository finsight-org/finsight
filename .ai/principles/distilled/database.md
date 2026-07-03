# Database Principles

## Source Of Truth

PostgreSQL is the durable source of truth. Application code should access it
only through backend persistence boundaries.

Frontend code, MCP code, OpenAPI generated code, and HTTP handlers must not
query PostgreSQL directly.

## Migrations

Schema changes use Goose migrations in `apps/api/migrations`.

Migration guidance:

- Keep migrations focused and reversible when practical.
- Keep schema changes aligned with domain model changes.
- Add tests when migration startup behavior or schema assumptions change.
- Do not make market data or derived portfolio views the source of truth for
  user transactions.

## SQL And sqlc

Use sqlc for non-trivial SQL:

- Query sources live in `apps/api/internal/postgres/queries`.
- Generated code lives in `apps/api/internal/postgres/generated`.
- Regenerate from `apps/api` with `go generate ./...`.

Do not manually edit generated sqlc files.

## Repository Boundary

Repositories should:

- Adapt domain inputs into sqlc params.
- Adapt sqlc rows into domain structs.
- Translate expected database errors into domain/service errors.
- Keep pgx and sqlc details out of services and handlers.

## Data Integrity

- Use constraints where they protect source-of-truth records.
- Preserve workspace scoping in queries.
- Keep cash, assets, listings, transactions, ledger entries, prices, and FX rates
  distinct according to the domain model.
- Treat missing market data as incomplete data, not as permission to alter
  transaction history.
