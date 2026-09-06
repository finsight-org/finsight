# Agent Contribution Guide

This file routes AI coding agents to the repository's sources of truth. Read the documents relevant to the task instead of duplicating their guidance here.

## Product Direction

- [Vision](docs/vision.md): what Finsight aims to become and why.
- [MVP](docs/mvp.md): the capabilities required for the MVP and its non-goals.
- [Use Cases](docs/use-cases.md): important user journeys and product-visible rules.

## Current Technical Architecture

- [Architecture](docs/architecture.md): implemented components, data flow, and current constraints.
- [Codebase Structure](docs/foundation/codebase-structure.md): the current repository layout and code ownership.

## Engineering Rules

- [Engineering Principles](docs/foundation/engineering-principles.md): stable implementation philosophy.
- [Backend Guidelines](docs/guidelines/backend-guidelines.md)
- [Database Guidelines](docs/guidelines/database-guidelines.md)
- [Frontend Guidelines](docs/guidelines/frontend-guidelines.md)
- [OpenAPI Guidelines](docs/guidelines/openapi-guidelines.md)

## Current Application and Feature Behavior

- [API README](apps/api/README.md) and [implemented API feature docs](apps/api/docs/)
- [Web README](apps/web/README.md)
- Executable contracts, migrations, tests, and code

## Contribution Workflow

- [Code Review Guidelines](docs/git/code-review.md)
- [Git Workflow Guidelines](docs/git/git.md)
- [Pull Request Guidelines](docs/git/pull-requests.md)

## Operating Rules

- Respect user changes and do not revert unrelated work.
- Follow this priority when instructions conflict: current user request, this file, linked documentation, then local judgment.
- Do not infer or invent future internal models from MVP requirements. When implementing a new feature, design only the structures needed for the current change and update technical documentation after the implementation decision is made.
