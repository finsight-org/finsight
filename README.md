# Finsight

Open-source investment data platform for humans and AI agents. Import portfolio data, own your data, and connect ChatGPT, Claude, local LLMs, and MCP-compatible tools.

## Documentation

- [Vision](docs/vision.md): product mission, principles, target users, and long-term positioning.
- [MVP](docs/mvp.md): MVP scope, screens, success criteria, example AI questions, and non-goals.
- [Use Cases](docs/use-cases.md): MVP user flows, UX principles, edge cases, and business rules.
- [Domain Model](docs/domain-model.md): core entities, transaction model, imports, market data, and connected-agent assumptions.
- [Architecture](docs/architecture.md): technical boundaries, runtime components, data flows, and deployment models.
- [OpenAPI Workflow](docs/openapi-workflow.md): OpenAPI-first contract workflow, generated Go code, and HTTP boundary rules.
- [Database Migrations](docs/database-migrations.md): Goose migration workflow, startup behavior, and local database reset notes.
- [Database Access](docs/database-access.md): pgx, sqlc, query generation, and persistence boundary rules.

## Project Reference

These documents are the current source of truth for Finsight's MVP product scope, domain model, and technical architecture.

## Local Development

Run the backend and PostgreSQL from the repository root:

```bash
docker compose up --build
```

PostgreSQL is exposed locally on port `5432`. The API is exposed locally on port `8080`.

Check the application health endpoint:

```bash
curl -i http://localhost:8080/health
```

Check the database readiness endpoint:

```bash
curl -i http://localhost:8080/ready
```

Create or return the local development identity context:

```bash
curl -i -X POST http://localhost:8080/api/local/bootstrap
```

Local bootstrap is idempotent. It creates or returns the local user, local workspace, owner workspace membership, and internal default portfolio used by the backend until authentication and workspace selection are added.

Run backend tests from the API module:

```bash
cd apps/api
go test ./...
```

## OpenAPI Workflow

Finsight is OpenAPI-first. See [OpenAPI Workflow](docs/openapi-workflow.md) for contract, generation, and HTTP boundary rules.

## Database Migrations

Finsight uses Goose for PostgreSQL migrations. See [Database Migrations](docs/database-migrations.md) for migration commands, startup behavior, and local database reset notes.
