-- name: UpsertAsset :one
insert into assets (
    workspace_id,
    name,
    asset_type,
    currency,
    symbol,
    provider_id,
    provider_symbol,
    exchange,
    isin,
    country,
    sector,
    is_active
)
values (
    @workspace_id,
    @name,
    @asset_type,
    @currency,
    @symbol,
    @provider_id,
    @provider_symbol,
    @exchange,
    @isin,
    @country,
    @sector,
    true
)
on conflict (workspace_id, provider_id, provider_symbol)
do update set
    name = excluded.name,
    asset_type = excluded.asset_type,
    currency = excluded.currency,
    symbol = excluded.symbol,
    exchange = coalesce(excluded.exchange, assets.exchange),
    isin = coalesce(excluded.isin, assets.isin),
    country = coalesce(excluded.country, assets.country),
    sector = coalesce(excluded.sector, assets.sector),
    is_active = true
where assets.asset_type <> 'CASH'
returning id, workspace_id, name, asset_type, currency, symbol, provider_id, provider_symbol, exchange, isin, country, sector, is_active, created_at, updated_at;

-- name: UpsertCashAsset :one
insert into assets (
    workspace_id,
    name,
    asset_type,
    currency,
    symbol,
    provider_id,
    provider_symbol,
    exchange,
    isin,
    country,
    sector,
    is_active
)
values (
    @workspace_id,
    @name,
    'CASH',
    @currency,
    @symbol,
    @provider_id,
    @provider_symbol,
    @exchange,
    @isin,
    @country,
    @sector,
    true
)
on conflict (workspace_id, currency)
where asset_type = 'CASH'
do update set
    name = excluded.name,
    symbol = excluded.symbol,
    is_active = true
returning id, workspace_id, name, asset_type, currency, symbol, provider_id, provider_symbol, exchange, isin, country, sector, is_active, created_at, updated_at;

-- name: GetAssetByWorkspaceAndID :one
select id, workspace_id, name, asset_type, currency, symbol, provider_id, provider_symbol, exchange, isin, country, sector, is_active, created_at, updated_at
from assets
where workspace_id = @workspace_id
    and id = @id
limit 1;
