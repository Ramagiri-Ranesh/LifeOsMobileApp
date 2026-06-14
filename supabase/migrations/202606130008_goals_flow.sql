create extension if not exists pgcrypto;

create table if not exists public.goal_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  color text default '#7C3AED',
  icon text default 'flag-outline',
  sort_order integer default 0,
  created_at timestamptz default now()
);

create unique index if not exists goal_categories_user_name_key
  on public.goal_categories (user_id, lower(name));

create table if not exists public.monthly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  category_id uuid references public.goal_categories(id) on delete set null,
  title text not null,
  target_value numeric default 1,
  current_value numeric default 0,
  unit text default 'tasks',
  month_start date not null default date_trunc('month', current_date)::date,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.weekly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  category_id uuid references public.goal_categories(id) on delete set null,
  monthly_goal_id uuid references public.monthly_goals(id) on delete cascade,
  title text not null,
  target_value numeric default 1,
  current_value numeric default 0,
  unit text default 'tasks',
  week_start date not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.goal_categories add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.goal_categories add column if not exists name text;
alter table public.goal_categories add column if not exists color text default '#7C3AED';
alter table public.goal_categories add column if not exists icon text default 'flag-outline';
alter table public.goal_categories add column if not exists sort_order integer default 0;
alter table public.goal_categories add column if not exists created_at timestamptz default now();

alter table public.monthly_goals add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.monthly_goals add column if not exists category_id uuid references public.goal_categories(id) on delete set null;
alter table public.monthly_goals add column if not exists category text;
alter table public.monthly_goals add column if not exists target_value numeric default 1;
alter table public.monthly_goals add column if not exists current_value numeric default 0;
alter table public.monthly_goals add column if not exists unit text default 'tasks';
alter table public.monthly_goals add column if not exists month_start date default date_trunc('month', current_date)::date;
alter table public.monthly_goals add column if not exists status text default 'active';
alter table public.monthly_goals add column if not exists created_at timestamptz default now();
alter table public.monthly_goals add column if not exists updated_at timestamptz default now();

do $$
declare
  month_type text;
  year_type text;
begin
  select data_type
    into month_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'monthly_goals'
    and column_name = 'month';

  if month_type is not null then
    if month_type = 'date' then
      execute $sql$
        update public.monthly_goals
        set month = coalesce(month, month_start, date_trunc('month', current_date)::date)
      $sql$;
      execute $sql$
        alter table public.monthly_goals
        alter column month set default date_trunc('month', current_date)::date
      $sql$;
    elsif month_type in ('integer', 'smallint', 'bigint') then
      execute $sql$
        update public.monthly_goals
        set month = coalesce(month, extract(month from coalesce(month_start, date_trunc('month', current_date)::date))::integer)
      $sql$;
      execute $sql$
        alter table public.monthly_goals
        alter column month set default extract(month from current_date)::integer
      $sql$;
    else
      execute $sql$
        update public.monthly_goals
        set month = coalesce(month, to_char(coalesce(month_start, date_trunc('month', current_date)::date), 'YYYY-MM'))
      $sql$;
      execute $sql$
        alter table public.monthly_goals
        alter column month set default to_char(date_trunc('month', current_date), 'YYYY-MM')
      $sql$;
    end if;

    execute 'alter table public.monthly_goals alter column month drop not null';
  end if;

  select data_type
    into year_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'monthly_goals'
    and column_name = 'year';

  if year_type is not null then
    if year_type in ('integer', 'smallint', 'bigint') then
      execute $sql$
        update public.monthly_goals
        set year = coalesce(year, extract(year from coalesce(month_start, date_trunc('month', current_date)::date))::integer)
      $sql$;
      execute $sql$
        alter table public.monthly_goals
        alter column year set default extract(year from current_date)::integer
      $sql$;
    else
      execute $sql$
        update public.monthly_goals
        set year = coalesce(year, extract(year from coalesce(month_start, date_trunc('month', current_date)::date))::text)
      $sql$;
      execute $sql$
        alter table public.monthly_goals
        alter column year set default extract(year from current_date)::text
      $sql$;
    end if;

    execute 'alter table public.monthly_goals alter column year drop not null';
  end if;
end $$;

alter table public.weekly_goals add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.weekly_goals add column if not exists category_id uuid references public.goal_categories(id) on delete set null;
alter table public.weekly_goals add column if not exists category text;
alter table public.weekly_goals add column if not exists monthly_goal_id uuid references public.monthly_goals(id) on delete cascade;
alter table public.weekly_goals add column if not exists linked_monthly_goal_id uuid references public.monthly_goals(id) on delete cascade;
alter table public.weekly_goals add column if not exists target_value numeric default 1;
alter table public.weekly_goals add column if not exists current_value numeric default 0;
alter table public.weekly_goals add column if not exists unit text default 'tasks';
alter table public.weekly_goals add column if not exists week_start date;
alter table public.weekly_goals add column if not exists week_number integer;
alter table public.weekly_goals add column if not exists created_at timestamptz default now();
alter table public.weekly_goals add column if not exists updated_at timestamptz default now();

do $$
declare
  week_number_type text;
  weekly_year_type text;
