alter table public.profiles add column if not exists target_date date;
alter table public.profiles add column if not exists weekly_weight_change_kg numeric not null default 0.5
  check (weekly_weight_change_kg >= 0 and weekly_weight_change_kg <= 1);
