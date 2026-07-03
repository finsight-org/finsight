# Agent Contribution Guide

This file is for AI coding agents working in this repository, including Codex, ChatGPT, Claude Code, Gemini, and similar tools.

Before changing code, read the project documentation that defines current direction:

- [Architecture](docs/architecture.md)
- [Domain Model](docs/domain-model.md)
- [MVP](docs/mvp.md)
- [Frontend Architecture](docs/frontend.md)
- [OpenAPI Workflow](docs/openapi-workflow.md)
- [Database Access](docs/database-access.md)
- [Database Migrations](docs/database-migrations.md)
- [Technical Direction](docs/technical-direction.md)
- [Engineering Principles](docs/engineering-principles.md)

Do not rewrite or duplicate those documents in new work. Link to them when product, domain, or architecture context is needed.

## Task-Specific AI Instructions

Use the modular `.ai` instructions when a task matches one of these areas:

- Code review: [Code Review Guidelines](.ai/code-review.md).
- Git, commits, branches, or staging: [Git Workflow Guidelines](.ai/git.md).
- Pull request preparation: [Pull Request Guidelines](.ai/merge-requests.md).
- CI, checks, or validation failures: [CI/CD and Validation Guidelines](.ai/ci-cd.md).
- Implementation work: read the relevant files in [Finsight Agent Principles](.ai/principles/README.md), especially:
  - [Architecture Principles](.ai/principles/distilled/architecture.md)
  - [Backend Principles](.ai/principles/distilled/backend.md)
  - [Frontend Principles](.ai/principles/distilled/frontend.md)
  - [API Principles](.ai/principles/distilled/api.md)
  - [Database Principles](.ai/principles/distilled/database.md)
  - [Security Principles](.ai/principles/distilled/security.md)
  - [Testing Principles](.ai/principles/distilled/testing.md)
  - [Documentation Principles](.ai/principles/distilled/documentation.md)

The `.ai` files summarize and route agent behavior. The source-of-truth documents in `docs/` still define product, domain, architecture, and implementation direction.

## How To Work Safely

- Make small, focused changes that match the existing implementation style.
- Preserve the modular monolith. Do not introduce service boundaries, queues, background platforms, deployment models, or infrastructure unless explicitly requested and already aligned with the docs.
- Keep HTTP handlers, MCP tools, and frontend code thin. Business logic belongs in backend application/domain services.
- Keep dependencies flowing inward: adapters depend on services and domain types; services do not depend on HTTP, generated OpenAPI types, React code, or provider-specific response shapes.
- Prefer explicit code over hidden magic. Avoid broad abstractions unless they remove real repeated complexity.
- Do not add third-party dependencies unless the repository cannot reasonably solve the problem with its current stack.
- Treat generated files as build artifacts. Do not edit generated OpenAPI or sqlc files by hand.
- Do not bypass documented workflows for OpenAPI, migrations, sqlc, or frontend API type generation.
- Respect existing user changes in the working tree. Never revert unrelated changes.

## Generated Files

These files are generated and must not be edited manually:

- `apps/api/internal/openapi/generated`
- `apps/api/internal/postgres/generated`
- `apps/web/src/api/generated`
- `apps/web/src/routeTree.gen.ts`

When a contract or query changes, update the source of truth and regenerate with the documented command:

- HTTP contract: edit `openapi/finsight.yaml`, then run `cd apps/api && go generate ./...`.
- SQL queries: edit `apps/api/internal/postgres/queries`, then run `cd apps/api && go generate ./...`.
- Frontend API types: run `pnpm -C apps/web openapi:gen` after OpenAPI changes.

## Backend Rules

- Put domain/application behavior in feature packages under `apps/api/internal`.
- Keep handlers in `apps/api/internal/httpapi` focused on decoding, invoking services, mapping responses, and translating errors.
- Keep persistence behind repositories. Services should not depend on SQL rows, pgx row scanning, or sqlc generated types.
- Use migrations in `apps/api/migrations` for schema changes.
- Put non-trivial SQL in `apps/api/internal/postgres/queries` for sqlc generation.
- Add focused Go tests beside the package being changed.

## Frontend Rules

- The React app lives in `apps/web` and calls only the OpenAPI HTTP API.
- Put feature UI under `apps/web/src/features/<feature>`.
- Put shared UI primitives under `apps/web/src/components/ui` only when they are broadly reusable.
- Use generated OpenAPI types from `apps/web/src/api/generated`.
- Use TanStack Query for server state, loading, errors, mutations, and invalidation.
- Put user-facing text in i18n resources instead of inline labels.
- Do not implement financial business rules in the browser. Client-side validation is only for usability.

## API Rules

- `openapi/finsight.yaml` is the source of truth for HTTP paths, request shapes, responses, and status codes.
- New or changed endpoints must be reflected in generated Go and TypeScript types.
- Error responses should use the existing `ErrorResponse` shape unless there is a deliberate contract change.
- HTTP handlers adapt OpenAPI types to service inputs and service outputs back to OpenAPI responses.

## Pull Request Standard

A change is ready for review when:

- It matches the documented architecture and implementation boundaries.
- It is smaller than the broadest possible solution.
- It includes tests proportional to the risk.
- It updates docs only when behavior, workflow, or contributor expectations change.
- It does not include hand-edited generated code.
- Relevant checks have been run, or the final response clearly states why they were not run.

Useful checks:

```bash
make test
make web-build
cd apps/api && go test ./...
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build
```

## Things Agents Must Never Do

- Do not replace the modular monolith with microservices.
- Do not add a new framework, datastore, job system, auth provider, or deployment platform without explicit direction.
- Do not duplicate financial calculations across handlers, MCP tools, frontend components, or database queries.
- Do not query PostgreSQL from the frontend or MCP boundary.
- Do not let provider-specific market data shapes leak into the core domain, HTTP API, or MCP responses.
- Do not make MCP mutation-capable for the MVP.
- Do not hide important behavior behind reflection, global state, code generation, or clever abstractions when straightforward code works.
- Do not make speculative product changes while implementing infrastructure or contributor documentation.
