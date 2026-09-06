-- +goose Up
create table assets (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    name text not null,
    asset_type text not null,
    currency text not null,
    symbol text not null,
    provider_id text not null,
    provider_symbol text not null,
    exchange text,
    isin text,
    country text,
    sector text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint assets_name_check check (
        length(name) > 0
        and name !~ '^[[:space:]]'
        and name !~ '[[:space:]]$'
    ),
    constraint assets_asset_type_check check (asset_type in ('EQUITY', 'ETF', 'MUTUAL_FUND', 'CRYPTO', 'CASH', 'OTHER')),
    constraint assets_currency_check check (currency ~ '^[A-Z]{3}$'),
    constraint assets_symbol_check check (
        length(symbol) > 0
        and symbol !~ '^[[:space:]]'
        and symbol !~ '[[:space:]]$'
    ),
    constraint assets_provider_id_check check (
        length(provider_id) > 0
        and provider_id = lower(provider_id)
        and provider_id !~ '^[[:space:]]'
        and provider_id !~ '[[:space:]]$'
    ),
    constraint assets_provider_symbol_check check (
        length(provider_symbol) > 0
        and provider_symbol = lower(provider_symbol)
        and provider_symbol !~ '^[[:space:]]'
        and provider_symbol !~ '[[:space:]]$'
    ),
    constraint assets_exchange_check check (
        exchange is null
        or (
            length(exchange) > 0
            and exchange !~ '^[[:space:]]'
            and exchange !~ '[[:space:]]$'
        )
    ),
    constraint assets_isin_check check (
        isin is null
        or (
            length(isin) > 0
            and isin !~ '^[[:space:]]'
            and isin !~ '[[:space:]]$'
        )
    ),
    constraint assets_country_check check (
        country is null
        or (
            length(country) > 0
            and country !~ '^[[:space:]]'
            and country !~ '[[:space:]]$'
        )
    ),
    constraint assets_sector_check check (
        sector is null
        or (
            length(sector) > 0
            and sector !~ '^[[:space:]]'
            and sector !~ '[[:space:]]$'
        )
    )
);

create trigger assets_set_updated_at
    before update on assets
    for each row
    execute function set_updated_at();

create unique index assets_workspace_provider_uidx
    on assets (workspace_id, provider_id, provider_symbol);

create unique index assets_workspace_cash_currency_uidx
    on assets (workspace_id, currency)
    where asset_type = 'CASH';

create index assets_workspace_id_idx
    on assets (workspace_id);

create unique index accounts_id_portfolio_id_uidx
    on accounts (id, portfolio_id);

create table transactions (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    account_id uuid not null,
    import_id uuid,
    type text not null,
    trade_date date not null,
    settlement_date date,
    description text not null default '',
    source text not null,
    external_id text,
    status text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint transactions_type_check check (type in (
        'DEPOSIT',
        'WITHDRAWAL',
        'BUY',
        'SELL',
        'DIVIDEND',
        'INTEREST',
        'FEE',
        'TAX',
        'TRANSFER_IN',
        'TRANSFER_OUT',
        'FX_CONVERSION',
        'SPLIT',
        'OPENING_BALANCE',
        'ADJUSTMENT'
    )),
    constraint transactions_description_check check (
        description = ''
        or (
            description !~ '^[[:space:]]'
            and description !~ '[[:space:]]$'
        )
    ),
    constraint transactions_source_check check (
        length(source) > 0
        and source = upper(source)
        and source !~ '^[[:space:]]'
        and source !~ '[[:space:]]$'
    ),
    constraint transactions_external_id_check check (
        external_id is null
        or (
            length(external_id) > 0
            and external_id !~ '^[[:space:]]'
            and external_id !~ '[[:space:]]$'
        )
    ),
    constraint transactions_status_check check (status in ('CONFIRMED')),
    constraint transactions_account_portfolio_fk foreign key (account_id, portfolio_id)
        references accounts(id, portfolio_id) on delete cascade
);

