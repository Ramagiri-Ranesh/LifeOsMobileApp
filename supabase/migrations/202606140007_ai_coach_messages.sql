create extension if not exists pgcrypto;

create table if not exists public.ai_coach_messages (
  id text primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'ai')),
  message_type text not null default 'text',
  text text not null default '',
  content text not null default '',
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_coach_messages add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.ai_coach_messages add column if not exists role text;
alter table public.ai_coach_messages add column if not exists message_type text not null default 'text';
alter table public.ai_coach_messages add column if not exists text text not null default '';
alter table public.ai_coach_messages add column if not exists content text not null default '';
alter table public.ai_coach_messages add column if not exists payload jsonb default '{}'::jsonb;
alter table public.ai_coach_messages add column if not exists created_at timestamptz not null default now();

create index if not exists ai_coach_messages_user_created_idx on public.ai_coach_messages (user_id, created_at desc);
create index if not exists ai_coach_messages_created_idx on public.ai_coach_messages (created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.ai_coach_messages to anon, authenticated;

alter table public.ai_coach_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_coach_messages'
      and policyname = 'Allow AI coach message reads'
  ) then
    create policy "Allow AI coach message reads"
      on public.ai_coach_messages
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_coach_messages'
      and policyname = 'Allow AI coach message writes'
  ) then
    create policy "Allow AI coach message writes"
      on public.ai_coach_messages
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
