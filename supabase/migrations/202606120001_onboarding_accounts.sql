create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text unique,
  password_hash text,
  name text,
  age integer,
  height_cm integer,
  weight_kg numeric,
  target_weight_kg numeric,
  gym_days_per_week integer,
  split text,
  workout_split text,
  currency text default 'INR',
  measurements text default 'metric',
  goal text,
  experience_level text,
  cuisine_prefs jsonb default '[]'::jsonb,
  foods_eaten jsonb default '[]'::jsonb,
  foods_avoided jsonb default '[]'::jsonb,
  first_meal_time text,
  last_meal_time text,
  ai_calc_calories boolean default true,
  calorie_goal integer,
  macros jsonb default '{}'::jsonb,
  daily_water_goal_ml integer,
  water_target_ml integer,
  first_week_plan jsonb default '{}'::jsonb,
  onboarding_profile jsonb default '{}'::jsonb,
  onboarding_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists password_hash text;
alter table public.profiles add column if not exists name text;
alter table public.profiles add column if not exists age integer;
alter table public.profiles add column if not exists height_cm integer;
alter table public.profiles add column if not exists weight_kg numeric;
alter table public.profiles add column if not exists target_weight_kg numeric;
alter table public.profiles add column if not exists gym_days_per_week integer;
alter table public.profiles add column if not exists split text;
alter table public.profiles add column if not exists workout_split text;
alter table public.profiles add column if not exists currency text default 'INR';
alter table public.profiles add column if not exists measurements text default 'metric';
alter table public.profiles add column if not exists goal text;
alter table public.profiles add column if not exists fitness_goal text;
alter table public.profiles add column if not exists experience_level text;
alter table public.profiles add column if not exists cuisine_prefs jsonb default '[]'::jsonb;
alter table public.profiles add column if not exists foods_to_avoid jsonb default '[]'::jsonb;
alter table public.profiles add column if not exists foods_eaten jsonb default '[]'::jsonb;
alter table public.profiles add column if not exists foods_avoided jsonb default '[]'::jsonb;
alter table public.profiles add column if not exists first_meal_time text;
alter table public.profiles add column if not exists last_meal_time text;
alter table public.profiles add column if not exists ai_calc_calories boolean default true;
alter table public.profiles add column if not exists ai_model text default 'openai';
alter table public.profiles add column if not exists calorie_goal integer;
alter table public.profiles add column if not exists protein_goal_g integer;
alter table public.profiles add column if not exists carbs_goal_g integer;
alter table public.profiles add column if not exists fat_goal_g integer;
alter table public.profiles add column if not exists macros jsonb default '{}'::jsonb;
alter table public.profiles add column if not exists daily_water_goal_ml integer;
alter table public.profiles add column if not exists water_target_ml integer;
alter table public.profiles add column if not exists first_week_plan jsonb default '{}'::jsonb;
alter table public.profiles add column if not exists onboarding_profile jsonb default '{}'::jsonb;
alter table public.profiles add column if not exists onboarding_completed boolean default false;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists updated_at timestamptz default now();
alter table public.profiles drop column if exists onboarding_done;

update public.profiles
set
  fitness_goal = case
    when lower(coalesce(goal, '')) like '%build muscle%' and lower(coalesce(goal, '')) like '%lose fat%' then 'build_muscle_lose_fat'
    when lower(coalesce(goal, '')) like '%build muscle%' or lower(coalesce(goal, '')) like '%bulk%' then 'build_muscle'
    when lower(coalesce(goal, '')) like '%lose%' then 'lose_body_fat'
    else coalesce(fitness_goal, 'stay_fit')
  end,
  protein_goal_g = coalesce(protein_goal_g, (macros->>'protein')::integer),
  carbs_goal_g = coalesce(carbs_goal_g, (macros->>'carbs')::integer),
  fat_goal_g = coalesce(fat_goal_g, (macros->>'fat')::integer),
  foods_to_avoid = coalesce(foods_to_avoid, foods_avoided),
  ai_model = coalesce(ai_model, 'openai');

create unique index if not exists profiles_username_key on public.profiles (username);

create table if not exists public.water_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  date date not null default current_date,
  glasses integer default 0,
  goal integer default 8,
  amount_ml integer default 0,
  target_ml integer,
  created_at timestamptz default now()
);

alter table public.water_log add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.water_log add column if not exists target_ml integer;
alter table public.water_log add column if not exists amount_ml integer default 0;
alter table public.water_log add column if not exists glasses integer default 0;
alter table public.water_log add column if not exists goal integer default 8;
update public.water_log
set goal = greatest(1, ceil(coalesce(target_ml, 2000)::numeric / 250)::integer)
where target_ml is not null;
alter table public.water_log drop constraint if exists water_log_date_key;
drop index if exists public.water_log_date_key;
create unique index if not exists water_log_user_date_key on public.water_log (user_id, date);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to anon, authenticated;
grant select, insert, update, delete on public.water_log to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Allow onboarding profile reads'
  ) then
    create policy "Allow onboarding profile reads"
      on public.profiles
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Allow onboarding profile inserts'
  ) then
    create policy "Allow onboarding profile inserts"
      on public.profiles
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Allow onboarding profile updates'
  ) then
    create policy "Allow onboarding profile updates"
      on public.profiles
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'water_log'
      and policyname = 'Allow water log reads'
  ) then
    create policy "Allow water log reads"
      on public.water_log
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'water_log'
      and policyname = 'Allow water log inserts'
  ) then
    create policy "Allow water log inserts"
      on public.water_log
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'water_log'
      and policyname = 'Allow water log updates'
  ) then
    create policy "Allow water log updates"
      on public.water_log
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
