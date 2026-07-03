# Engineering Principles

This document defines how contributors should make implementation decisions. It is intentionally about engineering practice, not product scope. Product and domain direction live in [Vision](../vision.md), [MVP](../mvp.md), [Use Cases](../use-cases.md), and [Domain Model](../domain-model.md).

## Coding Philosophy

- Choose simplicity over cleverness.
- Choose explicit code over magic.
- Choose readability over unnecessary abstraction.
- Prefer composition over inheritance.
- Avoid premature abstractions.
- Avoid unnecessary third-party dependencies.
- Optimize for maintainability first. Performance matters, but not at the cost of unclear architecture.
- AI-generated code should be indistinguishable from code written by an experienced engineer.

Good code in this repository is direct, boring, easy to test, and easy to remove.

## Architectural Discipline

Finsight is a modular monolith. Keep module boundaries clear inside the monolith instead of creating distributed-system complexity.

Implementation rules:

- Put business rules in application/domain services.
- Keep HTTP/API layers thin.
- Keep frontend components focused on presentation and interaction.
- Keep persistence behind repositories.
- Keep generated code at the boundary.
- Keep provider-specific details behind adapters.
- Keep dependencies flowing inward toward domain behavior.

## Incremental Change

Prefer small vertical slices over broad rewrites.

A good change usually:

- Solves one user or contributor problem.
- Touches the fewest packages that can correctly implement the behavior.
- Adds tests near the behavior being changed.
- Leaves unrelated structure alone.
- Updates documentation only when expectations or workflows change.

Avoid speculative cleanup during feature work. Refactor only when it directly supports the change or removes current, demonstrated complexity.

## Testability

Testability is a design constraint, not an afterthought.

- Services should be testable with interfaces or small fakes.
- Handlers should be testable without a real browser.
- Repository logic should isolate database mapping and persistence concerns.
- Frontend features should be testable through visible behavior.
- End-to-end tests should cover important workflows, not every component state.

Tests should make behavior safer to change. Avoid tests that simply mirror implementation details.

## Dependency Policy

Before adding a dependency, confirm that:

- The problem is real and current.
- The existing stack cannot solve it simply.
- The dependency is maintained and appropriate for the repository.
- The dependency does not pull business logic into a framework boundary.
- The long-term maintenance cost is justified.

Small helper functions are often better than new libraries.

## Pull Request Expectations

A pull request is acceptable when:

- It follows the documented architecture and codebase boundaries.
- It is scoped to the requested change.
- It includes tests proportional to risk.
- It keeps generated code generated.
- It avoids unrelated formatting churn.
- It names tradeoffs clearly when the implementation is intentionally minimal.
- It documents new workflows, contracts, or contributor expectations.

Reviewers should prioritize correctness, maintainability, boundary discipline, and whether the code can evolve without surprise.
