alter table public.workout_sessions add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.workout_sets add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.body_metrics add column if not exists user_id uuid references public.profiles(id) on delete cascade;

create index if not exists workout_sessions_user_completed_idx on public.workout_sessions (user_id, completed_at);
create index if not exists workout_sets_user_created_idx on public.workout_sets (user_id, created_at);
create index if not exists body_metrics_user_date_idx on public.body_metrics (user_id, date);

grant select, insert, update, delete on public.workout_sessions to anon, authenticated;
grant select, insert, update, delete on public.workout_sets to anon, authenticated;
grant select, insert, update, delete on public.body_metrics to anon, authenticated;

alter table public.workout_sessions enable row level security;
alter table public.workout_sets enable row level security;
alter table public.body_metrics enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workout_sessions'
      and policyname = 'Allow workout session reads'
  ) then
    create policy "Allow workout session reads"
      on public.workout_sessions
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workout_sessions'
      and policyname = 'Allow workout session writes'
  ) then
    create policy "Allow workout session writes"
      on public.workout_sessions
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workout_sets'
      and policyname = 'Allow workout set reads'
  ) then
    create policy "Allow workout set reads"
      on public.workout_sets
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workout_sets'
      and policyname = 'Allow workout set writes'
  ) then
    create policy "Allow workout set writes"
      on public.workout_sets
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'body_metrics'
      and policyname = 'Allow body metric reads'
  ) then
    create policy "Allow body metric reads"
      on public.body_metrics
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'body_metrics'
      and policyname = 'Allow body metric writes'
  ) then
    create policy "Allow body metric writes"
      on public.body_metrics
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

notify pgrst, 'reload schema';
