# Accounts

Accounts belong to the local default portfolio. The current API does not accept a portfolio ID from the request; each operation resolves the local bootstrap context first, then uses that portfolio ID for account reads and writes.

Endpoints:

- `POST /api/accounts`
- `GET /api/accounts`
- `GET /api/accounts/{id}`

Create flow:

```mermaid
sequenceDiagram
    participant C as Client
    participant H as HTTP handler
    participant S as Account service
    participant B as Bootstrap service
    participant R as Account repository
    participant DB as PostgreSQL

    C->>H: POST /api/accounts
    H->>S: CreateAccount(input)
    S->>S: Trim name and optional fields
    S->>S: Validate name, type, currency
    S->>B: BootstrapLocal()
    B->>DB: Ensure local context exists
    DB-->>B: Default portfolio
    B-->>S: Portfolio ID
    S->>R: Create account scoped to portfolio
    R->>DB: INSERT INTO accounts
    DB-->>R: Created account row
    R-->>S: Account
    S-->>H: Account
    H-->>C: 201 JSON account
```

Read flow:

```mermaid
sequenceDiagram
    participant C as Client
    participant H as HTTP handler
    participant S as Account service
    participant B as Bootstrap service
    participant R as Account repository
    participant DB as PostgreSQL

    C->>H: GET /api/accounts or /api/accounts/{id}
    H->>S: ListAccounts() or GetAccount(id)
    S->>B: BootstrapLocal()
    B->>DB: Ensure local context exists
    DB-->>B: Default portfolio
    B-->>S: Portfolio ID
    S->>R: Query scoped to portfolio
    R->>DB: SELECT FROM accounts WHERE portfolio_id = ...
    DB-->>R: Account rows
    R-->>S: Account result
    S-->>H: Account result
    H-->>C: 200 JSON
```

Validation rules:

- `name` is required after trimming whitespace.
- `type` must be `BROKERAGE`, `BANK`, `CRYPTO_EXCHANGE`, `RETIREMENT`, or `MANUAL`.
- `base_currency` must be an uppercase 3-letter code.
- Account names are unique per portfolio, case-insensitive.

