# FinSight

Open-source financial connectors for AI agents.

This bootstrap uses TypeScript, Fastify, and GraphQL Yoga. It exposes a single
greeting query so the server and GraphQL setup can be developed independently
of financial providers.

## Run locally

Requires Node.js 24 LTS and npm. If you use nvm, run `nvm use` first.

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:4000/graphql](http://127.0.0.1:4000/graphql) to use the
built-in GraphiQL explorer:

```graphql
query {
  hello
}
```

Response:

```json
{
  "data": {
    "hello": "FinSight"
  }
}
```

The same query can be sent directly over HTTP:

```sh
curl http://127.0.0.1:4000/graphql \
  -H 'Content-Type: application/json' \
  --data '{"query":"{ hello }"}'
```

Use `PORT=4001 npm run dev` to choose another port. The server listens on the
local loopback address.

## Build

```sh
npm run typecheck
npm run build
npm start
```

## Files

- `src/main.ts` reads the port, starts the server, and handles shutdown.
- `src/app.ts` creates Fastify and serves GraphQL Yoga at `/graphql`.
- `src/schema.ts` defines the GraphQL schema and its resolver functions.

The request flow is `Fastify → GraphQL Yoga → schema resolver → JSON response`.
This bootstrap contains no providers, financial data, or authentication yet.
