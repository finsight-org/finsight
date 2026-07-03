# API Principles

## OpenAPI First

`openapi/finsight.yaml` is the source of truth for HTTP paths, operation IDs,
request bodies, response bodies, status codes, and shared schemas.

When the contract changes:

1. Update `openapi/finsight.yaml`.
2. Regenerate backend code with `cd apps/api && go generate ./...`.
3. Regenerate frontend types with `pnpm -C apps/web openapi:gen`.
4. Update handlers, services, frontend wrappers, and tests in the same change.

## Endpoint Design

- Use stable nouns that match Finsight domain concepts.
- Keep endpoints resource-oriented and explicit.
- Use clear request and response schemas.
- Document expected success and error statuses.
- Prefer focused endpoints over overloaded mode-heavy endpoints.
- Return domain-oriented responses, not database rows.

Do not expose persistence details, generated database models, provider-specific
responses, or frontend-only view models in the API contract.

## Request And Response Shapes

- Keep required fields explicit.
- Use enums for closed sets.
- Use UUID strings at the HTTP boundary.
- Use ISO currency codes as strings unless a stronger shared type is introduced.
- Use `date` and `date-time` formats deliberately.

## Errors

Use the existing `ErrorResponse` shape unless there is a deliberate contract
change:

```yaml
error:
  code: string
  message: string
```

Error responses should:

- Use stable machine-readable `code` values.
- Keep `message` useful without exposing internals.
- Map expected service errors to appropriate HTTP status codes.
- Preserve useful internal logging without changing the public error contract.

## Handler Boundary

HTTP handlers adapt. They should not contain financial business rules, SQL,
provider calls, or calculations that belong in services.
