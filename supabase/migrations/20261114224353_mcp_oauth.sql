create schema finsight_private;
revoke all on schema finsight_private from public, anon, authenticated;

create table finsight_private.mcp_oauth_clients (
  client_id uuid primary key,
  resource text not null check (resource ~ '^https://[^/?#]+/mcp$')
);
alter table finsight_private.mcp_oauth_clients enable row level security;
revoke all on finsight_private.mcp_oauth_clients from public, anon, authenticated;

create function finsight_private.mcp_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  audience text;
begin
  if claims ->> 'client_id' is null then
    return event;
  end if;

  select client.resource into audience
    from finsight_private.mcp_oauth_clients as client
    where client.client_id = (claims ->> 'client_id')::uuid;
  if audience is not null and 'openid' = any(string_to_array(claims ->> 'scope', ' ')) then
    -- Keep the primary Supabase audience for GoTrue and PostgREST.
    claims := claims || jsonb_build_object(
      'aud', jsonb_build_array(claims ->> 'aud', audience),
      'finsight_mcp_read', true
    );
  end if;
  return jsonb_set(event, '{claims}', claims);
end
$$;

grant usage on schema finsight_private to supabase_auth_admin;
revoke all on function finsight_private.mcp_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function finsight_private.mcp_access_token_hook(jsonb) to supabase_auth_admin;

-- PostgREST validates JWTs independently of GoTrue. Check live OAuth sessions
-- here so a revoked token also loses access to connection rows immediately.
create function finsight_private.can_read_mcp_connections()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions as session
    join finsight_private.mcp_oauth_clients as client on client.client_id = session.oauth_client_id
    where session.id = (auth.jwt() ->> 'session_id')::uuid
      and session.user_id = auth.uid()
      and session.oauth_client_id = (auth.jwt() ->> 'client_id')::uuid
      and (session.not_after is null or session.not_after > now())
      and (auth.jwt() -> 'aud') ? client.resource
      and auth.jwt() -> 'finsight_mcp_read' = 'true'::jsonb
  )
$$;

revoke all on function finsight_private.can_read_mcp_connections() from public, anon, authenticated;
grant execute on function finsight_private.can_read_mcp_connections() to authenticated;

create policy mcp_select_bound_session on public.provider_connections
  as restrictive for select to authenticated
  using ((select auth.jwt() ->> 'client_id') is null or (select finsight_private.can_read_mcp_connections()));

create policy web_only_insert on public.provider_connections
  as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'client_id') is null);

create policy web_only_update on public.provider_connections
  as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'client_id') is null)
  with check ((select auth.jwt() ->> 'client_id') is null);

create policy web_only_delete on public.provider_connections
  as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'client_id') is null);

notify pgrst, 'reload schema';
