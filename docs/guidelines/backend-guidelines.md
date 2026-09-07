# Backend Guidelines

This document explains how to modify the current Go modular monolith. Read it with [Architecture](../architecture.md), [Database Guidelines](database-guidelines.md), and [OpenAPI Guidelines](openapi-guidelines.md).

## Request and Dependency Flow

Use the fewest boundaries needed to express the behavior clearly:

```text
HTTP handler
→ feature-owned concrete type or function
→ generated sqlc query or external-provider adapter
→ PostgreSQL or external system
```

- OpenAPI middleware validates the HTTP contract before handlers run.
- Handlers decode transport data, perform the current-context check, map values, and translate errors to HTTP responses.
- Concrete feature types and functions own business workflows, financial rules, database transactions, and database-error translation.
- Migrations own schema changes.

Direct sqlc access from feature code is valid. Prefer concrete feature types and functions. Do not introduce repository wrappers that only forward calls or map equivalent structures. Name types after their actual responsibility, such as `Store`, `Recorder`, `Calculator`, `Resolver`, or `Runner`.

## Feature Packages and Types

Backend behavior lives in focused packages under `apps/api/internal`. Add behavior to the package that owns it.

- Prefer a concrete type or function with explicit dependencies.
- Use a feature-owned input struct for a cohesive operation with several related values.
- Pass one or two simple identifiers directly instead of wrapping them in a parameter type.
- Use generated sqlc rows for table-shaped behavior when their meaning fits.
- Create handwritten types for calculations, aggregates, or behavior that differs from storage.
- Introduce an interface at a meaningful consuming or external boundary, not solely to create a mock.
- Use sentinel errors for expected failures that an adapter must translate.
- Wrap unexpected errors with useful context.

Do not choose packages or types for unimplemented features in advance. Their ownership should be decided with the feature that needs them.

## Go File Naming

- Use short, lowercase, descriptive filenames based on the concrete responsibility or concept implemented in the file.
- Prefer domain or behavior names such as `store.go`, `validation.go`, `errors.go`, `handler.go`, `parser.go`, `client.go`, or `account.go`.
- Avoid generic catch-all filenames such as `component.go`, `service.go`, `manager.go`, `utils.go`, `helpers.go`, `common.go`, or `misc.go` unless that term genuinely represents a well-defined concept in the codebase.
- Do not repeat the package name unnecessarily. Inside package `account`, prefer `store.go` over `account_store.go`.
- A file should normally have one cohesive responsibility. If no precise filename describes everything in the file, consider splitting the file rather than choosing a broader filename.
- Name the file according to what a developer would expect to find inside it when browsing the directory, not according to an architectural layer imported from another ecosystem.
- Do not assume every package needs a central or "main" file or type. Create structs only when they naturally group shared state, dependencies, or behavior.

## HTTP Adapters

HTTP code lives in `apps/api/internal/httpapi`.

Handlers should:

- Keep generated OpenAPI request and response types at the HTTP boundary.
- Convert transport values to meaningful feature inputs or pass simple values directly.
- Leave generated sqlc parameter construction inside feature code.
- Convert known errors into documented status codes and `ErrorResponse` bodies.
- Avoid raw SQL, migration logic, and authoritative financial rules.

## Persistence

Follow [Database Guidelines](database-guidelines.md):

- Put schema changes in Goose migrations under `apps/api/migrations`.
- Put non-trivial application SQL in `apps/api/internal/postgres/queries`.
- Call generated sqlc methods from the concrete feature type or function that owns the behavior.
- Keep multi-statement database operations atomic with explicit transactions.

## Generated Code

Do not manually edit:

- `apps/api/internal/openapi/generated`
- `apps/api/internal/postgres/generated`

After changing OpenAPI, sqlc queries, or migrations, regenerate from `apps/api`:

```bash
go generate ./...
```

Generator commands use pinned `go run ...@version` invocations and are not runtime dependencies.

## Tests

- Unit test deterministic validation, normalization, and calculations.
- Test HTTP status codes, error bodies, context checks, and request/response mapping.
- Test sqlc queries, constraints, mappings, error translation, and transactions against PostgreSQL.
- Use small fakes only at meaningful consuming or external boundaries.
- Add migration tests when startup migration behavior changes.

Run all backend tests from `apps/api`:

```bash
go test ./...
```

PostgreSQL integration tests are skipped unless `FINSIGHT_TEST_DATABASE_URL` is set; see [Database Guidelines](database-guidelines.md).
