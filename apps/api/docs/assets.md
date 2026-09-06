# Assets

The current asset package contains two distinct capabilities: provider-backed search and internal asset persistence.

## Provider-Backed Search

The running HTTP application wires `asset.Finder` to the Yahoo adapter. Search maps provider-specific results into Finsight's provider-neutral `AssetCandidate` shape and does not persist the returned candidates.

```text
GET /api/assets/search
→ HTTP handler
→ asset.Finder
→ asset.Provider
→ Yahoo adapter
→ normalized candidates
```

`asset.Provider` is the consuming boundary used by the finder:

```go
type Provider interface {
    SearchAssets(ctx context.Context, query string, limit int) ([]AssetCandidate, error)
}
```

The Yahoo adapter calls Yahoo's public search endpoint with the incoming request context and an adapter-owned timeout. It maps available fields and leaves unavailable optional values absent. It currently does not make a second ticker-detail request, so currency is absent from Yahoo search results.

Current quote-type mappings are:

- `EQUITY` → `EQUITY`
- `ETF` → `ETF`
- `MUTUALFUND` → `MUTUAL_FUND`
- `CRYPTOCURRENCY` → `CRYPTO`
- Other values → `OTHER`

### HTTP Contract

Endpoint:

- `GET /api/assets/search?q={query}&limit={limit}`

Response values are `name`, `symbol`, `asset_type`, `currency`, `provider_id`, `provider_symbol`, and `exchange`.

Input rules:

- `q` is trimmed and must contain at least two characters.
- `limit` defaults to `10` and must be between `1` and `20`.

Errors:

- `400 invalid_request`: input violates the OpenAPI contract or search validation.
- `502 asset_provider_unavailable`: Yahoo search failed.
- `500 asset_search_failed`: another unexpected search failure occurred.

## Internal Persistence

PostgreSQL has an implemented `assets` table, generated sqlc queries, and an `asset.Store`. The store normalizes durable asset input, calls sqlc directly, and upserts provider or cash assets for a workspace. Transaction persistence verifies that referenced assets belong to the transaction's workspace.

This persistence capability is not exposed through the current HTTP contract, and the HTTP search path does not call it. The demo seed command writes deterministic durable assets as part of its own current seeding workflow.

Migrations, generated sqlc code, and the current feature types are the source of truth for stored fields and constraints.
