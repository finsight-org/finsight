# Wealthsimple API exploration

These examples were independently built and tested against Wealthsimple through
a connected local FinSight server on 2026-10-04. Each final reference document
returned HTTP 200 with data and no GraphQL errors. Only query documents and
non-personal observations are recorded here; no account IDs, holdings, balances,
credentials, or live response bodies are saved.

## Reference documents

All nine files are in `src/providers/wealthsimple/reference`. A file can contain
several named examples and any fragments they need. Submit the full text in a
normal POST envelope with `query`, `operationName`, and `variables`; select the
desired operation by name. The portfolio file contains two operations.

| File / operation | Responsibility | Variables to supply |
| --- | --- | --- |
| `accounts.graphql` / `AccountInventory` | Account IDs, types, status, currencies, balances, deposits and withdrawals | None required; optional `first`, `after` |
| `account-details.graphql` / `AccountDetails` | One account's dates, enabled features and custodian financials | `accountId` from the inventory |
| `portfolio.graphql` / `PortfolioSnapshot`, `InvestmentPerformance` | Portfolio totals, or totals together with per-asset cost, value and unrealized gains | Both: optional `currency`, `accountIds`; snapshot: `since`; performance: `first`, `after` |
| `positions.graphql` / `HoldingInventory` | Quantities, account membership, book/market value, average price and unrealized returns | Optional `currency`, `accountIds`, `first`, `after`, `aggregated` |
| `activities.graphql` / `RecentActivity` | Recent events, merchant, amounts, status, account and asset links | Optional `first`, `after`, `condition` |
| `performance-history.graphql` / `PortfolioHistory` | Daily valuation and net deposits | `start`, `end`; optional `currency`, `accountIds`, `first`, `after` |
| `income.graphql` / `InvestmentIncome` | Dividends and realized returns, including security breakdowns | Optional `currency`, `accountIds`, `since`, `first`, `after` |
| `security-search.graphql` / `FindSecurities` | Search for securities and discover IDs and eligibility | `term`, tested with `"VFV"` |
| `security-research.graphql` / `SecurityResearch` | Security metadata, fundamentals and timestamped quotes | `securityId` from search or a holding |

FinSight supplies `identityId` to identity-scoped queries. Currency defaults to
`CAD`; `USD` also succeeded for a portfolio snapshot. JSON variables use
`"currency": "USD"`, whereas an enum literal inside GraphQL is written `USD`.
Dates use strings such as `"2026-01-01"`. Passing null to a required currency
variable failed, even when that variable declared a default.

History was tested with `{"start":"2026-09-01","end":"2026-09-04","first":2}`;
income with `{"since":"2026-01-01","first":2}`. An account-scoped portfolio
snapshot also succeeded. The `accountIds` input is a list, even for one account.
Small page sizes were used for live exploration; the examples default to 20.

## Pagination and composition

Account, holding, activity and history continuation requests succeeded using
the previous response's `pageInfo.endCursor`. Check `hasNextPage` before continuing
and keep the other filters unchanged. Cursors are opaque: use `String` for
accounts, positions, history and realized-return breakdowns, and `Cursor` for
activities. FinSight does not fetch subsequent pages automatically.

The realized-return security connection accepted `first` and `after`, but was
empty in the tested date window. Its node selection validated; nonempty nodes
and subsequent pages were not observed. The dividend breakdown was populated
and is a list, without pagination in this example. Security search likewise
returns a list in these examples.

Use account IDs from inventory to scope financial queries, and security IDs from
holdings or search to request research. The references are deliberately small:
combine selections under a shared `identity` or `financials` root, reuse the
`HoldingAmounts` and `IncomeSecurity` fragments, or remove unwanted selections.
Keep variable declarations and fragment definitions when composing documents;
rename aliases when requesting the same field with different arguments.

Both values of `aggregated` succeeded for positions. Activity `condition` was
tested omitted and as `{}`. Guessed account-filter keys and position-sort values
failed; these examples do not claim support for unverified filter keys or enums.

## Latest credit-card purchase

1. Use `AccountInventory` to find the open `CREDIT_CARD` account's ID.
2. Run `RecentActivity` in descending occurrence order. In the returned data,
   match that `accountId`, `type: "CREDIT_CARD"`, and `subType: "PURCHASE"`.
