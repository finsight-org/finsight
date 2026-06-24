# Finsight Vision

## Mission

Finsight is an open-source investment data platform that makes portfolio data accessible to both humans and AI agents.

Instead of building another complex portfolio dashboard, Finsight focuses on helping users import, understand, and interact with their investments through natural language while maintaining full ownership of their data.

## Principles

### AI-Native

Users should be able to ask questions about their investments through ChatGPT, Claude, Gemini, Ollama, or any MCP-compatible agent.

AI product names are examples only unless explicitly listed as supported integrations.

### Data Ownership

Users own their data.

Finsight supports cloud, self-hosted, and local deployments, allowing users to choose where their data lives and which AI systems can access it.

### Open Platform

Finsight provides a normalized investment data model and open APIs that can be integrated into applications, internal tools, and AI workflows.

The MVP starts with MCP-first, read-only access for connected agents. OpenAPI support remains part of the long-term platform direction.

### Bring Your Own Provider

Users and organizations can connect their preferred market data providers rather than being locked into a single vendor.

Broker and provider names in project documentation are examples only unless explicitly listed as supported integrations.

## Target Users

### Everyday Investors

- Upload a statement or export from a broker.
- Ask questions in plain English.
- No spreadsheets, ticker symbols, or complicated setup.

### Finance Enthusiasts

- Self-host the platform.
- Connect local LLMs.
- Customize data providers.
- Maintain full control of their data.

### Professionals & Organizations

- Integrate internal market data providers.
- Deploy on-premise.
- Connect internal AI agents.
- Control permissions and audit access as the platform matures.

## Core Product

### Data Platform

- Portfolio and transaction engine
- Normalized investment data model
- Market data abstraction layer
- Multi-currency support
- OpenAPI and MCP interfaces

### User Interface

- Import and review investment data
- Manage accounts
- Use one internal default portfolio in the MVP
- Configure permissions in later platform versions
- View portfolio summaries
- Audit AI access

### AI Integrations

- Portfolio analysis
- Risk analysis
- Performance explanations
- Scenario simulations
- Natural language access to investments

## Positioning

Upload your investments once. Use them everywhere.

Connect ChatGPT, Claude, Gemini, local LLMs, or your own AI agents to a single source of truth for your investment data.

For MVP architecture, connected agents receive read-only, workspace-scoped access and every access should be auditable.
