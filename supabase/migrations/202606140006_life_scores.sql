create extension if not exists pgcrypto;

create table if not exists public.life_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  life_score numeric not null default 0,
  nutrition_score numeric not null default 0,
  fitness_score numeric not null default 0,
  productivity_score numeric not null default 0,
  hydration_score numeric not null default 0,
  alignment_score numeric not null default 0,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.life_scores add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.life_scores add column if not exists date date;
alter table public.life_scores add column if not exists life_score numeric not null default 0;
alter table public.life_scores add column if not exists nutrition_score numeric not null default 0;
alter table public.life_scores add column if not exists fitness_score numeric not null default 0;
alter table public.life_scores add column if not exists productivity_score numeric not null default 0;
alter table public.life_scores add column if not exists hydration_score numeric not null default 0;
alter table public.life_scores add column if not exists alignment_score numeric not null default 0;
alter table public.life_scores add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.life_scores add column if not exists created_at timestamptz default now();
alter table public.life_scores add column if not exists updated_at timestamptz default now();

create unique index if not exists life_scores_user_date_key on public.life_scores (user_id, date);
create index if not exists life_scores_user_created_idx on public.life_scores (user_id, created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.life_scores to anon, authenticated;

alter table public.life_scores enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'life_scores'
      and policyname = 'Allow life score reads'
  ) then
    create policy "Allow life score reads"
      on public.life_scores
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'life_scores'
      and policyname = 'Allow life score writes'
  ) then
    create policy "Allow life score writes"
      on public.life_scores
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
