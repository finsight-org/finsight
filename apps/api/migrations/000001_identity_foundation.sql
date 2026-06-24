-- +goose Up
create extension if not exists pgcrypto;

create table users (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    display_name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    base_currency text not null,
    auth_mode text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint workspaces_base_currency_check check (base_currency ~ '^[A-Z]{3}$')
);

create table workspace_memberships (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    role text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint workspace_memberships_role_check check (role in ('owner', 'admin', 'member'))
);

create table portfolios (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    name text not null,
    description text not null default '',
    base_currency text not null,
    is_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint portfolios_base_currency_check check (base_currency ~ '^[A-Z]{3}$')
);

-- +goose StatementBegin
create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;
-- +goose StatementEnd

create trigger workspaces_set_updated_at
    before update on workspaces
    for each row
    execute function set_updated_at();

create trigger users_set_updated_at
    before update on users
    for each row
    execute function set_updated_at();

create trigger workspace_memberships_set_updated_at
    before update on workspace_memberships
    for each row
    execute function set_updated_at();

create trigger portfolios_set_updated_at
    before update on portfolios
    for each row
    execute function set_updated_at();

create unique index users_email_uidx
    on users (lower(email));

create unique index workspaces_local_auth_mode_uidx
    on workspaces (auth_mode)
    where auth_mode = 'local';

create unique index workspace_memberships_workspace_user_uidx
    on workspace_memberships (workspace_id, user_id);

create unique index portfolios_workspace_default_uidx
    on portfolios (workspace_id)
    where is_default;

create unique index portfolios_workspace_name_uidx
    on portfolios (workspace_id, lower(name));

-- +goose Down
drop index if exists portfolios_workspace_name_uidx;
drop index if exists portfolios_workspace_default_uidx;
drop index if exists workspace_memberships_workspace_user_uidx;
drop index if exists workspaces_local_auth_mode_uidx;
drop index if exists users_email_uidx;

drop trigger if exists portfolios_set_updated_at on portfolios;
drop trigger if exists workspace_memberships_set_updated_at on workspace_memberships;
drop trigger if exists users_set_updated_at on users;
drop trigger if exists workspaces_set_updated_at on workspaces;

drop function if exists set_updated_at();

drop table if exists portfolios;
drop table if exists workspace_memberships;
drop table if exists workspaces;
drop table if exists users;
