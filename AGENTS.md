# Agent Contribution Guide

This file is for AI coding agents working in this repository, including Codex, ChatGPT, Claude Code, Gemini, and similar tools.

AI agents automatically read `AGENTS.md`. Keep this file as a routing guide and avoid duplicating project documentation.

## Source Of Truth

Before changing code or documentation, read the relevant source documents:

- Product and domain context: [Vision](docs/vision.md), [MVP](docs/mvp.md), [Use Cases](docs/use-cases.md), [Domain Model](docs/domain-model.md).
- Architecture and technical foundation: [Architecture](docs/architecture.md), [Technical Direction](docs/foundation/technical-direction.md), [Codebase Structure](docs/foundation/codebase-structure.md), [Engineering Principles](docs/foundation/engineering-principles.md).
- Implementation guidelines: [Backend Guidelines](docs/guidelines/backend-guidelines.md), [Frontend Guidelines](docs/guidelines/frontend-guidelines.md), [OpenAPI Guidelines](docs/guidelines/openapi-guidelines.md), [Database Guidelines](docs/guidelines/database-guidelines.md).
- Git and review workflows: [Code Review Guidelines](docs/git/code-review.md), [Git Workflow Guidelines](docs/git/git.md), [Pull Request Guidelines](docs/git/pull-requests.md).

Do not rewrite or duplicate existing architecture, MVP, product, domain, or implementation documentation. Link to the relevant source document instead.

## Task Routing

- For implementation work, read the relevant files in `docs/foundation` and `docs/guidelines`.
- For code review, read [Code Review Guidelines](docs/git/code-review.md).
- For branch, staging, commit, or push work, read [Git Workflow Guidelines](docs/git/git.md).
- For pull request preparation, read [Pull Request Guidelines](docs/git/pull-requests.md).

## Review guidelines

When acting as a code reviewer, including as the Codex GitHub review agent, follow [Code Review Guidelines](docs/git/code-review.md).

Focus on correctness, security, data integrity, behavioral regressions, architecture boundary violations, and missing tests. Keep comments high-signal and grounded in changed lines.

## Operating Rules

- Respect user changes in the working tree. Do not revert unrelated changes.
- Follow the linked source documents instead of restating or overriding them.
- If instructions conflict, follow this order: current user request, this `AGENTS.md`, source documents in `docs/`, then local judgment.
