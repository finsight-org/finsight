# Finsight Use Cases

## Purpose

This document defines the main user flows for the Finsight MVP.

The goal is to align product, UX, domain model, MCP contracts, and implementation before architecture definition starts.

Finsight MVP is centered around one core idea:

> Import investment data once, then make it available to humans and AI agents.

The product is not a traditional portfolio dashboard. The UI exists mainly to help users import data, review it, understand their portfolio at a high level, and connect AI agents through MCP.

---

# Product Navigation Model

Finsight uses a simple navigation model.

```text
Portfolio Summary
├── Accounts
├── Imports
├── Connected Agents
```

## Main Areas

### Portfolio Summary

Shows the user’s overall portfolio situation:

- total portfolio value
- allocation by asset class
- allocation by account
- allocation by currency
- cash balances
- simple performance

### Accounts

Shows where assets and cash are held.

Examples:

- Wealthsimple
- Interactive Brokers
- Binance
- Manual account

Broker and provider names are examples only unless explicitly listed as supported integrations.

### Imports

Allows the user to upload, review, and confirm imported investment data.

### Connected Agents

Allows the user to connect AI agents through MCP.

Examples:

- ChatGPT
- Claude
- Gemini
- local LLMs

AI product names are examples only unless explicitly listed as supported integrations.

---

# Global UX Principles

## Keep the UI as a control panel

Finsight UI is not the main analysis interface.

The UI should focus on:

- importing data
- reviewing extracted data
- managing accounts
- showing a simple portfolio summary
- connecting AI agents

Deep analysis should happen through AI agents.

---

## Make imports safe and reviewable

No imported transaction should be saved immediately.

The import flow must always include:

```text
Upload
→ Extraction
→ Review
→ Confirmation
→ Save
```

Nothing modifies the portfolio until the user confirms.

---

## Use transactions as the source of truth

Finsight is transaction-first.

Positions, cash balances, allocations, and portfolio summaries are derived from transactions and ledger entries.

The UI can stay simple, but the internal model must remain financially rigorous.

---

## Keep AI access transparent

Users should understand when an AI agent is connected and when it accesses their data.

The MVP does not include fine-grained agent permissions, but it should still show:

- connected agents
- available MCP tools
- access history

MVP agent access is read-only, workspace-scoped, token-based, and audited.

---

## Avoid financial advice

Finsight and connected AI agents should help users understand their data.

The product should not present itself as a financial advisor.

---

# Use Case 1 — First-Time Setup

## Goal

Allow a new user to start using Finsight and create their first investment account.

## Main Path

1. User opens Finsight.
2. User creates an account or starts in local mode.
3. Finsight creates or uses a default internal portfolio for the workspace.
4. User lands on the Portfolio Summary.
5. Finsight shows an empty state.
6. User creates their first account.
7. User is invited to import investment data.

## Success State

- User has access to Finsight.
- User has created at least one account.
- User understands that they need to import data before seeing useful portfolio insights.

## Edge Cases

- If the user starts in local mode, Finsight creates a default local user, workspace, and internal portfolio.
- If the user has no accounts, the Portfolio Summary shows a clear empty state.
- If setup fails, Finsight shows a clear retry action.

---

# Use Case 2 — Create Account

## Goal

Allow the user to create an account where assets, transactions, and cash will be stored.

## Main Path

1. User opens the Accounts area.
2. User clicks **Create account**.
3. User enters:
   - account name
   - institution name
   - account type
   - account currency
4. User confirms.
5. Finsight creates the account.

## Success State

- The account exists.
- The account appears in the Accounts area.
- The account can receive imported transactions.

## Edge Cases

- Account name is required.
- Account currency is required.
- Duplicate account names should be avoided within the same workspace.
- If account creation fails, no partial account is created.

---

# Use Case 3 — Import Investment Data

## Goal

Allow the user to upload investment data from a broker statement or export.

## Supported Inputs

- CSV
- XLSX
- PDF

## Main Path

1. User opens the Imports area or starts an import from an account.
2. User selects the target account.
3. User uploads a supported file.
4. Finsight creates an import.
5. Finsight extracts candidate transactions from the file.
6. Finsight detects assets, quantities, amounts, currencies, dates, fees, and cash movements when possible.
7. Finsight marks extracted rows as ready for review or requiring attention.
8. User moves to Import Review.

