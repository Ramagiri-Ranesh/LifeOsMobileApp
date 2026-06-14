do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'life_scores_user_date_key'
      and conrelid = 'public.life_scores'::regclass
  ) then
    if exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'life_scores'
        and indexname = 'life_scores_user_date_key'
    ) then
      alter table public.life_scores
        add constraint life_scores_user_date_key
        unique using index life_scores_user_date_key;
    else
      alter table public.life_scores
        add constraint life_scores_user_date_key
        unique (user_id, date);
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
