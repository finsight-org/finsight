# Frontend Principles

## Boundary

The frontend lives in `apps/web` and is responsible for presentation,
interaction, forms, loading states, and user workflows.

Frontend code may:

- Call the OpenAPI HTTP API.
- Use generated OpenAPI types.
- Use client-side validation for usability.
- Format data for display.

Frontend code must not:

- Query PostgreSQL.
- Call market data providers directly.
- Call the MCP server.
- Reimplement authoritative financial calculations.
- Depend on provider-specific backend internals.

## Feature Organization

Use the existing layout:

- `src/api`: endpoint wrappers, query keys, and TanStack Query hooks.
- `src/api/generated`: generated OpenAPI TypeScript types.
- `src/app`: providers, router setup, and query client.
- `src/components/ui`: shared reusable primitives.
- `src/components/layout`: app-level layout.
- `src/features/<feature>`: feature-specific UI and tests.
- `src/i18n`: user-facing strings.
- `src/routes`: route definitions.

Keep feature components close to their tests. Extract shared components only
when reuse is real.

## Server State

- Use TanStack Query for server state, loading, errors, mutations, and
  invalidation.
- Use stable query keys and export them when reused.
- Avoid copying server data into local state unless the user is editing a draft.
- Use local state for UI-only concerns such as dialogs, selected tabs, and form
  drafts.

## API Types

Generated TypeScript API types live in `apps/web/src/api/generated` and must not
be edited manually.

After changing `openapi/finsight.yaml`, run:

```bash
pnpm -C apps/web openapi:gen
```

Prefer generated request, response, and enum types over duplicated unions.

## UI Text And Tests

- Put user-facing strings in i18n resources.
- Show clear loading, empty, and error states for server-backed screens.
- Keep mock data isolated and replace it when real endpoints exist.
- Test visible behavior with Vitest and Testing Library.
- Use Playwright for important workflows that cross routing, API, or rendering
  boundaries.
