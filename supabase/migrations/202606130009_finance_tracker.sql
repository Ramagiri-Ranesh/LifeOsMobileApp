create extension if not exists pgcrypto;

create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  monthly_budget numeric default 0,
  allocation_percent numeric default 0,
  color text,
  icon text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.finance_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  monthly_income numeric default 0,
  currency text default 'INR',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  finance_category_id uuid references public.finance_categories(id) on delete set null,
  title text,
  merchant text,
  category text,
  amount numeric not null,
  note text,
  date date default current_date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.finance_categories add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.finance_categories add column if not exists name text;
alter table public.finance_categories add column if not exists monthly_budget numeric default 0;
alter table public.finance_categories add column if not exists allocation_percent numeric default 0;
alter table public.finance_categories add column if not exists color text;
alter table public.finance_categories add column if not exists icon text;
alter table public.finance_categories add column if not exists created_at timestamptz default now();
alter table public.finance_categories add column if not exists updated_at timestamptz default now();

alter table public.finance_settings add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.finance_settings add column if not exists monthly_income numeric default 0;
alter table public.finance_settings add column if not exists currency text default 'INR';
alter table public.finance_settings add column if not exists created_at timestamptz default now();
alter table public.finance_settings add column if not exists updated_at timestamptz default now();

alter table public.finance_transactions add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.finance_transactions add column if not exists finance_category_id uuid references public.finance_categories(id) on delete set null;
alter table public.finance_transactions add column if not exists title text;
alter table public.finance_transactions add column if not exists merchant text;
alter table public.finance_transactions add column if not exists category text;
alter table public.finance_transactions add column if not exists amount numeric default 0;
alter table public.finance_transactions add column if not exists note text;
alter table public.finance_transactions add column if not exists date date default current_date;
alter table public.finance_transactions add column if not exists created_at timestamptz default now();
alter table public.finance_transactions add column if not exists updated_at timestamptz default now();

update public.finance_categories
set monthly_budget = coalesce(monthly_budget, 0),
    allocation_percent = coalesce(allocation_percent, 0)
where true;

update public.finance_settings
set monthly_income = coalesce(monthly_income, 0),
    currency = coalesce(currency, 'INR')
where true;

update public.finance_transactions
set amount = coalesce(amount, 0),
    date = coalesce(date, current_date)
where true;

create unique index if not exists finance_categories_user_name_key
  on public.finance_categories (user_id, lower(name));

create unique index if not exists finance_settings_user_id_key
  on public.finance_settings (user_id);

create index if not exists finance_transactions_user_date_idx
  on public.finance_transactions (user_id, date desc);

create index if not exists finance_transactions_category_idx
  on public.finance_transactions (finance_category_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.finance_categories to anon, authenticated;
grant select, insert, update, delete on public.finance_settings to anon, authenticated;
grant select, insert, update, delete on public.finance_transactions to anon, authenticated;

alter table public.finance_categories enable row level security;
alter table public.finance_settings enable row level security;
alter table public.finance_transactions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_categories'
      and policyname = 'Allow finance category reads'
  ) then
    create policy "Allow finance category reads"
      on public.finance_categories
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_categories'
      and policyname = 'Allow finance category writes'
  ) then
    create policy "Allow finance category writes"
      on public.finance_categories
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;

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

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_transactions'
      and policyname = 'Allow finance transaction reads'
  ) then
    create policy "Allow finance transaction reads"
      on public.finance_transactions
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_transactions'
      and policyname = 'Allow finance transaction writes'
  ) then
    create policy "Allow finance transaction writes"
      on public.finance_transactions
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
