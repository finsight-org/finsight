-- name: UpsertLocalUser :one
with inserted as (
    insert into users (email, display_name)
    values (@email, @display_name)
    on conflict do nothing
    returning id, email, display_name, true as created
)
select id, email, display_name, created from inserted
union all
select id, email, display_name, false as created
from users
where lower(email) = lower(@email)
    and deleted_at is null
    and not exists (select 1 from inserted)
limit 1;

-- name: UpsertLocalWorkspace :one
with inserted as (
    insert into workspaces (
        name,
        base_currency,
        auth_mode,
        created_by_user_id,
        updated_by_user_id
    )
    values (@name, @base_currency, @auth_mode, @user_id, @user_id)
    on conflict do nothing
    returning id, name, base_currency, auth_mode, true as created
)
select id, name, base_currency, auth_mode, created from inserted
union all
select id, name, base_currency, auth_mode, false as created
from workspaces
where auth_mode = @auth_mode
    and deleted_at is null
    and not exists (select 1 from inserted)
limit 1;

-- name: UpsertLocalWorkspaceMembership :one
with inserted as (
    insert into workspace_memberships (
        workspace_id,
        user_id,
        role,
        created_by_user_id,
        updated_by_user_id
    )
    values (@workspace_id, @user_id, @role, @user_id, @user_id)
    on conflict do nothing
    returning id, workspace_id, user_id, role, true as created
)
select id, workspace_id, user_id, role, created from inserted
union all
select id, workspace_id, user_id, role, false as created
from workspace_memberships
where workspace_id = @workspace_id
    and user_id = @user_id
    and deleted_at is null
    and not exists (select 1 from inserted)
limit 1;

-- name: UpsertDefaultPortfolio :one
with inserted as (
    insert into portfolios (
        workspace_id,
        name,
        base_currency,
        is_default,
        created_by_user_id,
        updated_by_user_id
    )
    values (@workspace_id, @name, @base_currency, true, @user_id, @user_id)
    on conflict do nothing
    returning id, workspace_id, name, base_currency, is_default, true as created
)
select id, workspace_id, name, base_currency, is_default, created from inserted
union all
select id, workspace_id, name, base_currency, is_default, false as created
from portfolios
where workspace_id = @workspace_id
    and is_default
    and deleted_at is null
    and not exists (select 1 from inserted)
limit 1;
