# Finsight Web

React + TypeScript + Vite frontend for Finsight.

## Stack

- React, TypeScript, and Vite
- TanStack Router for file-based routing
- TanStack Query for server state
- `openapi-typescript` and `openapi-fetch` for typed API access
- `react-i18next` and `i18next` for UI translations
- Tailwind CSS and shadcn/ui with Radix primitives
- React Hook Form and Zod for forms
- TanStack Table for data tables
- Recharts for MVP charts
- Vitest and Playwright for tests

## Local Development

From the repository root:

```bash
make dev
```

This starts PostgreSQL and the Go API with Docker Compose, then starts the Vite dev server in the foreground.

To run only the web app:

```bash
pnpm -C apps/web dev
```

The Vite dev server proxies `/api`, `/health`, and `/ready` to `http://localhost:8080`.

## API Types

The OpenAPI contract lives at `../../openapi/finsight.yaml`.

Regenerate frontend API types after OpenAPI changes:

```bash
pnpm -C apps/web openapi:gen
```

Generated files live in `src/api/generated` and should not be edited manually.
Runtime enum values are emitted from OpenAPI so UI option lists can be derived from the backend contract.

## Current Screens

The portfolio screen loads total value, daily value history, and account values from the real HTTP API and supports account creation. Global asset search also uses the API.

The Imports, Agents, and Settings routes currently display placeholder pages. Their future implementation details are intentionally not defined here.

## Checks

```bash
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build
pnpm -C apps/web test:e2e
```