3. The first matching entry is the latest purchase in that feed order. Read
   `spendMerchant`, `occurredAt`, `amount`, `amountSign`, `currency`, and `status`.
   Follow `pageInfo.endCursor` if the first page contains no matching purchase.

This matching is performed by the caller; FinSight forwards the native query.
It avoids inventing an upstream account filter. Merchant data was populated for
a live credit-card purchase. `authorized` is the reported authorization status;
it does not confirm that the purchase has posted. Convert the UTC occurrence
timestamp to the user's time zone when displaying it.

## Overall and per-asset performance

Select `InvestmentPerformance` from `portfolio.graphql`. Supply the IDs of the
investment accounts you intend to analyze, excluding cash and credit-card
accounts when answering an investment-only question. The combined query was
tested with the open self-directed TFSA and crypto accounts. Paginate holdings
if `hasNextPage` is true before presenting a complete asset breakdown.

- Use `simpleReturns.amount` for Wealthsimple's reported account-level gain or
  loss. Its `rate` is a fraction: multiply by 100 for a percentage, so a generic
  example rate of `0.025` means `2.5%`.
- Use `bookValue`, `totalValue`, and `unrealizedReturns` for current holdings.
  Calculate holding return percent as `unrealizedReturns.amount / bookValue.amount
  * 100`, after checking that both amounts have the same currency. A zero book
  value makes that percentage undefined.
- Holdings' unrealized returns exclude dividends and realized gains. Use
  `InvestmentIncome` separately for those components; do not expect the holdings
  table to reconcile exactly to the account-level return.
- Inspect `referenceDate` to explain the reporting period. With no date supplied,
  the live account-level return used `1970-01-01` as its default reference date;
  this is not the account opening date. This query does not establish an annualized
  or time-weighted return. Its holding returns are relative to current book value,
  rather than a matching historical-period calculation.

These calculations and presentation choices belong to the caller. FinSight
continues to return native GraphQL data without calculating financial metrics.

## Observed response behavior

- Money `amount`, position quantities, return rates and quote numbers arrived as
  strings. Preserve their precision and accompanying currency; activity amounts
  additionally expose `amountSign`.
- Account nicknames, dates and some financial metadata can be null. Cash events
  had null asset/security fields. A nullable object must be handled before reading
  its children.
- `simpleReturns` exposes its actual `referenceDate`; `asOf` was null in one
  successful response. Do not invent a timestamp or infer annualized returns.
- Security research was exercised on an equity/ETF. The quote was `EquityQuote`;
  equity-only fields use an inline fragment. Other quote variants were not tested.
  `managementExpenseRatio` was null despite a successful fundamentals response.
- A deliberately unknown security ID returned null while an aliased valid
  security in the same request still returned data, without an error in that probe.
  Successful HTTP status does not guarantee that every selected object exists.

## Validation behavior

These are observed results, rather than a local schema or validation contract:

| Probe | Result |
| --- | --- |
| `__schema` introspection | HTTP 403; `INTROSPECTION_DISABLED`, message `Introspection queries are disabled` |
| Unknown root/financial fields | HTTP 200; `UNPROCESSABLE_ENTITY` GraphQL errors, no field suggestions |
| Invalid currency enum, null required currency, guessed position sort | HTTP 200; generic `UNPROCESSABLE_ENTITY` errors |
| Invalid activity-condition key | HTTP 200; errors plus `data.activityFeedItems: null` |
| Missing required security argument | HTTP 200; generic `UNPROCESSABLE_ENTITY` error |
| Two named query operations without `operationName` | The first operation executed in the tested request |
| Explicit `operationName` selecting the second operation | The selected operation executed |
| Unknown `operationName` | HTTP 400; `OPERATION_RESOLUTION_FAILURE`, message `Failed to normalize GraphQL operation` |
| Malformed syntax or a document containing a mutation | Local HTTP 400 with a safe FinSight error |

Always provide `operationName` for predictable selection. `__typename` succeeded
on normal selected objects even though schema introspection is disabled. Error
messages can be terse: start from a tested query, change one selection or variable
at a time, and inspect both `data` and `errors`. FinSight forwards native responses
and statuses rather than interpreting financial data or validating the graph.

References are documentation, not an allowlist or operations executable by ID.
They are loaded when the provider starts; file edits appear in GET documentation
after a server restart, which also requires reconnecting the memory-only session.
