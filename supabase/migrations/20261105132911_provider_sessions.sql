create table public.provider_sessions (
  connection_id uuid primary key references public.provider_connections(id) on delete cascade,
  state text not null check (state in ('connected', 'expired')),
  encrypted_session jsonb,
  updated_at timestamptz not null default now(),
  constraint provider_sessions_envelope_state check (
    (state = 'connected' and encrypted_session is not null)
    or (state = 'expired' and encrypted_session is null)
  )
);

alter table public.provider_sessions enable row level security;
revoke all on public.provider_sessions from public, anon, authenticated;
-- Local Supabase defaults grant service_role ALL; narrow those inherited grants.
revoke all on public.provider_sessions from service_role;
grant select, insert, update, delete on public.provider_sessions to service_role;

create function public.provider_sessions_touch()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end
$$;
revoke all on function public.provider_sessions_touch() from public, anon, authenticated;
create trigger provider_sessions_touch before update on public.provider_sessions
for each row execute function public.provider_sessions_touch();

notify pgrst, 'reload schema';
