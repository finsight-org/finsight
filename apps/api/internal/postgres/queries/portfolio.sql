-- TODO: Derive the FX-rate workspace by joining portfolios in
-- ListPortfolioFxRatesForValuation, so workspace_id does not need to be
-- loaded here and passed through Go.
-- name: GetPortfolioValuationContext :one
select workspace_id, base_currency
from portfolios
where id = @portfolio_id;

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
    mp.currency,
    mp.provider_id,
    mp.source_quality
from market_prices mp
where mp.date <= @end_date
    and exists (
        select 1
        from ledger_entries le
        join transactions tx on tx.id = le.transaction_id
        where tx.portfolio_id = @portfolio_id
            and le.asset_id = mp.asset_id
    )
order by mp.asset_id, mp.date, mp.source_quality, mp.provider_id;

-- name: ListPortfolioFxRatesForValuation :many
select
    fx.from_currency,
    fx.to_currency,
    fx.date,
    fx.rate,
    fx.provider_id,
    fx.source_quality
from fx_rates fx
where fx.workspace_id = @workspace_id
    and fx.to_currency = @base_currency
    and fx.date <= @end_date
    and fx.from_currency in (
        select distinct needed.currency
        from (
            select le.currency
            from ledger_entries le
            join transactions tx on tx.id = le.transaction_id
            where tx.portfolio_id = @portfolio_id
                and tx.status = 'CONFIRMED'
                and tx.trade_date <= @end_date

            union

            select mp.currency
            from market_prices mp
            where mp.date <= @end_date
                and exists (
                    select 1
                    from ledger_entries le
                    join transactions tx on tx.id = le.transaction_id
                    where tx.portfolio_id = @portfolio_id
                        and le.asset_id = mp.asset_id
                )
        ) needed
        where needed.currency <> @base_currency
    )
order by fx.from_currency, fx.to_currency, fx.date, fx.source_quality, fx.provider_id;
