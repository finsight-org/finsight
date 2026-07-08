-- name: CreateTransaction :one
insert into transactions (
    portfolio_id,
    account_id,
    import_id,
    type,
    trade_date,
    settlement_date,
    description,
    source,
    external_id,
    status
)
values (
    @portfolio_id,
    @account_id,
    @import_id,
    @type,
    @trade_date,
    @settlement_date,
    @description,
    @source,
    @external_id,
    @status
)
returning id, portfolio_id, account_id, import_id, type, trade_date, settlement_date, description, source, external_id, status, created_at, updated_at;

-- name: CreateLedgerEntry :one
insert into ledger_entries (
    transaction_id,
    account_id,
    asset_id,
    entry_type,
    quantity,
    amount,
    currency,
    original_amount,
    original_currency,
    exchange_rate,
    direction
)
values (
    @transaction_id,
    @account_id,
    @asset_id,
    @entry_type,
    @quantity,
    @amount,
    @currency,
    @original_amount,
    @original_currency,
    @exchange_rate,
    @direction
)
returning id, transaction_id, account_id, asset_id, entry_type, quantity, amount, currency, original_amount, original_currency, exchange_rate, direction, created_at;
