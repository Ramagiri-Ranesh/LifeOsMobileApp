-- Clear all saved nutrition templates.
-- Use this when you want to remove preloaded/old templates and let users build their own.
--
-- This keeps actual logged meals and food_items intact.

delete from public.meal_template_items
where meal_template_id in (
  select id from public.meal_templates
);

delete from public.meal_templates;

-- Optional: clear templates only for one user/profile.
-- Replace the UUID below with profiles.id.
--
-- delete from public.meal_template_items
-- where meal_template_id in (
--   select id from public.meal_templates
--   where user_id = '00000000-0000-0000-0000-000000000000'
-- );
--
-- delete from public.meal_templates
-- where user_id = '00000000-0000-0000-0000-000000000000';
