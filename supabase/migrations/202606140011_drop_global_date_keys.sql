alter table if exists public.body_metrics drop constraint if exists body_metrics_date_key;
drop index if exists public.body_metrics_date_key;

alter table if exists public.life_scores drop constraint if exists life_scores_date_key;
drop index if exists public.life_scores_date_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'body_metrics_user_date_key'
      and conrelid = 'public.body_metrics'::regclass
  ) then
    alter table public.body_metrics
      add constraint body_metrics_user_date_key
      unique (user_id, date);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'life_scores_user_date_key'
      and conrelid = 'public.life_scores'::regclass
  ) then
    alter table public.life_scores
      add constraint life_scores_user_date_key
      unique (user_id, date);
  end if;
end $$;

notify pgrst, 'reload schema';
