-- name: CreateAccount :one
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
returning id, portfolio_id, name, institution_name, type, base_currency, external_reference, created_at, updated_at;

-- name: ListAccountsByPortfolio :many
select id, portfolio_id, name, institution_name, type, base_currency, external_reference, created_at, updated_at
from accounts
where portfolio_id = @portfolio_id
order by lower(name), created_at, id;

-- name: GetAccountByPortfolioAndID :one
select id, portfolio_id, name, institution_name, type, base_currency, external_reference, created_at, updated_at
from accounts
where portfolio_id = @portfolio_id
    and id = @id
limit 1;
