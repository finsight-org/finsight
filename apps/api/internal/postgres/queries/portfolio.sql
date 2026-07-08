-- name: ListPortfolioAccountsForValuation :many
select id, name
from accounts
where portfolio_id = @portfolio_id
order by lower(name), created_at, id;

-- name: ListPortfolioLedgerEntriesForValuation :many
select
    le.account_id,
    acc.name as account_name,
    le.asset_id,
    ast.name as asset_name,
    ast.asset_type,
    ast.currency as asset_currency,
    le.entry_type,
    le.quantity,
    le.amount,
    le.currency as entry_currency,
    tx.trade_date
from ledger_entries le
join transactions tx on tx.id = le.transaction_id
join accounts acc on acc.id = le.account_id
join assets ast on ast.id = le.asset_id
where tx.portfolio_id = @portfolio_id
    and tx.status = 'CONFIRMED'
    and tx.trade_date <= @end_date
order by tx.trade_date, tx.created_at, tx.id, le.id;

-- name: ListPortfolioMarketPricesForValuation :many
select
    mp.asset_id,
    mp.date,
    mp.price,
    mp.currency
from market_prices mp
where mp.date <= @end_date
    and exists (
        select 1
        from ledger_entries le
        join transactions tx on tx.id = le.transaction_id
        where tx.portfolio_id = @portfolio_id
            and le.asset_id = mp.asset_id
    )
order by mp.asset_id, mp.date;
