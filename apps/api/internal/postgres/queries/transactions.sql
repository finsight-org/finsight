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

-- name: ListAccountTransactions :many
select id, portfolio_id, account_id, import_id, type, trade_date, settlement_date, description, source, external_id, status, created_at, updated_at
from transactions
where portfolio_id = @portfolio_id
    and account_id = @account_id
order by trade_date desc, created_at desc, id desc;

-- name: GetAccountTransaction :one
select id, portfolio_id, account_id, import_id, type, trade_date, settlement_date, description, source, external_id, status, created_at, updated_at
from transactions
where portfolio_id = @portfolio_id
    and account_id = @account_id
    and id = @id
limit 1;

-- name: GetAccountTransactionForUpdate :one
select id, portfolio_id, account_id, import_id, type, trade_date, settlement_date, description, source, external_id, status, created_at, updated_at
from transactions
where portfolio_id = @portfolio_id
    and account_id = @account_id
    and id = @id
limit 1
for update;

-- name: UpdateAccountTransaction :one
update transactions
set
    type = @type,
    trade_date = @trade_date,
    settlement_date = @settlement_date,
    description = @description
where portfolio_id = @portfolio_id
    and account_id = @account_id
    and id = @id
returning id, portfolio_id, account_id, import_id, type, trade_date, settlement_date, description, source, external_id, status, created_at, updated_at;

-- name: DeleteAccountTransaction :execrows
delete from transactions
where portfolio_id = @portfolio_id
    and account_id = @account_id
    and id = @id;

-- name: DeleteLedgerEntriesByTransaction :exec
delete from ledger_entries
where transaction_id = @transaction_id
    and account_id = @account_id;

-- name: ListAccountLedgerEntries :many
select
    tx.id as transaction_id,
    tx.portfolio_id,
    tx.account_id,
    tx.import_id,
    tx.type,
    tx.trade_date,
    tx.settlement_date,
    tx.description,
    tx.source,
    tx.external_id,
    tx.status,
    tx.created_at as transaction_created_at,
    tx.updated_at as transaction_updated_at,
    le.id as ledger_entry_id,
    le.entry_type,
    le.quantity,
    le.amount,
    le.currency as entry_currency,
    le.original_amount,
    le.original_currency,
    le.exchange_rate,
    le.direction,
    le.created_at as ledger_entry_created_at,
    ast.id as asset_id,
    ast.name as asset_name,
    ast.asset_type,
    ast.currency as asset_currency,
    ast.symbol,
    ast.provider_id,
    ast.provider_symbol,
    ast.exchange,
    ast.isin,
    ast.country,
    ast.sector,
    ast.is_active,
    ast.created_at as asset_created_at,
    ast.updated_at as asset_updated_at
from transactions tx
join ledger_entries le on le.transaction_id = tx.id and le.account_id = tx.account_id
join assets ast on ast.id = le.asset_id
where tx.portfolio_id = @portfolio_id
    and tx.account_id = @account_id
order by tx.trade_date desc, tx.created_at desc, tx.id desc, le.id;
