create table public.provider_connections (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 provider_id text not null check (provider_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 label text check (label is null or (char_length(label) between 1 and 100 and btrim(label,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> '')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index provider_connections_owner_order on public.provider_connections(user_id,created_at,id);
alter table public.provider_connections enable row level security;
create policy owner_select on public.provider_connections for select to authenticated using ((select auth.uid())=user_id);
create policy owner_insert on public.provider_connections for insert to authenticated with check ((select auth.uid())=user_id);
create policy owner_update on public.provider_connections for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy owner_delete on public.provider_connections for delete to authenticated using ((select auth.uid())=user_id);
revoke all on public.provider_connections from public, anon, authenticated;
grant select,delete on public.provider_connections to authenticated;
grant insert(provider_id,label),update(label) on public.provider_connections to authenticated;
create function public.provider_connections_touch() returns trigger language plpgsql security invoker set search_path='' as $$ begin NEW.updated_at=now(); return NEW; end $$;
revoke all on function public.provider_connections_touch() from public,anon,authenticated;
create trigger provider_connections_touch before update on public.provider_connections for each row execute function public.provider_connections_touch();
notify pgrst, 'reload schema';
