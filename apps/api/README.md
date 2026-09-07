# Finsight API

Go HTTP API for Finsight.

## Current Behavior

The API currently provides health and readiness checks, local default-portfolio context, account creation and reads, provider-backed asset search, portfolio overview, daily value history, and account values. The [OpenAPI contract](../../openapi/finsight.yaml) is the authoritative HTTP interface.

On every startup, the API connects to PostgreSQL and applies pending embedded Goose migrations before serving requests. In local deployment mode it also creates or reuses the local user, workspace, membership, and default portfolio. Managed identity is not implemented.

## Local Development

Run PostgreSQL and the API from the repository root:

```bash
docker compose up --build
```

PostgreSQL is exposed on port `5432` and the API on port `8080`.

Useful checks:

```bash
curl -i http://localhost:8080/health
curl -i http://localhost:8080/ready
curl -i http://localhost:8080/api/me
```

Seed deterministic local portfolio data:

```bash
make seed-demo
```

## Tests

Run backend tests from `apps/api`:

```bash
go test ./...
```

PostgreSQL integration tests are skipped unless `FINSIGHT_TEST_DATABASE_URL` is set. Point it at a dedicated disposable test database, not the normal local Finsight database. With the local Compose PostgreSQL service running, create the test database once from the repository root:

```bash
docker compose exec postgres createdb -U finsight finsight_test
```

Then run the complete suite from `apps/api`:

```bash
FINSIGHT_TEST_DATABASE_URL='postgres://finsight:finsight@localhost:5432/finsight_test?sslmode=disable' go test ./...
```

## Feature Documentation

- [Accounts](docs/accounts.md)
- [Assets](docs/assets.md)
- [Portfolio Values](docs/portfolio.md)
