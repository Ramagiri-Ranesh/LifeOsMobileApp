do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'body_metrics_user_date_key'
      and conrelid = 'public.body_metrics'::regclass
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'body_metrics'
        and indexname = 'body_metrics_user_date_idx'
    ) then
      drop index if exists public.body_metrics_user_date_idx;
    end if;

    alter table public.body_metrics
      add constraint body_metrics_user_date_key
      unique (user_id, date);
  end if;
end $$;

notify pgrst, 'reload schema';
