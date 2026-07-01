# Finsight API

Go backend for Finsight.

## Local Development

Run the API and PostgreSQL from the repository root:

```bash
docker compose up --build
```

PostgreSQL is exposed locally on port `5432`. The API is exposed locally on port `8080`.

Useful checks:

```bash
curl -i http://localhost:8080/health
curl -i http://localhost:8080/ready
```

Create or return the local development identity context:

```bash
curl -i -X POST http://localhost:8080/api/local/bootstrap
```

Run backend tests from this module:

```bash
go test ./...
```

## Docs

- [Accounts](docs/accounts.md)

