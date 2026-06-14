create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null default 'system',
  route text,
  related_entity_type text,
  related_entity_id text,
  scheduled_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  delivery_status text not null default 'scheduled',
  device_notification_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.notifications add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists body text;
alter table public.notifications add column if not exists kind text default 'system';
alter table public.notifications add column if not exists route text;
alter table public.notifications add column if not exists related_entity_type text;
alter table public.notifications add column if not exists related_entity_id text;
alter table public.notifications add column if not exists scheduled_at timestamptz;
alter table public.notifications add column if not exists delivered_at timestamptz;
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.notifications add column if not exists delivery_status text default 'scheduled';
alter table public.notifications add column if not exists device_notification_id text;
alter table public.notifications add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.notifications add column if not exists created_at timestamptz default now();

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_read_idx on public.notifications (user_id, read_at);
create index if not exists notifications_device_notification_idx on public.notifications (device_notification_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.notifications to anon, authenticated;

alter table public.notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'Allow notification reads'
  ) then
    create policy "Allow notification reads"
      on public.notifications
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'Allow notification inserts'
  ) then
    create policy "Allow notification inserts"
      on public.notifications
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'Allow notification updates'
  ) then
    create policy "Allow notification updates"
      on public.notifications
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
