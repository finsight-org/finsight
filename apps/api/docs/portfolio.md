# Portfolio Values

Portfolio values are read-only derived views. Transactions and ledger entries remain the source of truth; the portfolio service derives current value, value history, and account values from confirmed ledger entries plus market prices.

The first implementation is intentionally CAD-only. Non-CAD records are excluded from calculations and returned as warnings so the data model can remain multi-currency-ready without implementing FX conversion in this slice.

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

- `GET /api/portfolio/overview`
- `GET /api/portfolio/value-history?range=1Y`
- `GET /api/portfolio/account-values`

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
2. Summing CAD cash ledger entries per account.
3. Summing asset quantities per account and asset.
4. Applying the latest CAD market price on or before the valuation date.
5. Returning missing-price and unsupported-currency warnings when data is incomplete.

Value history uses the same valuation logic for each daily point in the selected range. It is account/portfolio value over time, not time-weighted return.
