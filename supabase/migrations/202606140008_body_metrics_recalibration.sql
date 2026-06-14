create extension if not exists pgcrypto;

create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  date date not null default current_date,
  weight_kg numeric,
  waist_cm numeric,
  chest_cm numeric,
  arm_cm numeric,
  hip_cm numeric,
  thigh_cm numeric,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.body_metrics add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.body_metrics add column if not exists date date not null default current_date;
alter table public.body_metrics add column if not exists weight_kg numeric;
alter table public.body_metrics add column if not exists waist_cm numeric;
alter table public.body_metrics add column if not exists chest_cm numeric;
alter table public.body_metrics add column if not exists arm_cm numeric;
alter table public.body_metrics add column if not exists hip_cm numeric;
alter table public.body_metrics add column if not exists thigh_cm numeric;
alter table public.body_metrics add column if not exists notes text;
alter table public.body_metrics add column if not exists created_at timestamptz default now();
alter table public.body_metrics add column if not exists updated_at timestamptz default now();

alter table public.profiles add column if not exists last_body_recalibration_at timestamptz;
alter table public.profiles add column if not exists body_recalibration_count integer not null default 0;

create index if not exists body_metrics_user_date_idx on public.body_metrics (user_id, date);
create index if not exists body_metrics_user_created_idx on public.body_metrics (user_id, created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.body_metrics to anon, authenticated;

alter table public.body_metrics enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'body_metrics'
      and policyname = 'Allow body metric access'
  ) then
    create policy "Allow body metric access"
      on public.body_metrics
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
