update public.finance_categories
set allocation_percent = case lower(name)
  when 'food' then 30
  when 'gym' then 10
  when 'travel' then 10
  when 'shopping' then 15
  when 'other' then 15
  else allocation_percent
end
where lower(name) in ('food', 'gym', 'travel', 'shopping', 'other');

update public.finance_categories categories
set monthly_budget = round((settings.monthly_income * categories.allocation_percent) / 100),
    updated_at = now()
from public.finance_settings settings
where categories.user_id = settings.user_id
  and settings.monthly_income > 0
  and lower(categories.name) in ('food', 'gym', 'travel', 'shopping', 'other');

update public.finance_categories
set monthly_budget = 0,
    updated_at = now()
where user_id not in (
  select user_id
  from public.finance_settings
  where monthly_income > 0
);

notify pgrst, 'reload schema';