## Success State

- The file is uploaded.
- Extracted import items are created.
- No transactions are saved yet.
- User can review the extracted data before confirmation.

## Edge Cases

- Unsupported file type.
- File too large.
- File cannot be read.
- No recognizable investment data found.
- Some rows have low confidence.
- Asset cannot be matched.
- Currency cannot be detected.
- Duplicate rows are detected.

---

# Use Case 4 — Review Import

## Goal

Allow the user to review extracted data before it becomes real transactions.

## Main Path

1. User opens an import ready for review.
2. User sees extracted rows grouped by status:
   - ready
   - needs review
   - ignored
3. User reviews extracted rows.
4. User can:
   - edit a row
   - approve a row
   - ignore a row
5. Finsight validates all required fields.
6. When all required rows are resolved, user confirms the import.
7. Finsight creates transactions and ledger entries.
8. Portfolio summary is recalculated.

## Success State

- User understands what will be imported.
- Transactions are created only after confirmation.
- Positions and cash balances are updated from ledger entries.
- Import status becomes confirmed.

## Edge Cases

- User leaves before confirming: no transactions are created.
- Import contains unresolved rows: confirmation is disabled.
- All rows are ignored: confirmation is disabled.
- Confirmation fails: review state is preserved.
- Duplicate transactions are detected: user must review them.
- Asset matching is uncertain: user must select or create the correct asset.
- Currency is missing: user must provide or confirm it.

---

# Use Case 5 — Portfolio Summary

## Goal

Allow the user to understand their portfolio at a high level.

## Main Path

1. User opens Portfolio Summary.
2. Finsight loads confirmed transactions.
3. Finsight derives positions and cash balances.
4. Finsight uses market prices and FX rates when available.
5. User sees:
   - total portfolio value
   - allocation by asset class
   - allocation by account
   - allocation by currency
   - cash balances
   - simple performance

## Success State

- User can understand their portfolio value and allocation.
- User can identify largest positions and cash balances.
- User can see whether some data is incomplete.

## Edge Cases

- No accounts: show empty state.
- Accounts exist but no transactions: encourage import.
- Missing market price: show incomplete value warning.
- Missing FX rate: show currency conversion warning.
- Historical data incomplete: avoid implying precise performance.

---

# Use Case 6 — View Accounts

## Goal

Allow the user to see where their investments are held.

## Main Path

1. User opens Accounts.
2. User sees a list of accounts.
3. Each account shows:
   - name
   - institution
   - type
   - currency
   - current value
   - cash balances
4. User opens an account to see its positions and related imports.

## Success State

- User can understand which accounts contribute to the portfolio.
- User can start an import for a specific account.
- User can see account-level positions and cash.

## Edge Cases

- Account has no transactions.
- Account has missing prices or FX rates.
- Account no longer exists.
- User attempts to access an account they do not own.

---

# Use Case 7 — Connect AI Agent

## Goal

Allow the user to connect an AI agent through MCP.

## Main Path

1. User opens Connected Agents.
2. Finsight shows MCP connection instructions.
3. User connects an AI agent.
4. Finsight displays the connected agent.
5. The agent can call available read-only MCP tools.

## MVP MCP Tools

- get_portfolio_summary
- get_accounts
- get_positions
- get_cash_balances
- get_transactions
- get_asset_exposure

## Success State

- AI agent can access structured portfolio data.
- User can ask portfolio questions in the AI agent.

## Edge Cases

- MCP connection fails.
- Agent requests an unavailable tool.
- Agent requests data before imports exist.
- Local mode requires localhost connection instructions.
- Managed deployments require authenticated connection instructions.

---

# Use Case 8 — Ask Portfolio Questions Through AI

## Goal

Allow the user to use an AI agent as the primary analysis interface.

## Main Path

1. User opens ChatGPT, Claude, or another connected agent.
2. User asks a question about their portfolio.
3. The agent calls Finsight MCP tools.
4. Finsight returns structured portfolio data.
5. The agent answers using the returned data.

## Example Questions

