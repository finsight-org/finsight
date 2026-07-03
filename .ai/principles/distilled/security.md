# Security Principles

## Financial Data

Finsight stores sensitive financial data. Treat account, transaction, holding,
cash, import, market value, and connected-agent data as sensitive by default.

Do not expose internal errors, tokens, raw imports, provider secrets, or
unexpected financial data in public API responses, MCP responses, logs, or UI
messages.

## Workspace Scoping

Workspace scoping and authorization must be enforced before returning user
financial data.

Check workspace boundaries for:

- HTTP handlers.
- Backend services.
- Repository queries.
- MCP tool calls.
- Import and connected-agent flows.

## Token And Secret Handling

- Store token references or hashes rather than raw access tokens.
- Do not log tokens, secrets, API keys, broker credentials, or full raw uploaded
  statements.
- Redact sensitive data in errors and debug output.
- Keep provider credentials behind backend/provider boundaries.

## MCP Safety

- MCP access is read-only in the MVP.
- MCP tools must call backend application services.
- MCP must not bypass authorization, workspace scoping, validation, or portfolio
  calculation rules.
- MCP responses must not include secrets or unsupported internal data.
- Agents may reason over returned data, but Finsight should not perform trading
  or financial advice actions.

## Security-Sensitive Reviews

Treat these changes as security-sensitive:

- Authentication or authorization.
- Workspace membership and scoping.
- Agent tokens and connected-agent status.
- MCP tool access.
- Raw imports or extracted financial data.
- Provider credentials.
- Dependency lockfiles and new packages.
