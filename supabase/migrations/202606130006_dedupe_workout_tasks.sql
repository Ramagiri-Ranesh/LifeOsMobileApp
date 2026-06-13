with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, date, lower(title)
      order by completed desc, created_at asc, id asc
    ) as row_number
  from public.tasks
  where category = 'fitness'
    and user_id is not null
)
delete from public.tasks
where id in (
  select id
  from ranked
  where row_number > 1
);

create unique index if not exists tasks_unique_daily_workout
on public.tasks (user_id, date, lower(title))
where category = 'fitness';

notify pgrst, 'reload schema';
