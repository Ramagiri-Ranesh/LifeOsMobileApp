# Nutrition Current Flow

Last reviewed: 2026-06-14

This document explains how the current Nutrition feature works in LifeOS before the next redesign or product changes.

## Main Files

- Screen: `app/(tabs)/nutrition.tsx`
- Store: `stores/useNutritionStore.ts`
- Clone workflow: `lib/cloneYesterday.ts` currently paused on the Nutrition screen
- AI meal suggestion: `lib/ai.ts` currently paused on the Nutrition screen
- Tables migration: `supabase/migrations/202606140002_nutrition_tables.sql`
- Related consumers:
  - Home tab: `app/(tabs)/index.tsx`
  - Analytics tab: `app/(tabs)/analytics.tsx`
  - AI Coach: `app/ai-coach.tsx`

## User-Facing Screen

The Nutrition tab currently shows:

- Page title: `Nutrition`
- Date navigation for previous/next day
- Clone yesterday action is hidden for now
- `Templates` button
- Calorie progress ring
- Protein, carbs, and fat progress bars
- Today's meal cards
- Quick actions for missing meal slots
- Bottom-sheet modal for logging a food item
- Bottom-sheet modal for applying meal templates
- Modal for adding a custom food item

The screen supports six meal types:

- `breakfast`
- `mid_morning`
- `lunch`
- `evening_snack`
- `dinner`
- `bedtime_snack`

The display order is:

```text
breakfast -> mid_morning -> lunch -> evening_snack -> dinner -> bedtime_snack
```

## Data Ownership

Nutrition data is scoped to the current profile id from `useUserStore.currentUserId`.

Current user-scoped operations:

- Load meal logs for a selected date
- Create/find a meal log
- Search user-owned and global foods
- Add personal food items
- Load user-owned templates
- Clone yesterday's meals helper exists, but the screen action is paused

Global food rows are represented by `user_id is null`.
Templates are intended to be user-owned, created from the logging flow.

## Screen State

`nutrition.tsx` keeps UI-only state locally:

- `selectedDate`
- `expandedMeal`
- `activeMealType`
- modal visibility flags
- food search `query`
- `foodResults`
- `selectedFood`
- `qty`
- loading flags
- toast message
- custom food draft fields

The screen gets durable nutrition state from `useNutritionStore`:

- `todaysMeals`
- `calories`
- `templates`
- `loading`

The screen gets user targets/preferences from `useUserStore`:

- `calorieGoal`
- `macros`
- `foodsToAvoid`
- `cuisinePreference`

## Loading Daily Data

When the screen opens or the date changes:

1. `refreshData()` runs.
2. It calls `loadDailyData(selectedDate)`.
3. It calls `loadTemplates()`.
4. The calorie ring and macro bars are recomputed from store state.

`loadDailyData(date)` queries:

```sql
meal_logs
  -> meal_log_items
    -> food_items
```

It filters by:

```text
user_id = current profile id
date = selected date
```

Each `meal_logs` row becomes a `Meal`.
Each nested `meal_log_items` row becomes a `MealLogItem`.

## Meal Logging Flow

The user can open logging from:

- `Log Meal`
- `Add item` inside an expanded meal
- `Log Snack`
- `Log Dinner`
- Manual entry without searching

Flow:

1. `openLogMeal(mealType)` opens the logging modal.
2. The user searches/selects a food.
3. The user enters quantity.
4. The preview shows scaled calories/macros.
5. `saveMealItem()` calls `logMealItem(date, mealType, food, qty)`.

`logMealItem` does an optimistic local update first:

- Creates the meal locally if it does not exist.
- Adds the food item to that meal.
- Recalculates total calories.

Then it syncs to Supabase:

1. `getOrCreateMealLog(date, mealType, userId)`
2. Insert row into `meal_log_items`

Fallback/local foods do not write `food_item_id`; they are stored as snapshot calories/macros only.

## Food Search

Food search looks in Supabase first:

```text
food_items where user_id is null or user_id = current profile id
```

Then it merges local fallback Indian foods from `INDIAN_FOODS`.

Fallback foods include items like:

- Banana
- Whole milk
- Egg
- Almonds
- Chapathi
- Ghee
- Mixed veg curry
- White rice
- Peanuts
- Dal
- Paneer
- Idli
- Dosa
- Biryani
- Sambar

If the Supabase query fails, the UI still works with fallback foods.

## Custom Food Flow

The user can add a custom food from the logging modal.

Fields:

- Name
- Serving
- Calories
- Protein
- Carbs
- Fat

`addFoodItem()` inserts into `food_items` with `user_id = current profile id`.

After insert:

- The new food becomes selected.
- It is added to the visible search results.
- The custom food modal closes.

## Templates Flow

The `Templates` modal loads:

- User-owned templates
- No local preloaded templates are injected anymore

Applying a template:

1. User taps a template row.
2. `applyTemplate(selectedDate, item.mealType, item)` runs.
3. Template items are optimistically added to the meal.
4. Store inserts the items into `meal_log_items`.
5. A toast confirms the template was added.

