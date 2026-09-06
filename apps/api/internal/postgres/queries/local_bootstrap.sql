-- name: UpsertLocalUser :one
with inserted as (
    insert into users (email, display_name)
    values (@email, @display_name)
    on conflict do nothing
    returning id
)
select id from inserted
union all
select id
from users
where lower(email) = lower(@email)
    and not exists (select 1 from inserted)
limit 1;

-- name: UpsertLocalWorkspace :one
with inserted as (
    insert into workspaces (
        name,
        base_currency,
        auth_mode
    )
    values (@name, @base_currency, @auth_mode)
    on conflict do nothing
    returning id
)
select id from inserted
union all
select id
from workspaces
where auth_mode = @auth_mode
    and not exists (select 1 from inserted)
limit 1;

-- name: UpsertLocalWorkspaceMembership :exec
insert into workspace_memberships (
    workspace_id,
    user_id,
    role
)
values (@workspace_id, @user_id, @role)
on conflict do nothing;

-- name: UpsertDefaultPortfolio :exec
insert into portfolios (
    workspace_id,
    name,
    base_currency,
    is_default
)
values (@workspace_id, @name, @base_currency, true)
on conflict do nothing;

-- name: GetLocalDefaultScope :one
select p.workspace_id, p.id as portfolio_id
from workspaces w
join portfolios p on p.workspace_id = w.id
    and p.is_default
where w.auth_mode = 'local'
limit 1;
