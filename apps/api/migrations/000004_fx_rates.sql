-- +goose Up
create table fx_rates (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    from_currency text not null,
    to_currency text not null,
    date date not null,
    rate numeric(38, 12) not null,
    provider_id text not null,
    source_quality text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fx_rates_from_currency_check check (from_currency ~ '^[A-Z]{3}$'),
    constraint fx_rates_to_currency_check check (to_currency ~ '^[A-Z]{3}$'),
    constraint fx_rates_distinct_currency_check check (from_currency <> to_currency),
    constraint fx_rates_rate_positive_check check (rate > 0),
    constraint fx_rates_provider_id_check check (
        length(provider_id) > 0
        and provider_id = lower(provider_id)
        and provider_id !~ '^[[:space:]]'
        and provider_id !~ '[[:space:]]$'
    ),
    constraint fx_rates_source_quality_check check (source_quality in ('DEMO', 'PROVIDER', 'MANUAL'))
);

create trigger fx_rates_set_updated_at
    before update on fx_rates
    for each row
    execute function set_updated_at();

create unique index fx_rates_workspace_pair_date_provider_uidx
    on fx_rates (workspace_id, from_currency, to_currency, date, provider_id);

create index fx_rates_workspace_to_currency_date_idx
    on fx_rates (workspace_id, to_currency, date);

-- +goose Down
drop index if exists fx_rates_workspace_to_currency_date_idx;
drop index if exists fx_rates_workspace_pair_date_provider_uidx;
drop trigger if exists fx_rates_set_updated_at on fx_rates;
drop table if exists fx_rates;
