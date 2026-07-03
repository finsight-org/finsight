# Testing Principles

## General Rule

Tests should be proportional to risk and close to the behavior being changed.
They should validate observable behavior rather than duplicate implementation
details.

## Backend

Add focused Go tests for:

- Service validation and business rules.
- Expected domain errors.
- HTTP status codes and `ErrorResponse` mapping.
- Repository mapping and database error translation when meaningful.
- Migration startup behavior when schema handling changes.

Run:

```bash
cd apps/api && go test ./...
```

## Frontend

Add frontend tests for:

- Visible user behavior.
- Loading, empty, and error states.
- Mutations and invalidation when non-trivial.
- API wrapper behavior when mapping or error handling is meaningful.

Run relevant checks:

```bash
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build
```

Use Playwright for important workflows that cross routing, API, or rendering
boundaries:

```bash
pnpm -C apps/web test:e2e
```

## OpenAPI And Generated Code

When OpenAPI changes, test both sides of the contract:

- Backend handler/service behavior.
- Frontend typecheck and API wrapper usage.

Generated files should be reviewed for expected changes but not manually edited.

## Documentation

Documentation-only changes usually need link and consistency checks, not Go or
frontend tests. Run code tests only when docs include runnable examples or
change development workflows in a way that needs verification.
