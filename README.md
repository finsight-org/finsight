# Finsight

Open-source investment data platform for humans and AI agents. Import portfolio data, own your data, and connect ChatGPT, Claude, local LLMs, and MCP-compatible tools.

## Documentation

- [Vision](docs/vision.md): product mission, principles, target users, and long-term positioning.
- [MVP](docs/mvp.md): MVP scope, screens, success criteria, example AI questions, and non-goals.
- [Use Cases](docs/use-cases.md): MVP user flows, UX principles, edge cases, and business rules.
- [Domain Model](docs/domain-model.md): core entities, transaction model, imports, market data, and connected-agent assumptions.
- [Architecture](docs/architecture.md): technical boundaries, runtime components, data flows, and deployment models.
- [Frontend Architecture](docs/frontend.md): web app stack, API boundary, and frontend data ownership rules.
- [OpenAPI Workflow](docs/openapi-workflow.md): OpenAPI-first contract workflow, generated Go code, and HTTP boundary rules.
- [Database Migrations](docs/database-migrations.md): Goose migration workflow, startup behavior, and local database reset notes.
- [Database Access](docs/database-access.md): pgx, sqlc, query generation, and persistence boundary rules.
- [Go API](apps/api/README.md): backend setup, checks, tests, and API-specific docs.

## Project Reference

These documents are the current source of truth for Finsight's MVP product scope, domain model, and technical architecture.

## Local Development

Run the full local project from the repository root:

```bash
make dev
```

This starts PostgreSQL and the Go API with Docker Compose, then starts the React/Vite web app in the foreground.

Run only the backend and PostgreSQL:

```bash
make dev-api
```

Run useful checks:

```bash
make test
make web-build
```
