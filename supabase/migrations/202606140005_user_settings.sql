create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notifications jsonb not null default '{}'::jsonb,
  quiet_hours jsonb not null default '{}'::jsonb,
  notification_times jsonb not null default '{}'::jsonb,
  ai jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  privacy jsonb not null default '{}'::jsonb,
  backup jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.user_settings add column if not exists notifications jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists quiet_hours jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists notification_times jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists ai jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists privacy jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists backup jsonb not null default '{}'::jsonb;
alter table public.user_settings add column if not exists created_at timestamptz not null default now();
alter table public.user_settings add column if not exists updated_at timestamptz not null default now();

create unique index if not exists user_settings_user_id_key on public.user_settings (user_id);
create index if not exists user_settings_updated_idx on public.user_settings (user_id, updated_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.user_settings to anon, authenticated;

alter table public.user_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'Allow user settings reads'
  ) then
    create policy "Allow user settings reads"
      on public.user_settings
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'Allow user settings inserts'
  ) then
    create policy "Allow user settings inserts"
      on public.user_settings
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'Allow user settings updates'
  ) then
    create policy "Allow user settings updates"
      on public.user_settings
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
