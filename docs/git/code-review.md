# Code Review Guidelines

## Review Methodology

Work through these layers in order:

1. Scope and intent: understand the requested change and whether the diff stays
   inside that scope.
2. Architecture: verify the change fits Finsight's documented modular monolith,
   OpenAPI, PostgreSQL, React/Vite, and read-only MCP boundaries.
3. Blockers: identify correctness bugs, security issues, data integrity risks,
   missing error handling, generated-file mistakes, and material test gaps.
4. Improvements: suggest meaningful non-blocking improvements.
5. Nitpicks: label minor naming, style, or wording issues as nitpicks.

## Verdict

- Any blocker present: request changes.
- Only non-blocking improvements or nitpicks: approve with comments.
- No meaningful issues: approve.

Do not approve a change with unresolved blockers.

## Finsight Architecture Checks

Verify that the change preserves these boundaries:

- Business rules live in focused backend feature components.
- HTTP handlers adapt OpenAPI requests and responses; they do not own financial
  rules or raw SQL.
- Table-shaped features may use generated sqlc params and rows directly.
- Handwritten domain types represent meaningful behavior rather than duplicate
  database rows.
- Production interfaces exist for meaningful boundaries or multiple
  implementations, not solely for mocks.
- The React app calls only the OpenAPI HTTP API.
- Frontend code does not query PostgreSQL, call market data providers, call MCP,
  or reimplement authoritative financial calculations.
- MCP remains read-only for the MVP and calls backend feature components.
- Provider-specific market data shapes do not leak into domain, HTTP, MCP, or
  frontend contracts.

## Blocker Categories

Treat these as blockers unless the author has a clear documented reason:

- Source-of-truth financial records can be corrupted or derived data can no
  longer be reproduced from transactions, ledger entries, prices, and FX rates.
- Workspace scoping, authorization, token handling, or financial data exposure is
  weakened.
- Generated files are edited by hand instead of regenerated from OpenAPI, sqlc,
  or route sources.
- OpenAPI contract changes are not reflected in generated Go and TypeScript
  types.
- Database migrations are missing for schema changes, or application SQL is
  placed outside the documented migration/sqlc query boundary.
- User-facing frontend strings are hard-coded instead of going through i18n
  resources.
- Behavior changes lack tests proportional to risk.
- The implementation introduces speculative infrastructure, service boundaries,
  queues, frameworks, datastores, or provider coupling outside the documented
  direction.

## Tests During Review

Ask for focused tests near the changed behavior:

- Pure backend logic: validation, calculations, and deterministic rules.
- HTTP handlers: status codes, `ErrorResponse` bodies, and response mapping.
- PostgreSQL integration: sqlc queries, constraints, mappings, transactions, and
  database error translation.
- Frontend features: visible behavior, loading, empty, error, and mutation
  states.
- Playwright: important cross-route or end-to-end workflows.

For documentation-only changes, tests are usually not required. Link checks and
consistency review are enough.

## Minimal Change Principle

Prefer the smallest change that correctly solves the problem. Flag unrelated
refactors, formatting churn, speculative abstractions, and changes to files or
layers that are not required for the requested behavior.

## Debugging During Review

When a bug resists one or two fix attempts, stop guessing from code alone.
Request targeted runtime evidence: logs, network responses, computed values,
DOM state, database rows, or command output. Ask for the smallest observation
that can confirm or reject the current theory.
