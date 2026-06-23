do $$
declare
  monthly_pair record;
  weekly_pair record;
begin
  for monthly_pair in
    with ranked as (
      select
        monthly_goals.id,
        first_value(monthly_goals.id) over (
          partition by monthly_goals.user_id, monthly_goals.category_id, monthly_goals.month_start, lower(monthly_goals.title)
          order by count(tasks.id) desc, monthly_goals.current_value desc, monthly_goals.created_at asc, monthly_goals.id asc
        ) as keep_id
      from public.monthly_goals
      left join public.tasks on tasks.monthly_goal_id = monthly_goals.id
      where lower(monthly_goals.title) = 'gym sessions'
      group by monthly_goals.id
    )
    select id, keep_id
    from ranked
    where id <> keep_id
  loop
    update public.tasks
    set monthly_goal_id = monthly_pair.keep_id
    where monthly_goal_id = monthly_pair.id;

    update public.weekly_goals
    set monthly_goal_id = monthly_pair.keep_id,
        linked_monthly_goal_id = monthly_pair.keep_id
    where monthly_goal_id = monthly_pair.id
       or linked_monthly_goal_id = monthly_pair.id;

    delete from public.monthly_goals
    where id = monthly_pair.id;
  end loop;

  for weekly_pair in
    with ranked as (
      select
        weekly_goals.id,
        first_value(weekly_goals.id) over (
          partition by weekly_goals.user_id, weekly_goals.category_id, weekly_goals.week_start, lower(weekly_goals.title)
          order by count(tasks.id) desc, weekly_goals.current_value desc, weekly_goals.created_at asc, weekly_goals.id asc
        ) as keep_id
      from public.weekly_goals
      left join public.tasks on tasks.weekly_goal_id = weekly_goals.id
      where lower(weekly_goals.title) = 'gym sessions this week'
      group by weekly_goals.id
    )
    select id, keep_id
    from ranked
    where id <> keep_id
  loop
    update public.tasks
    set weekly_goal_id = weekly_pair.keep_id
    where weekly_goal_id = weekly_pair.id;

    delete from public.weekly_goals
    where id = weekly_pair.id;
  end loop;
end $$;

update public.monthly_goals as monthly
set current_value = greatest(
  coalesce(monthly.current_value, 0),
  coalesce((
    select count(*) filter (where tasks.completed)
    from public.tasks
    where tasks.monthly_goal_id = monthly.id
  ), 0)
)
where lower(monthly.title) = 'gym sessions';

update public.weekly_goals as weekly
set current_value = greatest(
  coalesce(weekly.current_value, 0),
  coalesce((
    select count(*) filter (where tasks.completed)
    from public.tasks
    where tasks.weekly_goal_id = weekly.id
  ), 0)
)
where lower(weekly.title) = 'gym sessions this week';

create unique index if not exists monthly_goals_auto_gym_once
  on public.monthly_goals (user_id, category_id, month_start, lower(title))
  where lower(title) = 'gym sessions';

create unique index if not exists weekly_goals_auto_gym_once
  on public.weekly_goals (user_id, category_id, week_start, lower(title))
  where lower(title) = 'gym sessions this week';