begin
  select data_type
    into week_number_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'weekly_goals'
    and column_name = 'week_number';

  if week_number_type is not null then
    if week_number_type in ('integer', 'smallint', 'bigint') then
      execute $sql$
        update public.weekly_goals
        set week_number = coalesce(
          week_number,
          extract(week from coalesce(week_start, current_date - (extract(isodow from current_date)::integer - 1)))::integer
        )
      $sql$;
      execute $sql$
        alter table public.weekly_goals
        alter column week_number set default extract(week from current_date)::integer
      $sql$;
    else
      execute $sql$
        update public.weekly_goals
        set week_number = coalesce(
          week_number,
          extract(week from coalesce(week_start, current_date - (extract(isodow from current_date)::integer - 1)))::text
        )
      $sql$;
      execute $sql$
        alter table public.weekly_goals
        alter column week_number set default extract(week from current_date)::text
      $sql$;
    end if;

    execute 'alter table public.weekly_goals alter column week_number drop not null';
  end if;

  select data_type
    into weekly_year_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'weekly_goals'
    and column_name = 'year';

  if weekly_year_type is not null then
    if weekly_year_type in ('integer', 'smallint', 'bigint') then
      execute $sql$
        update public.weekly_goals
        set year = coalesce(year, extract(year from coalesce(week_start, current_date))::integer)
      $sql$;
      execute $sql$
        alter table public.weekly_goals
        alter column year set default extract(year from current_date)::integer
      $sql$;
    else
      execute $sql$
        update public.weekly_goals
        set year = coalesce(year, extract(year from coalesce(week_start, current_date))::text)
      $sql$;
      execute $sql$
        alter table public.weekly_goals
        alter column year set default extract(year from current_date)::text
      $sql$;
    end if;

    execute 'alter table public.weekly_goals alter column year drop not null';
  end if;
end $$;

alter table public.tasks add column if not exists category_id uuid references public.goal_categories(id) on delete set null;
alter table public.tasks add column if not exists monthly_goal_id uuid references public.monthly_goals(id) on delete set null;
alter table public.tasks add column if not exists weekly_goal_id uuid references public.weekly_goals(id) on delete set null;

update public.monthly_goals
set
  target_value = coalesce(target_value, 1),
  current_value = coalesce(current_value, 0),
  unit = coalesce(unit, 'tasks'),
  month_start = coalesce(month_start, date_trunc('month', current_date)::date),
  status = coalesce(status, 'active')
where true;

update public.monthly_goals monthly
set category = categories.name
from public.goal_categories categories
where monthly.category_id = categories.id
  and monthly.category is null;

update public.weekly_goals
set
  target_value = coalesce(target_value, 1),
  current_value = coalesce(current_value, 0),
  unit = coalesce(unit, 'tasks'),
  week_start = coalesce(week_start, current_date - (extract(isodow from current_date)::integer - 1)),
  monthly_goal_id = coalesce(monthly_goal_id, linked_monthly_goal_id),
  linked_monthly_goal_id = coalesce(linked_monthly_goal_id, monthly_goal_id)
where true;

update public.weekly_goals weekly
set category = categories.name
from public.goal_categories categories
where weekly.category_id = categories.id
  and weekly.category is null;

create index if not exists monthly_goals_user_month_idx on public.monthly_goals (user_id, month_start);
create index if not exists monthly_goals_category_idx on public.monthly_goals (category_id);
create index if not exists weekly_goals_user_week_idx on public.weekly_goals (user_id, week_start);
create index if not exists weekly_goals_monthly_goal_idx on public.weekly_goals (monthly_goal_id);
create index if not exists weekly_goals_linked_monthly_goal_idx on public.weekly_goals (linked_monthly_goal_id);
create index if not exists weekly_goals_category_idx on public.weekly_goals (category_id);
create index if not exists tasks_weekly_goal_idx on public.tasks (weekly_goal_id);
create index if not exists tasks_monthly_goal_idx on public.tasks (monthly_goal_id);
create index if not exists tasks_category_idx on public.tasks (category_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.goal_categories to anon, authenticated;
grant select, insert, update, delete on public.monthly_goals to anon, authenticated;
grant select, insert, update, delete on public.weekly_goals to anon, authenticated;

alter table public.goal_categories enable row level security;
alter table public.monthly_goals enable row level security;
alter table public.weekly_goals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'goal_categories'
      and policyname = 'Allow goal category reads'
  ) then
    create policy "Allow goal category reads"
      on public.goal_categories
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'goal_categories'
      and policyname = 'Allow goal category writes'
  ) then
    create policy "Allow goal category writes"
      on public.goal_categories
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'monthly_goals'
      and policyname = 'Allow monthly goal reads'
  ) then
    create policy "Allow monthly goal reads"
      on public.monthly_goals
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'monthly_goals'
      and policyname = 'Allow monthly goal writes'
  ) then
    create policy "Allow monthly goal writes"
      on public.monthly_goals
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'weekly_goals'
      and policyname = 'Allow weekly goal reads'
  ) then
    create policy "Allow weekly goal reads"
      on public.weekly_goals
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'weekly_goals'
      and policyname = 'Allow weekly goal writes'
  ) then
    create policy "Allow weekly goal writes"
      on public.weekly_goals
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
