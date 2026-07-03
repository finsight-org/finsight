# Backend Principles

## Layering

Backend code lives in `apps/api` and should stay explicit:

- `cmd`: application entrypoints.
- `internal/<feature>`: domain and application behavior.
- `internal/httpapi`: HTTP adapters around generated OpenAPI interfaces.
- `internal/postgres`: database setup, migrations, generated sqlc code, and
  query support.
- `migrations`: Goose schema migrations.

## Services

Services own validation, business rules, orchestration, and domain errors.

They should:

- Use domain-oriented input and output structs.
- Depend on narrow interfaces.
- Return sentinel errors for expected domain failures.
- Wrap unexpected errors with useful context.
- Be testable without HTTP or database setup when practical.

Services should not depend on generated OpenAPI types, sqlc rows, pgx scanning,
React code, provider response shapes, or transport-level concerns.

## HTTP Adapters

Handlers in `internal/httpapi` should:

- Decode requests and path parameters.
- Convert OpenAPI request types into service inputs.
- Call application services.
- Map service results into generated OpenAPI response types.
- Translate known service errors to documented HTTP status codes and
  `ErrorResponse` bodies.

Handlers should not contain financial business rules, SQL, provider calls, or
calculation logic.

## Repositories

Repositories own persistence mapping:

- Use sqlc generated queries for non-trivial SQL.
- Convert sqlc params and rows to domain types.
- Translate database constraints and expected persistence errors.
- Keep generated database types out of services.

## Generated Code

Do not manually edit:

- `apps/api/internal/openapi/generated`
- `apps/api/internal/postgres/generated`

Regenerate from `apps/api` with:

```bash
go generate ./...
```
