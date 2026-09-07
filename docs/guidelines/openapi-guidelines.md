# OpenAPI Workflow

Finsight is OpenAPI-first. The HTTP contract lives in:

```text
openapi/finsight.yaml
```

The OpenAPI spec is the source of truth for HTTP paths, request shapes, response shapes, and status codes.

This contract currently connects the Finsight web application and Go API. Using OpenAPI internally does not by itself make every endpoint a stable, externally supported integration platform; such a product commitment must be made separately.

## Generated Go Code

Generated Go server interfaces and types live under:

```text
apps/api/internal/openapi/generated
```

Do not edit generated files manually.

The generated code is the HTTP boundary. Runtime middleware validates incoming requests against the embedded specification. Handwritten handlers adapt generated request and response types to feature packages and concrete types; business logic stays outside generated code.

## Regenerate Code

After changing the OpenAPI spec, regenerate from the API module:

```bash
cd apps/api
go generate ./...
```

The generator is invoked by `go generate` with a pinned `go run ...@version` command, so the CLI does not become an application runtime dependency. The same command also regenerates sqlc database query code; see [Database Guidelines](database-guidelines.md).

The underlying OpenAPI generation command is:

```bash
go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.5.0 -config openapi/oapi-codegen.yaml ../../openapi/finsight.yaml
```

## Generator Choice

Finsight uses `oapi-codegen` because it generates Go types and server interfaces without forcing a heavy framework. This matches the current Go API skeleton, which uses the standard library HTTP router.

## Implementation Pattern

The current implementation flow is:

```text
openapi/finsight.yaml
-> go generate ./...
-> apps/api/internal/openapi/generated
-> handwritten adapter in apps/api/internal/httpapi
-> feature package/type
```

Keep these boundaries:

- OpenAPI defines HTTP contracts.
- Generated code defines HTTP boundary types and interfaces.
- OpenAPI middleware rejects contract violations with `invalid_request`.
- `internal/httpapi` owns transport mapping and HTTP responses.
- Feature types and functions own business workflows and call sqlc or provider adapters.