- What is my portfolio worth?
- What are my largest positions?
- What is my exposure to USD?
- What is my exposure to technology stocks?
- How much CAD cash do I have?
- What are my recent imported transactions?
- What recent news could matter based on my holdings?
- How could the latest Fed decision impact my portfolio?

## Success State

- User receives a useful answer without manually exporting data.
- The answer is based on Finsight portfolio data.
- Finsight logs the agent request.

## Edge Cases

- Portfolio has no data.
- Requested analysis requires unavailable market data.
- Agent asks for news: Finsight provides holdings/assets; the agent retrieves news externally.
- Agent asks for financial advice: the response should stay educational and informational.
- Agent asks for unsupported actions such as trading or modifying data.

---

# Use Case 9 — Local Mode

## Goal

Allow users to run Finsight locally and keep their data on their own machine.

## Main Path

1. User starts Finsight locally.
2. Finsight runs in local auth mode.
3. Finsight creates or uses a default local workspace and internal portfolio.
4. User imports data.
5. User connects a local or desktop AI agent.
6. All portfolio data stays in the local deployment.

## Success State

- User can use Finsight without a managed-service account.
- User owns their data locally.
- Local AI agents can access Finsight through MCP.

## Edge Cases

- Local database is missing.
- Local MCP server is unavailable.
- User restarts the local deployment.
- User wants to export or back up local data.

---

# Use Case 10 — Error and Empty States

## Goal

Handle missing data and failures clearly.

## Empty States

### No Accounts

Explain that the user needs to create an account before importing investment data.

### No Imports

Explain that imports will appear after the first uploaded file.

### No Transactions

Explain that portfolio insights require imported or manually entered transactions.

### No Connected Agents

Explain how to connect an AI agent through MCP.

## Error States

### Import Error

Explain whether the problem is file type, file size, unreadable content, or missing recognizable data.

### Market Data Error

Explain that some prices are missing or delayed.

### FX Error

Explain that some currency conversions cannot be calculated.

### Agent Connection Error

Explain that MCP connection failed and provide retry/setup guidance.

### Unknown Error

Show a clear non-technical error and offer a safe retry action.

---

# Business Rules

## User and Workspace

- A user belongs to a workspace.
- A workspace owns a default internal portfolio in the MVP.
- The default portfolio owns accounts.
- Imports are traceable to the workspace and target account. The portfolio is inferred through the account.
- Transactions are traceable to the workspace, portfolio, and account.
- A user can only access data from their own workspace.
- Local mode can use a default local workspace and internal portfolio.

## Portfolio

- A portfolio groups accounts.
- The MVP creates or uses one default internal portfolio per workspace.
- Portfolio management is not user-facing in the MVP.
- Portfolio values are derived from accounts, transactions, prices, and FX rates.
- Portfolio summary is derived, not manually edited.

## Account

- An account belongs to a portfolio.
- An account has one base currency.
- An account can exist without transactions.
- Deleting an account should require confirmation.

## Asset

- Assets represent financial instruments or cash.
- Cash is modeled as an asset.
- Asset symbols alone may not be unique.
- Assets may require additional identifiers such as currency, exchange, or provider symbol.

## Transaction

- Transactions are the source of truth.
- Transactions create ledger entries.
- Transactions should not be created from imports until the user confirms review.

## Ledger Entry

- Ledger entries represent the financial impact of transactions.
- Positions and cash balances are derived from ledger entries.
- Cash is not manually maintained separately from ledger entries.

## Import

- Imports are reviewable.
- No imported data modifies the portfolio before confirmation.
- Low-confidence rows must be reviewed.
- Ignored rows are not imported.
- Confirmed imports are read-only.

## AI and MCP

- MCP tools are read-only in the MVP.
- Connected agents use read-only workspace-scoped access tokens in the MVP.
- Finsight exposes portfolio data; the agent performs reasoning.
- News retrieval is handled by the agent, not by Finsight.
- Agent access is logged.
- Finsight must not expose secrets through MCP responses.
- Fine-grained agent permissions are deferred.

## Market Data

- Market data should come through a provider abstraction.
- Missing prices must be visible to the user.
- Missing FX rates must be visible to the user.
- Market data is not the source of truth for user transactions.

## Security

- Sensitive data must not be exposed to other users.
- Local mode should not require a managed-service account.
- Managed deployments must require authentication.
