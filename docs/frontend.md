# Frontend Architecture

The Finsight web app lives in `apps/web` and is a client-side React application built with Vite.

The frontend calls only the OpenAPI HTTP API. It must not query PostgreSQL, call market data providers directly, call the MCP server, or implement financial business rules. Client-side validation is only for usability; backend validation is authoritative.

OpenAPI types are generated from `openapi/finsight.yaml` with `openapi-typescript`, and API requests use `openapi-fetch`. TanStack Query owns server-state caching, loading states, mutations, and refetching.

The first portfolio screen uses real account API data and temporary mock chart/summary data. Replace the mock portfolio module when portfolio summary and performance endpoints are added.
