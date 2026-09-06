# Finsight

Open-source investment data platform for humans and AI agents. Import portfolio data, own your data, and connect ChatGPT, Claude, local LLMs, and MCP-compatible tools.

## Documentation

- [Vision](docs/vision.md): product mission, principles, target users, and long-term positioning.
- [MVP](docs/mvp.md): MVP scope, screens, success criteria, example AI questions, and non-goals.
- [Use Cases](docs/use-cases.md): MVP user flows, UX principles, edge cases, and business rules.
- [Domain Model](docs/domain-model.md): core entities, transaction model, imports, market data, and connected-agent assumptions.
- [Architecture](docs/architecture.md): technical boundaries, runtime components, data flows, and deployment models.
- [Technical Direction](docs/foundation/technical-direction.md): stable implementation direction, dependency flow, and feature evolution guidance.
- [Codebase Structure](docs/foundation/codebase-structure.md): repository layout, package boundaries, generated code locations, and test placement.
- [Engineering Principles](docs/foundation/engineering-principles.md): coding philosophy, dependency discipline, testability, and pull request expectations.
- [Backend Guidelines](docs/guidelines/backend-guidelines.md): Go feature components, HTTP adapters, migrations, sqlc, and backend testing guidance.
- [Frontend Guidelines](docs/guidelines/frontend-guidelines.md): React feature organization, API types, server state, i18n, UI, and frontend testing guidance.
- [OpenAPI Guidelines](docs/guidelines/openapi-guidelines.md): OpenAPI-first contract workflow, generated code, and HTTP boundary rules.
- [Database Guidelines](docs/guidelines/database-guidelines.md): pgx, sqlc, Goose migrations, query generation, and persistence boundary rules.
- [Code Review Guidelines](docs/git/code-review.md): code review methodology and blocker criteria.
- [Git Workflow Guidelines](docs/git/git.md): branch, commit, staging, and generated-file guidance.
- [Pull Request Guidelines](docs/git/pull-requests.md): pull request preparation and validation checklist.
- [Agent Contribution Guide](AGENTS.md): repository rules for AI coding agents and safe contribution workflows.
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

Seed deterministic local portfolio demo data after PostgreSQL is running:

```bash
make seed-demo
```
