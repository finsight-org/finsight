# Finsight MVP

## Goal

Validate that users can import investment data once and access it through AI agents.

The MVP is not intended to match the full feature depth of Ghostfolio, Portfolio Performance, or professional portfolio management software at launch.

The MVP proves three core assumptions:

1. Users want AI-assisted investment imports.
2. Users want to interact with their portfolio through AI.
3. Users value owning and controlling their financial data.

---

# Success Criteria

A user can:

1. Upload a broker statement, CSV export, XLSX export, or PDF.
2. Review and approve extracted transactions.
3. Store investment data in Finsight.
4. Connect an AI agent through MCP.
5. Ask questions about their portfolio.

Example:

> Upload Wealthsimple statement

↓

> Review extracted transactions

↓

> Connect ChatGPT

↓

> "What is my exposure to US technology stocks?"

Broker, provider, and AI product names in these documents are examples only unless explicitly listed as supported integrations.

---

# Product Scope

## Included

### Investment Data Management

- Create accounts
- Manage assets
- Store transactions
- Calculate positions
- Calculate cash balances
- Multi-currency support

The MVP uses one internal default portfolio per workspace to group accounts. Portfolio management is not user-facing in the MVP.

### AI Imports

Supported inputs:

- CSV
- XLSX
- PDF

Import flow:

```text
Upload
→ Extraction
→ Review
→ Confirmation
→ Save
```

### Portfolio Summary

Minimal portfolio overview:

- Total portfolio value
- Asset allocation
- Account allocation
- Cash balances
- Simple portfolio performance

### MCP Integration

Expose read-only portfolio, account, position, cash balance, transaction, and exposure data through MCP tools.

### Connected Agents

Users can connect AI agents such as:

- ChatGPT
- Claude
- Gemini
- Local LLMs

MVP agent access is read-only, workspace-scoped, token-based, and audited. Fine-grained agent permissions are deferred.

### Deployment Modes

- Cloud
- Self-hosted
- Local

---

# MVP Screens

## Portfolio Summary

Displays:

- Total portfolio value
- Allocation by asset class
- Allocation by account
- Cash balances
- Simple portfolio performance

## Imports

Displays:

- Import history
- Import status
- Validation issues

## Import Review

Displays:

- Extracted transactions
- Confidence scores
- Validation errors

Allows:

- Edit
- Approve
- Reject

## Accounts

Displays:

- Accounts
- Institutions
- Account currencies

## Connected Agents

Displays:

- Connected agents
- Connection status
- Available MCP tools

---

# Example Questions

The following questions should be answerable through MCP.

## Portfolio

- What is my portfolio worth?
- What are my largest positions?
- What is my allocation by asset class?
- What is my allocation by country?
- What is my allocation by currency?

## Risk

- How concentrated is my portfolio?
- What is my exposure to technology stocks?
- What is my exposure to USD?

## Performance

- What are my best-performing positions?
- What are my worst-performing positions?
- What is my current portfolio performance?

## Cash

- How much CAD cash do I have?
- How much USD cash do I have?

## Imports

- What transactions were imported?
- Which transactions require review?
- Why was this transaction rejected?

## News & Context

Using portfolio data exposed through MCP, AI agents should be able to answer questions such as:

- What are the recent news related to my holdings?
- How could the latest Fed decision impact my portfolio?
- What major events should I be aware of based on my investments?

Finsight is responsible for exposing portfolio data. News retrieval and analysis are handled by the AI agent.

---

# Non Goals

The MVP is not:

- A trading platform
- A tax optimization platform
- A portfolio optimization platform
- A financial advisor
- A broker synchronization platform
- A broker API import platform
- A screenshot import platform
- A manual transaction entry platform
- A portfolio management interface
- A fine-grained agent permission system
- An OpenAPI-first integration platform
- A mobile application
- A social investing platform
- A full replacement for mature portfolio management software in the first MVP release
