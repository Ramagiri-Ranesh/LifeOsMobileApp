create table if not exists public.tasks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  date date not null,
  time_block text,
  completed boolean default false,
  priority text default 'medium',
  category text,
  notes text,
  created_at timestamptz default now()
);

alter table public.tasks add column if not exists user_id uuid references public.profiles(id) on delete cascade;
create index if not exists tasks_user_date_idx on public.tasks (user_id, date);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.tasks to anon, authenticated;

alter table public.tasks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tasks'
      and policyname = 'Allow task reads'
  ) then
    create policy "Allow task reads"
      on public.tasks
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tasks'
      and policyname = 'Allow task creation'
  ) then
    create policy "Allow task creation"
      on public.tasks
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tasks'
      and policyname = 'Allow task completion updates'
  ) then
    create policy "Allow task completion updates"
      on public.tasks
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

create or replace function public.set_task_completed(input_task_id uuid, input_completed boolean)
returns table(
  id uuid,
  user_id uuid,
  title text,
  date date,
  time_block text,
  completed boolean,
  priority text,
  category text,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.tasks
  set completed = input_completed
  where tasks.id = input_task_id
  returning
    tasks.id,
    tasks.user_id,
    tasks.title,
    tasks.date,
    tasks.time_block,
    tasks.completed,
    tasks.priority,
    tasks.category,
    tasks.notes,
    tasks.created_at;
end;
$$;

grant execute on function public.set_task_completed(uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
