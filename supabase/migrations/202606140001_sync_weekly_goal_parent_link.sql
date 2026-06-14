alter table public.weekly_goals
  add column if not exists linked_monthly_goal_id uuid references public.monthly_goals(id) on delete cascade;

update public.weekly_goals
set
  monthly_goal_id = coalesce(monthly_goal_id, linked_monthly_goal_id),
  linked_monthly_goal_id = coalesce(linked_monthly_goal_id, monthly_goal_id)
where monthly_goal_id is null
   or linked_monthly_goal_id is null;

create index if not exists weekly_goals_linked_monthly_goal_idx
  on public.weekly_goals (linked_monthly_goal_id);

notify pgrst, 'reload schema';
