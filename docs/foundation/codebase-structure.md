# Codebase Structure

This document maps the current tracked repository and explains where implementation work belongs. It complements [Architecture](../architecture.md) and the implementation guidelines.

## Repository Map

```text
finsight/
├── apps/
│   ├── api/                 Go API
│   └── web/                 React web application
├── docs/                    Product and contributor documentation
├── openapi/finsight.yaml    HTTP contract source
├── AGENTS.md                AI-agent routing instructions
├── Makefile                 Common development commands
└── docker-compose.yml       Local PostgreSQL and API services
```

If a feature does not exist, its future package or directory is intentionally undecided. Add code to the package that owns the behavior being implemented.

## Backend

Backend code lives in `apps/api`:

- `cmd`: executable entry points for the API and demo seed command.
- `internal/app`: application construction and dependency wiring.
- `internal/startup`, `bootstrap`, and `localcontext`: startup and local deployment behavior.
- `internal/account`, `asset`, `transaction`, `portfolio`, and `portfoliovalue`: current feature behavior.
- `internal/httpapi`: handwritten HTTP adapters around generated OpenAPI interfaces.
- `internal/openapi/generated`: generated Go HTTP types and interfaces; do not edit manually.
- `internal/postgres/queries`: sqlc query sources.
- `internal/postgres/generated`: generated sqlc code; do not edit manually.
- `internal/postgres`: database setup, migration execution, and shared PostgreSQL conversion helpers.
- `migrations`: Goose migrations embedded into the API.
- `docs`: technical documentation for implemented API features.

Extend an existing feature package when it owns the behavior. Create a new feature package only when the implemented capability has a distinct owner.

## Frontend

Frontend code lives in `apps/web`:

- `src/api`: API client setup, endpoint wrappers, and TanStack Query hooks.
- `src/api/generated`: generated OpenAPI TypeScript types; do not edit manually.
- `src/app`: providers, router construction, and query-client setup.
- `src/components/ui`: shared UI primitives.
- `src/components/layout`: application layout components.
- `src/features`: feature-specific components and colocated tests.
- `src/i18n`: translation configuration and resources.
- `src/routes`: TanStack Router route sources.
- `src/routeTree.gen.ts`: generated route tree; do not edit manually.
- `tests/e2e`: Playwright browser tests.

Keep feature behavior close to its owning UI and extract shared code only after reuse is real.

## Dependency Direction

```text
frontend feature
→ frontend API wrapper and generated types
→ OpenAPI HTTP adapter
→ backend feature package/type
→ generated sqlc query or provider adapter
→ PostgreSQL or external system
```

- Transport code maps requests and responses; it does not own financial rules.
- Concrete feature types and functions own workflows, calculations, error translation, and database transactions where needed.
- Feature code may use generated sqlc parameters and rows directly for table-shaped behavior.
- Interfaces belong at meaningful consuming or external boundaries, not as mandatory layers.

## Test Placement

- Go unit and PostgreSQL integration tests live beside their backend packages.
- HTTP behavior tests live in `apps/api/internal/httpapi`.
- Frontend API and component tests live beside the source they exercise.
- Playwright tests live in `apps/web/tests/e2e`.
