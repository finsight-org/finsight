-- +goose Up
create table accounts (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references portfolios(id) on delete cascade,
    name text not null,
    institution_name text,
    type text not null,
    base_currency text not null,
    external_reference text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint accounts_name_not_blank_check check (length(btrim(name)) > 0),
    constraint accounts_type_check check (type in ('BROKERAGE', 'BANK', 'CRYPTO_EXCHANGE', 'RETIREMENT', 'MANUAL')),
    constraint accounts_base_currency_check check (base_currency ~ '^[A-Z]{3}$')
);

create trigger accounts_set_updated_at
    before update on accounts
    for each row
    execute function set_updated_at();

create unique index accounts_portfolio_name_uidx
    on accounts (portfolio_id, lower(name));

create index accounts_portfolio_id_idx
    on accounts (portfolio_id);

-- +goose Down
drop index if exists accounts_portfolio_id_idx;
drop index if exists accounts_portfolio_name_uidx;

drop trigger if exists accounts_set_updated_at on accounts;

drop table if exists accounts;
