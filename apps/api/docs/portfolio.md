# Portfolio Values

Portfolio values are read-only derived views. Transactions and ledger entries remain the source of truth; the portfolio service derives current value, value history, and account values from confirmed ledger entries plus market prices and FX rates.

Values are reported in the selected portfolio base currency. Cash ledger amounts and priced asset market values are converted with direct FX rates into that base currency when needed. Missing prices or FX rates are returned as warnings and the incomplete values are excluded from totals rather than estimated.

## Demo Seed

Create deterministic local demo data:

```bash
make seed-demo
```

Or from the API module:

```bash
FINSIGHT_DATABASE_URL=postgres://finsight:finsight@localhost:5432/finsight?sslmode=disable go run ./cmd/finsight-seed-demo
```

The seed command:

- Bootstraps the local workspace and default portfolio.
- Upserts demo accounts and assets.
- Replaces only demo-marked transactions and market prices.
- Preserves non-demo user data.

Demo records use stable markers such as `source = 'DEMO'`, `external_id = 'finsight-demo:*'`, `provider_id = 'demo'`, and account `external_reference = 'finsight-demo:*'`.

## Endpoints

Canonical endpoints:

- `GET /api/portfolios/{portfolio_id}/overview`
- `GET /api/portfolios/{portfolio_id}/value-history?range=1Y`
- `GET /api/portfolios/{portfolio_id}/account-values`

In local deployment mode, the API reads the default portfolio ID from PostgreSQL for each request and only allows that ID. The unscoped `GET /api/portfolio/overview`, `GET /api/portfolio/value-history`, and `GET /api/portfolio/account-values` endpoints are temporary compatibility routes; they resolve that default ID and delegate to the same valuation service.

Supported ranges:

- `1D`
- `1W`
- `1M`
- `3M`
- `YTD`
- `1Y`
- `ALL`

## Calculation Notes

Current value is calculated by:

1. Loading confirmed ledger entries up to the valuation date.
2. Summing cash ledger entries per account, converting non-base-currency cash with the latest direct FX rate on or before the valuation date.
3. Summing asset quantities per account and asset.
4. Applying the latest market price on or before the valuation date.
5. Converting non-base-currency market values with the latest direct FX rate on or before the valuation date.
6. Returning missing-price and missing-FX warnings when data is incomplete.

Value history uses the same valuation logic for each daily point in the selected range. It is account/portfolio value over time, not time-weighted return.
