# Finsight

Open-source investment data platform for humans and AI agents. Import portfolio data, own your data, and connect ChatGPT, Claude, local LLMs, and MCP-compatible tools.

## Documentation

- [Vision](docs/vision.md): product mission, principles, target users, and long-term positioning.
- [MVP](docs/mvp.md): MVP scope, screens, success criteria, example AI questions, and non-goals.
- [Use Cases](docs/use-cases.md): MVP user flows, UX principles, edge cases, and business rules.
- [Domain Model](docs/domain-model.md): core entities, transaction model, imports, market data, and connected-agent assumptions.
- [Architecture](docs/architecture.md): technical boundaries, runtime components, data flows, and deployment models.

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

Run backend tests from the API module:

```bash
cd apps/api
go test ./...
```