create trigger transactions_set_updated_at
    before update on transactions
    for each row
    execute function set_updated_at();

create unique index transactions_portfolio_source_external_uidx
    on transactions (portfolio_id, source, external_id)
    where external_id is not null;

create index transactions_portfolio_trade_date_idx
    on transactions (portfolio_id, trade_date);

create index transactions_account_id_idx
    on transactions (account_id);

create unique index transactions_id_account_id_uidx
    on transactions (id, account_id);

create table ledger_entries (
    id uuid primary key default gen_random_uuid(),
    transaction_id uuid not null,
    account_id uuid not null references accounts(id) on delete cascade,
    asset_id uuid not null references assets(id) on delete restrict,
    entry_type text not null,
    quantity numeric(38, 12) not null default 0,
    amount numeric(38, 12) not null default 0,
    currency text not null,
    original_amount numeric(38, 12),
    original_currency text,
    exchange_rate numeric(38, 12),
    direction text not null,
    created_at timestamptz not null default now(),
    constraint ledger_entries_entry_type_check check (entry_type in ('ASSET_QUANTITY', 'CASH', 'FEE', 'TAX', 'INCOME', 'TRANSFER', 'FX')),
    constraint ledger_entries_currency_check check (currency ~ '^[A-Z]{3}$'),
    constraint ledger_entries_original_currency_check check (original_currency is null or original_currency ~ '^[A-Z]{3}$'),
    constraint ledger_entries_direction_check check (direction in ('INCREASE', 'DECREASE')),
    constraint ledger_entries_transaction_account_fk foreign key (transaction_id, account_id)
        references transactions(id, account_id) on delete cascade
);

create index ledger_entries_transaction_id_idx
    on ledger_entries (transaction_id);

create index ledger_entries_account_asset_idx
    on ledger_entries (account_id, asset_id);

create table market_prices (
    id uuid primary key default gen_random_uuid(),
    asset_id uuid not null references assets(id) on delete cascade,
    date date not null,
    price numeric(38, 12) not null,
    currency text not null,
    provider_id text not null,
    source_quality text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint market_prices_price_positive_check check (price > 0),
    constraint market_prices_currency_check check (currency ~ '^[A-Z]{3}$'),
    constraint market_prices_provider_id_check check (
        length(provider_id) > 0
        and provider_id = lower(provider_id)
        and provider_id !~ '^[[:space:]]'
        and provider_id !~ '[[:space:]]$'
    ),
    constraint market_prices_source_quality_check check (source_quality in ('DEMO', 'PROVIDER', 'MANUAL'))
);

create trigger market_prices_set_updated_at
    before update on market_prices
    for each row
    execute function set_updated_at();

create unique index market_prices_asset_date_provider_uidx
    on market_prices (asset_id, date, provider_id);

create index market_prices_asset_date_idx
    on market_prices (asset_id, date);

-- +goose Down
drop index if exists market_prices_asset_date_idx;
drop index if exists market_prices_asset_date_provider_uidx;
drop trigger if exists market_prices_set_updated_at on market_prices;
drop table if exists market_prices;

drop index if exists ledger_entries_account_asset_idx;
drop index if exists ledger_entries_transaction_id_idx;
drop table if exists ledger_entries;

drop index if exists transactions_account_id_idx;
drop index if exists transactions_id_account_id_uidx;
drop index if exists transactions_portfolio_trade_date_idx;
drop index if exists transactions_portfolio_source_external_uidx;
drop trigger if exists transactions_set_updated_at on transactions;
drop table if exists transactions;

drop index if exists accounts_id_portfolio_id_uidx;
drop index if exists assets_workspace_id_idx;
drop index if exists assets_workspace_cash_currency_uidx;
drop index if exists assets_workspace_provider_uidx;
drop trigger if exists assets_set_updated_at on assets;
drop table if exists assets;
