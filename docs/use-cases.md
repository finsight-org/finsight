# Finsight MVP Use Cases

## Purpose

This document describes the important user journeys and product-visible rules the MVP must support. It intentionally does not prescribe the internal data model, APIs, packages, or authorization mechanisms used to implement them.

## Product Rules

- Imported data does not affect the portfolio before the user confirms it.
- Confirmed financial records are the source for derived holdings, cash, allocations, and values.
- Market and FX data enrich portfolio calculations but do not replace user financial records.
- Missing market or FX data is communicated instead of producing a silently misleading result.
- AI access is read-only in the MVP.
- A user must never receive another user's financial data.
- Local use does not require a managed Finsight account.
- Finsight presents financial information for understanding and does not present itself as a financial advisor.

## 1. First-Time Local Setup

### Goal

Start using Finsight in a user-operated local environment.

### Main Flow

1. The user starts Finsight locally.
2. Finsight prepares the local context needed to use the application.
3. The user lands on an empty portfolio summary.
4. The interface explains that an account and imported data are needed for useful portfolio information.

### Expected Result

The user can begin without registering for a managed service and understands the next action.

### Important Edge Cases

- Local storage is unavailable or cannot be initialized.
- Setup is interrupted and must be retried safely.
- The application restarts with existing local data.

## 2. Create an Account

### Goal

Create an account representing where investments or cash are held.

### Main Flow

1. The user starts account creation from the portfolio summary.
2. The user provides a name, institution when applicable, account type, and currency.
3. The user confirms the account.
4. The account appears in the portfolio's account list and is available as an import destination.

### Expected Result

The user has a clearly identified account ready to receive imported investment data.

### Important Edge Cases

- Required information is missing or invalid.
- The name would create a confusing duplicate in the user's account list.
- Creation fails; no partial account is shown.

## 3. Import Investment Data

### Goal

Upload investment data from a supported broker statement or export.

### Main Flow

1. The user starts an import and chooses the target account.
2. The user uploads a CSV, XLSX, or PDF file.
3. Finsight extracts candidate financial records and identifies information that needs attention.
4. The user proceeds to review without the uploaded data affecting the portfolio.

### Expected Result

The file's recognizable investment data is ready for review, and the existing portfolio remains unchanged.

### Important Edge Cases

- The file type or size is unsupported.
- The file is unreadable or contains no recognizable investment data.
- Some data has low confidence, an unknown asset, a missing currency, or a possible duplicate.
- Processing fails and the user receives a clear retry or recovery path.

## 4. Review and Confirm an Import

### Goal

Verify extracted data before it becomes part of the portfolio.

### Main Flow

1. The user opens an import awaiting review.
2. Finsight distinguishes data that is ready from data requiring attention.
3. The user reviews, corrects, approves, or ignores extracted data.
4. Finsight prevents confirmation while required issues remain unresolved.
5. The user confirms the reviewed import.
6. Confirmed data becomes part of the portfolio and updates the derived portfolio information.

### Expected Result

Only the data the user reviewed and accepted affects the portfolio.

### Important Edge Cases

- The user leaves before confirmation; the portfolio remains unchanged.
- All extracted data is ignored, so there is nothing to confirm.
- A possible duplicate or uncertain asset match requires a user decision.
- Confirmation fails; the review state remains available for retry.

## 5. View the Portfolio Summary

### Goal

Understand the portfolio at a glance.

### Main Flow

1. The user opens the portfolio summary.
2. Finsight derives current holdings, cash, account values, allocations, and total value from confirmed financial data.
3. Available market prices and FX rates are applied.
4. The user sees the total value, value history, important allocations, holdings, and cash balances.

### Expected Result

The user can understand what the portfolio contains, where it is held, and whether any value is incomplete.

### Important Edge Cases

- There are no accounts or no confirmed financial records.
- A market price or FX rate is missing.
- Historical information is incomplete; the UI avoids presenting value history as investment returns.

## 6. View Account Information

### Goal

Understand an account and its contribution to the portfolio.

### Main Flow

1. The user selects an account from the portfolio summary.
2. Finsight shows the account's identifying information and available portfolio information, such as its value, holdings, and cash.
3. The user can start an import for that account.

### Expected Result

The user understands where the account is held and how it contributes to the portfolio.

### Important Edge Cases

- The account contains no confirmed data.
- Some values are incomplete because market or FX data is unavailable.
- The account no longer exists or is not accessible to the current user.

## 7. Connect and Use an AI Agent

### Goal

Use a compatible AI agent to explore portfolio information.

### Main Flow

1. The user opens the AI connection area and follows the MCP connection instructions.
2. The user connects a compatible agent.
3. The agent requests available read-only portfolio information from Finsight.
4. The agent uses that information to answer the user's question.

### Expected Result

The user can ask portfolio questions without manually exporting the data, and the agent cannot change the portfolio through the MVP integration.

### Important Edge Cases

- The connection fails or the requested capability is unavailable.
- The portfolio has no data or lacks information required for the question.
- A question requires external news or context; the agent obtains that separately.
- The user requests trading, mutation, or another unsupported action.

## 8. Error and Empty States

### Goal

Make missing data and failures understandable and recoverable.

### Main Flow

1. Finsight describes the missing information or failed action in user-facing language.
2. The interface explains the impact on the current result.
3. When possible, it offers a safe next action such as creating an account, importing data, correcting a file, or retrying.

### Expected Result

The user knows what happened, whether portfolio information is incomplete, and what to do next.

### Important Edge Cases

- No accounts, confirmed data, or connected AI agent exists.
- An import cannot be read or reviewed.
- Market or FX information is missing or delayed.
- An AI connection fails.
- An unexpected error occurs without a specialized recovery path.
