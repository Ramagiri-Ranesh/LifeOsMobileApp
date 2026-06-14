create extension if not exists pgcrypto;

create table if not exists public.finance_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  monthly_income numeric default 0,
  currency text default 'INR',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.finance_categories add column if not exists allocation_percent numeric default 0;

alter table public.finance_settings add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.finance_settings add column if not exists monthly_income numeric default 0;
alter table public.finance_settings add column if not exists currency text default 'INR';
alter table public.finance_settings add column if not exists created_at timestamptz default now();
alter table public.finance_settings add column if not exists updated_at timestamptz default now();

update public.finance_settings
set monthly_income = coalesce(monthly_income, 0),
    currency = coalesce(currency, 'INR')
where true;

update public.finance_categories
set allocation_percent = case lower(name)
  when 'food' then 30
  when 'gym' then 10
  when 'travel' then 10
  when 'shopping' then 15
  when 'other' then 15
  else coalesce(allocation_percent, 0)
end
where allocation_percent is null
  or allocation_percent = 0;

update public.finance_categories
set monthly_budget = 0
where user_id not in (
  select user_id
  from public.finance_settings
  where monthly_income > 0
);

create unique index if not exists finance_settings_user_id_key
  on public.finance_settings (user_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.finance_settings to anon, authenticated;

alter table public.finance_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_settings'
      and policyname = 'Allow finance settings reads'
  ) then
    create policy "Allow finance settings reads"
      on public.finance_settings
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_settings'
      and policyname = 'Allow finance settings writes'
  ) then
    create policy "Allow finance settings writes"
      on public.finance_settings
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
