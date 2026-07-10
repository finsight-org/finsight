-- name: DeleteDemoTransactions :exec
delete from transactions
where portfolio_id = @portfolio_id
    and source = 'DEMO'
    and external_id like 'finsight-demo:%';

-- name: DeleteDemoMarketPrices :exec
delete from market_prices
where provider_id = 'demo'
    and exists (
        select 1
        from assets
        where assets.id = market_prices.asset_id
            and assets.workspace_id = @workspace_id
            and assets.provider_id = 'demo'
            and assets.provider_symbol like 'finsight-demo:%'
    );

-- name: UpsertDemoAccount :one
insert into accounts (
    portfolio_id,
    name,
    institution_name,
    type,
    base_currency,
    external_reference
)
values (
    @portfolio_id,
    @name,
    @institution_name,
    @type,
    @base_currency,
    @external_reference
)
on conflict (portfolio_id, lower(name))
do update set
    institution_name = excluded.institution_name,
    type = excluded.type,
    base_currency = excluded.base_currency,
    external_reference = excluded.external_reference
where accounts.external_reference like 'finsight-demo:%'
returning id, portfolio_id, name, institution_name, type, base_currency, external_reference, created_at, updated_at;

-- name: UpsertMarketPrice :one
insert into market_prices (
    asset_id,
    date,
    price,
    currency,
    provider_id,
    source_quality
)
values (
    @asset_id,
    @date,
    @price,
    @currency,
    @provider_id,
    @source_quality
)
on conflict (asset_id, date, provider_id)
do update set
    price = excluded.price,
    currency = excluded.currency,
    source_quality = excluded.source_quality
returning id, asset_id, date, price, currency, provider_id, source_quality, created_at, updated_at;
