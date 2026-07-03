# Architecture Principles

## Core Direction

- Finsight is a modular monolith for the MVP.
- The backend is one Go application with internal package boundaries.
- PostgreSQL is the durable source of truth.
- The React/Vite frontend talks through the OpenAPI HTTP API.
- MCP is the read-only agent-facing interface.
- Market data providers are external adapters, not domain dependencies.

## Dependency Direction

Dependencies flow inward:

- HTTP, MCP, frontend, provider, and database adapters depend on application
  services.
- Application services depend on domain types and narrow interfaces.
- Domain and service behavior must not depend on generated OpenAPI types, sqlc
  rows, React code, provider response shapes, or transport concerns.

## Financial Data Model

- Transactions and ledger entries are source-of-truth records.
- Positions, cash balances, summaries, allocations, performance, and exposure
  are derived views.
- Missing prices or FX rates should create incomplete-data warnings, not corrupt
  source records.
- Derived portfolio data must remain reproducible from stored source records.

## MCP Boundary

- MCP tools are read-only in the MVP.
- MCP tools call backend application services.
- MCP must not bypass workspace scoping, authorization, validation, or
  calculation rules.
- MCP must not support portfolio mutations, import confirmation, trading, broker
  synchronization, or financial advice actions in the MVP.

## Growth Pattern

Add new features as small vertical slices:

1. Update the product/domain/architecture docs if direction changes.
2. Update OpenAPI when HTTP access is needed.
3. Add backend service behavior.
4. Add persistence through migrations, sqlc, and repositories when durable state
   is required.
5. Add HTTP/MCP/frontend adapters around service behavior.
6. Add focused tests at the changed boundaries.
