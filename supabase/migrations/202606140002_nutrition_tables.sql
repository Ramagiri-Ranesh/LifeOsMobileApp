create extension if not exists pgcrypto;

create table if not exists public.food_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  serving text,
  unit text,
  calories numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.food_items add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.food_items add column if not exists serving text;
alter table public.food_items add column if not exists unit text;
alter table public.food_items add column if not exists calories numeric not null default 0;
alter table public.food_items add column if not exists protein numeric not null default 0;
alter table public.food_items add column if not exists carbs numeric not null default 0;
alter table public.food_items add column if not exists fat numeric not null default 0;
alter table public.food_items add column if not exists created_at timestamptz default now();
alter table public.food_items add column if not exists updated_at timestamptz default now();

create table if not exists public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'mid_morning', 'lunch', 'evening_snack', 'dinner', 'bedtime_snack')),
  name text,
  time text,
  calories numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.meal_logs add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.meal_logs add column if not exists date date;
alter table public.meal_logs add column if not exists meal_type text;
alter table public.meal_logs add column if not exists name text;
alter table public.meal_logs add column if not exists time text;
alter table public.meal_logs add column if not exists calories numeric default 0;
alter table public.meal_logs add column if not exists protein numeric default 0;
alter table public.meal_logs add column if not exists carbs numeric default 0;
alter table public.meal_logs add column if not exists fat numeric default 0;
alter table public.meal_logs add column if not exists created_at timestamptz default now();
alter table public.meal_logs add column if not exists updated_at timestamptz default now();

create table if not exists public.meal_log_items (
  id uuid primary key default gen_random_uuid(),
  meal_log_id uuid not null references public.meal_logs(id) on delete cascade,
  food_item_id uuid references public.food_items(id) on delete set null,
  name text,
  serving text,
  qty numeric not null default 1,
  quantity numeric,
  calories numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  created_at timestamptz default now()
);

alter table public.meal_log_items add column if not exists meal_log_id uuid references public.meal_logs(id) on delete cascade;
alter table public.meal_log_items add column if not exists food_item_id uuid references public.food_items(id) on delete set null;
alter table public.meal_log_items add column if not exists name text;
alter table public.meal_log_items add column if not exists serving text;
alter table public.meal_log_items add column if not exists qty numeric not null default 1;
alter table public.meal_log_items add column if not exists quantity numeric;
alter table public.meal_log_items add column if not exists calories numeric default 0;
alter table public.meal_log_items add column if not exists protein numeric default 0;
alter table public.meal_log_items add column if not exists carbs numeric default 0;
alter table public.meal_log_items add column if not exists fat numeric default 0;
alter table public.meal_log_items add column if not exists created_at timestamptz default now();

create table if not exists public.meal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  meal_type text check (meal_type in ('breakfast', 'mid_morning', 'lunch', 'evening_snack', 'dinner', 'bedtime_snack')),
  calories numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.meal_templates add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.meal_templates add column if not exists name text;
alter table public.meal_templates add column if not exists meal_type text;
alter table public.meal_templates add column if not exists calories numeric default 0;
alter table public.meal_templates add column if not exists protein numeric default 0;
alter table public.meal_templates add column if not exists carbs numeric default 0;
alter table public.meal_templates add column if not exists fat numeric default 0;
alter table public.meal_templates add column if not exists created_at timestamptz default now();
alter table public.meal_templates add column if not exists updated_at timestamptz default now();

create table if not exists public.meal_template_items (
  id uuid primary key default gen_random_uuid(),
  meal_template_id uuid not null references public.meal_templates(id) on delete cascade,
  food_item_id uuid references public.food_items(id) on delete set null,
  name text,
  serving text,
  qty numeric default 1,
  quantity numeric,
  calories numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  created_at timestamptz default now()
);

alter table public.meal_template_items add column if not exists meal_template_id uuid references public.meal_templates(id) on delete cascade;
alter table public.meal_template_items add column if not exists food_item_id uuid references public.food_items(id) on delete set null;
alter table public.meal_template_items add column if not exists name text;
alter table public.meal_template_items add column if not exists serving text;
alter table public.meal_template_items add column if not exists qty numeric default 1;
alter table public.meal_template_items add column if not exists quantity numeric;
alter table public.meal_template_items add column if not exists calories numeric default 0;
alter table public.meal_template_items add column if not exists protein numeric default 0;
alter table public.meal_template_items add column if not exists carbs numeric default 0;
alter table public.meal_template_items add column if not exists fat numeric default 0;
alter table public.meal_template_items add column if not exists created_at timestamptz default now();

create unique index if not exists meal_logs_user_date_type_key on public.meal_logs (user_id, date, meal_type);
create index if not exists meal_log_items_meal_log_id_idx on public.meal_log_items (meal_log_id);
create index if not exists food_items_user_name_idx on public.food_items (user_id, lower(name));
create index if not exists meal_templates_user_type_idx on public.meal_templates (user_id, meal_type);
create index if not exists meal_template_items_template_id_idx on public.meal_template_items (meal_template_id);

alter table public.food_items enable row level security;
alter table public.meal_logs enable row level security;
alter table public.meal_log_items enable row level security;
alter table public.meal_templates enable row level security;
alter table public.meal_template_items enable row level security;

grant select, insert, update, delete on public.food_items to anon, authenticated;
grant select, insert, update, delete on public.meal_logs to anon, authenticated;
grant select, insert, update, delete on public.meal_log_items to anon, authenticated;
grant select, insert, update, delete on public.meal_templates to anon, authenticated;
grant select, insert, update, delete on public.meal_template_items to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'food_items' and policyname = 'Allow food item access'
  ) then
    create policy "Allow food item access" on public.food_items for all using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meal_logs' and policyname = 'Allow meal log access'
  ) then
    create policy "Allow meal log access" on public.meal_logs for all using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meal_log_items' and policyname = 'Allow meal log item access'
  ) then
    create policy "Allow meal log item access" on public.meal_log_items for all using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meal_templates' and policyname = 'Allow meal template access'
  ) then
    create policy "Allow meal template access" on public.meal_templates for all using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meal_template_items' and policyname = 'Allow meal template item access'
  ) then
    create policy "Allow meal template item access" on public.meal_template_items for all using (true) with check (true);
  end if;
end $$;
