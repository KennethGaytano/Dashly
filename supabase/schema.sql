create table if not exists public.dashboard_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  collection text not null check (
    collection in (
      'tasks',
      'events',
      'notes',
      'goals',
      'skills',
      'projects',
      'pomodoro_sessions',
      'pomodoro_state'
    )
  ),
  record_id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, record_id)
);

create index if not exists dashboard_records_user_collection_updated_idx
  on public.dashboard_records (user_id, collection, updated_at desc);

alter table public.dashboard_records enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.dashboard_records to authenticated;
revoke all on public.dashboard_records from anon;

create or replace function public.dashly_current_user_exists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from auth.users
    where id = (select auth.uid())
  );
$function$;

revoke all on function public.dashly_current_user_exists() from public;
grant execute on function public.dashly_current_user_exists() to authenticated;

drop policy if exists "Users can read their own dashboard records"
  on public.dashboard_records;
create policy "Users can read their own dashboard records"
  on public.dashboard_records for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.dashly_current_user_exists())
  );

drop policy if exists "Users can create their own dashboard records"
  on public.dashboard_records;
create policy "Users can create their own dashboard records"
  on public.dashboard_records for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (select public.dashly_current_user_exists())
  );

drop policy if exists "Users can update their own dashboard records"
  on public.dashboard_records;
create policy "Users can update their own dashboard records"
  on public.dashboard_records for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.dashly_current_user_exists())
  )
  with check (
    (select auth.uid()) = user_id
    and (select public.dashly_current_user_exists())
  );

drop policy if exists "Users can delete their own dashboard records"
  on public.dashboard_records;
create policy "Users can delete their own dashboard records"
  on public.dashboard_records for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.dashly_current_user_exists())
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dashboard_records'
  ) then
    alter publication supabase_realtime add table public.dashboard_records;
  end if;
end;
$$;
