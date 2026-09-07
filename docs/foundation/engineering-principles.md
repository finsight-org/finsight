# Engineering Principles

This document defines stable engineering philosophy for contributors. Product direction lives in [Vision](../vision.md), [MVP](../mvp.md), and [Use Cases](../use-cases.md). Implemented technical decisions live in [Architecture](../architecture.md), the codebase, and current feature documentation.

## Keep Solutions Simple

- Prefer simple, explicit, readable code over cleverness or magic.
- Avoid premature abstractions and unnecessary dependencies.
- Prefer concrete types and functions by default.
- Introduce interfaces at meaningful consuming or external boundaries, not solely to make mocking convenient.
- Add an abstraction only when current behavior demonstrates the need for it.

Good code in this repository is direct, easy to test, and easy to remove.

## Put Behavior With Its Owner

- Add business behavior to the feature package that owns it.
- Keep HTTP handlers and frontend adapters thin.
- Let feature code call generated sqlc queries directly when that is the clearest implementation.
- Do not introduce repository or service layers automatically.
- Use handwritten domain types for behavior, calculations, or aggregates—not as copies of generated database rows.
- Keep provider-specific details behind the adapter that communicates with that provider.
- Keep generated OpenAPI, sqlc, and route files generated.

## Change Incrementally

Prefer a small, complete change over a broad speculative refactor.

A well-scoped change:

- Solves one current user or contributor problem.
- Touches the fewest areas needed to implement it correctly.
- Adds tests near the changed behavior.
- Preserves unrelated code and user changes.
- Updates documentation when implemented behavior or contributor workflows change.

## Test Behavior Without Distorting Design

- Unit test deterministic validation, normalization, and calculations directly.
- Test HTTP behavior at the handler boundary.
- Test SQL, constraints, mappings, and transactions against PostgreSQL.
- Use small fakes at meaningful external or consuming boundaries.
- Test frontend features through visible behavior.
- Use end-to-end tests for important workflows that cross routing, API, or rendering boundaries.
- Do not add production indirection solely for a test.

Tests should make behavior safer to change instead of mirroring implementation details.

## Add Dependencies Deliberately

Before adding a dependency, verify that the need is current, the existing stack cannot solve it simply, and the maintenance cost is justified. A small owned helper is often preferable to a new library.

## Document Decisions at the Right Time

Document product intent before implementation, but document technical design after a decision is made.

Product requirements may describe future user behavior. Technical documentation must describe implemented architecture and established engineering rules. Do not turn future requirements into speculative database tables, packages, domain types, services, authorization models, provider strategies, or integration internals.

When implementing a new capability:

1. Start from the product requirement and user journey.
2. Inspect the current architecture and conventions.
3. Design only the structures needed for the current change.
4. Implement and test the change.
5. Update technical documentation to record the decision that was made.
