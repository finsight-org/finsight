# Finsight

Finsight is an open-source investment data platform for people and AI agents. It helps users bring together portfolio data, retain control of it, understand their investments through a focused web interface, and connect compatible AI tools.

The current application supports local setup, account creation, provider-backed asset search, multi-currency portfolio valuation, daily value history, account values, and deterministic demo data. File imports and read-only AI access are MVP product requirements that are not yet implemented.

## Local Development

Run the full local project:

```bash
make dev
```

This starts PostgreSQL and the Go API with Docker Compose, then runs the React/Vite application in the foreground.

Run only PostgreSQL and the API:

```bash
make dev-api
```

Seed deterministic local portfolio data after PostgreSQL is running:

```bash
make seed-demo
```

Run common checks:

```bash
make test
make web-build
```

## Documentation

### Product

- [Vision](docs/vision.md)
- [MVP](docs/mvp.md)
- [Use Cases](docs/use-cases.md)

### Engineering

- [Current Architecture](docs/architecture.md)
- [Engineering Principles](docs/foundation/engineering-principles.md)
- [Codebase Structure](docs/foundation/codebase-structure.md)
- [Backend Guidelines](docs/guidelines/backend-guidelines.md)
- [Database Guidelines](docs/guidelines/database-guidelines.md)
- [Frontend Guidelines](docs/guidelines/frontend-guidelines.md)
- [OpenAPI Guidelines](docs/guidelines/openapi-guidelines.md)

### Development

- [API README](apps/api/README.md)
- [Web README](apps/web/README.md)
- [Code Review Guidelines](docs/git/code-review.md)
- [Git Workflow Guidelines](docs/git/git.md)
- [Pull Request Guidelines](docs/git/pull-requests.md)
- [AI Agent Guide](AGENTS.md)

## License

Finsight is licensed under the [GNU Affero General Public License v3.0](LICENSE).
