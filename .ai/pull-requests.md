# Pull Request Guidelines

Use this checklist before opening or handing off a pull request.

## Description

The pull request description should state:

- What changed.
- Why it changed.
- Which behavior, workflow, or documentation source was affected.
- Which checks were run.
- Any intentional test gaps or follow-up work.

Reference related issues or design notes with full URLs when available.

## Readiness Checklist

Verify each applicable item before review:

- Scope: the diff is limited to the requested change.
- Architecture: backend, frontend, database, OpenAPI, and MCP boundaries match
  the documented Finsight direction.
- Tests: code changes include tests proportional to risk.
- Documentation: docs are updated when behavior, workflows, APIs, or contributor
  expectations change.
- Generated code: generated files were not edited manually.
- OpenAPI: contract changes include regenerated Go and TypeScript types.
- SQL: query changes include regenerated sqlc code when needed.
- Migrations: schema changes include Goose migrations and relevant tests.
- Frontend text: user-facing strings are in i18n resources.
- UI: visible UI changes include screenshots or a clear description of visual
  verification.
- Security: changes touching workspace scoping, tokens, auth, secrets, financial
  data exposure, or MCP access call out the risk and validation.
- Dependencies: new dependencies are justified and avoided unless necessary.

## Review Handoff

Make the review easy to evaluate:

- Mention the most important files or flows.
- Call out generated files separately.
- Explain intentional minimal choices.
- State which checks passed and which were not run.
- Include setup notes when validation needs local services.

## Validation

Run the smallest useful check first, then broaden as risk increases:

- Documentation-only: link and consistency inspection is usually sufficient.
- Backend service or handler changes: run `cd apps/api && go test ./...`.
- OpenAPI changes: regenerate backend and frontend types, then run backend tests
  and frontend typecheck.
- SQL or migration changes: run backend tests and any migration-specific tests.
- Frontend component or route changes: run typecheck, frontend tests, and build.
- End-to-end workflow changes: add or run Playwright tests.

Useful commands:

```bash
make test
make web-build
cd apps/api && go test ./...
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build
pnpm -C apps/web test:e2e
```

## Documentation-Only Pull Requests

For docs-only changes:

- Confirm links resolve.
- Confirm the docs do not contradict `docs/architecture.md`, `docs/mvp.md`, or
  `docs/domain-model.md`.
- Do not require Go, frontend, or Playwright tests unless code examples or
  runnable snippets changed.

## When To Split

Split the pull request when it combines unrelated concerns, such as:

- Product documentation and implementation.
- Database schema changes and broad frontend changes.
- Refactors and behavior changes.
- Generated code churn unrelated to the feature.

The reviewer should be able to understand and revert each concern independently.
