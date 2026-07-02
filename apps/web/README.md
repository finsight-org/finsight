# Finsight Web

React + TypeScript + Vite frontend for Finsight.

## Stack

- React, TypeScript, and Vite
- TanStack Router for file-based routing
- TanStack Query for server state
- `openapi-typescript` and `openapi-fetch` for typed API access
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

## Checks

```bash
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build
pnpm -C apps/web test:e2e
```

Portfolio chart and summary values are temporary mock data until portfolio summary endpoints exist. Account data is loaded from the real HTTP API.
