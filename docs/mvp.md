# Finsight MVP

## Goal

The MVP validates that users can bring investment data into Finsight once, verify it, understand their portfolio at a high level, and make useful portfolio information available to an AI agent.

The MVP is complete when the capabilities below work together as a coherent user experience. It is not intended to match mature portfolio-management or professional analysis software.

## Required Capabilities

### Accounts

Users can create investment accounts and view the information needed to understand where their investments are held, including the account name, institution, type, currency, and contribution to portfolio value.

Finsight prevents confusing duplicate account names within the account list presented to the user. Portfolio management itself is not user-facing in the MVP.

### Investment Data Import

Users can import investment data from supported CSV, XLSX, and PDF files.

Every import follows a safe, reviewable flow:

```text
Upload
→ Extract
→ Review
→ Confirm
→ Include in portfolio
```

Users can correct or ignore extracted data before confirmation. Imported data must not affect the portfolio until the user confirms it.

### Derived Portfolio Information

Confirmed financial records are the source for portfolio calculations. Holdings, cash balances, allocations, and portfolio values are derived rather than maintained manually.

Market prices and foreign-exchange rates enrich those calculations but do not replace the user's financial records. When required market or FX data is missing, Finsight communicates that the result is incomplete instead of silently estimating it.

### Portfolio Summary

Users can view a simple portfolio summary containing:

- Total portfolio value.
- Portfolio value history.
- Holdings and largest positions.
- Allocation by account, asset class, and currency.
- Cash balances.
- Warnings for incomplete market or FX data.

Portfolio value history shows how the value of the portfolio changed over time. It is not an investment-return calculation and does not imply time-weighted return, money-weighted return, gain/loss attribution, or performance against a benchmark.

### Multiple Currencies

Financial records can use multiple currencies. Finsight presents portfolio values in a selected base currency when the required conversion data is available and clearly identifies values that could not be converted.

### Read-Only AI Access

Users can connect a compatible AI agent through MCP and allow it to read useful portfolio, account, holding, cash, transaction, and exposure information.

AI access is read-only in the MVP. Finsight supplies structured portfolio information; the connected agent is responsible for reasoning, explanations, and any external context such as news.

### Local Operation and Data Ownership

Users can run Finsight locally without creating or depending on a managed Finsight account. Their portfolio data remains under their control in the deployment they operate.

## Example Outcomes

A user can:

1. Create an investment account.
2. Upload a supported broker statement or export.
3. Review and confirm the extracted financial data.
4. See the resulting portfolio value, value history, accounts, holdings, and cash information.
5. Connect a compatible AI agent and ask questions such as:
   - What is my portfolio worth?
   - What are my largest positions?
   - How concentrated is my portfolio?
   - What is my exposure to USD or a particular sector?
   - How much cash do I hold in each currency?

Specific brokers, providers, and AI products are examples unless explicitly listed as supported integrations.

## Non-Goals

The MVP is not:

- A trading platform.
- A financial advisor.
- A tax, portfolio-optimization, or scenario-simulation platform.
- A broker synchronization or broker API import platform.
- A screenshot import platform.
- A manual transaction entry platform.
- A user-facing portfolio management interface.
- A fine-grained AI permission system.
- A general externally supported OpenAPI integration platform merely because the web application uses an OpenAPI contract internally.
- A source of news or other external analysis performed by the connected AI agent.
- A provider of time-weighted, money-weighted, benchmark, realized-return, or other investment-performance calculations.
- A mobile or social-investing application.
- A full replacement for mature portfolio-management software.
