update public.meal_logs
set meal_type = 'evening_snack'
where meal_type = 'snack';

update public.meal_templates
set meal_type = 'evening_snack'
where meal_type = 'snack';

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.meal_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%meal_type%'
  loop
    execute format('alter table public.meal_logs drop constraint if exists %I', constraint_name);
  end loop;

  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.meal_templates'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%meal_type%'
  loop
    execute format('alter table public.meal_templates drop constraint if exists %I', constraint_name);
  end loop;
end $$;

alter table public.meal_logs
  add constraint meal_logs_meal_type_check
  check (meal_type in ('breakfast', 'mid_morning', 'lunch', 'evening_snack', 'dinner', 'bedtime_snack'));

alter table public.meal_templates
  add constraint meal_templates_meal_type_check
  check (meal_type is null or meal_type in ('breakfast', 'mid_morning', 'lunch', 'evening_snack', 'dinner', 'bedtime_snack'));