Creating a template:

1. User logs a food item.
2. User toggles `Save this as a template`.
3. User optionally enters a template name.
4. Store inserts `meal_templates`.
5. Store inserts `meal_template_items`.
6. Template becomes available in the Templates modal for that meal slot.

Current limitation:

- There is no full edit/delete UI for saved templates yet.

## Delete Flow

A logged food item can be deleted by long press.

Flow:

1. Long press a food row.
2. Alert asks for confirmation.
3. `deleteMealItem(date, mealType, itemId)` runs.
4. The item is removed locally.
5. If it is a database-backed item, it is deleted from `meal_log_items`.

If a meal has no items after deletion, the meal card is removed from the local list.

## Clone Yesterday Flow

`Clone yesterday` is currently hidden on the Nutrition screen.

The helper code remains in `lib/cloneYesterday.ts` for later reactivation.

Flow:

1. User taps `Clone yesterday`.
2. `cloneYesterdayMeals()` reads yesterday's `meal_logs` and nested `meal_log_items`.
3. Query is scoped by current profile id.
4. If today already has meals, the app asks whether to replace them.
5. Existing today meals are deleted if the user confirms.
6. Yesterday's logs and items are inserted for today.
7. Nutrition screen refreshes.

Current limitation:

- The UI action is paused for now.
- If reactivated, clone uses today's actual date, not the screen-selected date.

## AI Suggestion Flow

AI suggestions are intentionally hidden for now. The feature should come back later after the manual logging, templates, and meal-slot flow are stable.

## Database Tables

The current nutrition migration creates:

### `food_items`

Purpose: global and personal food database.

Important columns:

- `id`
- `user_id`
- `name`
- `serving`
- `unit`
- `calories`
- `protein`
- `carbs`
- `fat`

### `meal_logs`

Purpose: one meal header for a user/date/meal type.

Important columns:

- `id`
- `user_id`
- `date`
- `meal_type`
- `name`
- `time`
- `calories`
- `protein`
- `carbs`
- `fat`

Unique index:

```text
user_id, date, meal_type
```

### `meal_log_items`

Purpose: individual foods inside a meal.

Important columns:

- `id`
- `meal_log_id`
- `food_item_id`
- `name`
- `serving`
- `qty`
- `quantity`
- `calories`
- `protein`
- `carbs`
- `fat`

### `meal_templates`

Purpose: reusable meal headers.

Important columns:

- `id`
- `user_id`
- `name`
- `meal_type`
- `calories`
- `protein`
- `carbs`
- `fat`

### `meal_template_items`

Purpose: foods inside reusable meal templates.

Important columns:

- `id`
- `meal_template_id`
- `food_item_id`
- `name`
- `serving`
- `qty`
- `quantity`
- `calories`
- `protein`
- `carbs`
- `fat`

## RLS And Auth Note

The app currently uses a custom username/password login flow, not Supabase Auth as the primary session owner.

Because of that, the migration currently uses permissive RLS policies:

```text
using (true)
with check (true)
```

The app enforces user scoping in client queries with `currentUserId`.

Future improvement:

- Move to stronger owner-scoped RLS when the auth model is upgraded.

## Related App Areas

### Home Tab

The Home tab reads:

- `todaysMeals`
- `calories`
- `waterMl`

It uses nutrition data for:

- Calories remaining
- Timeline meal items
- Daily brief context

### Analytics Tab

Analytics reads `meal_logs` for the last 30 days and calculates calorie trends against the user's goal.

Current limitation:

- Analytics meal queries are not fully user-scoped yet.

### AI Coach

AI Coach reads recent `meal_logs` and today's nutrition store state.

It uses meals for:

- Chat context
- Meal summary
- Meal suggestion cards

Current limitation:

- Some AI Coach meal history queries are not fully user-scoped yet.

## Current Strengths

- The feature works even if Supabase food search fails, because fallback foods exist.
- Logging is fast because updates are optimistic.
- Meals, foods, and templates now support user scoping.
- The UI supports date navigation, templates, manual food creation, save-as-template, and item deletion.

## Current Gaps

- No edit/delete UI for meal templates.
- AI suggestions are paused until the final phase.
- Analytics and AI Coach still need full user scoping for meal history reads.
- `meal_logs` stores total macro columns, but current logging mainly relies on item totals.
- RLS is permissive because Supabase Auth is not the ownership model yet.
- No barcode scan or external nutrition database integration.
- No common "recent foods" or "frequent foods" shortcut.
- No copy meal between arbitrary dates.
- No meal-level edit screen beyond adding/deleting individual items.

## Clean Mental Model

Nutrition currently works like this:

```text
Profile targets
  -> calorie goal and macros

Selected date
  -> meal_logs
  -> meal_log_items
  -> visible meal cards

Food search/manual entry
  -> food_items + fallback foods
  -> selected food
  -> scaled by quantity
  -> meal_log_items insert

Templates
  -> created while logging or loaded from meal_template_items
  -> copied into meal_log_items

Clone yesterday, currently paused
  -> copies yesterday meal_logs/items into today
```
