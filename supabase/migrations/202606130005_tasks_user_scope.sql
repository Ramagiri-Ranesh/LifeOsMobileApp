alter table public.tasks add column if not exists user_id uuid references public.profiles(id) on delete cascade;

create index if not exists tasks_user_date_idx on public.tasks (user_id, date);

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
