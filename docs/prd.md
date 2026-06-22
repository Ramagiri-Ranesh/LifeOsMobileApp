# LifeOS Product Requirements Document

## 1. Executive Summary

LifeOS is a dark-mode personal tracking and planning app built with React Native, Expo Router, Zustand, and Supabase. The current product combines onboarding, editable profile management, daily planning, nutrition logging, gym tracking, goals, analytics, AI coaching, persisted notifications, app lock, and lightweight account login.

This PRD is based on the current repository structure and implementation. It does not assume the earlier prompt as truth. Where code references a feature but the schema or route is incomplete, that gap is documented explicitly.

### June 22, 2026 nutrition and training correction status

- Fixed food search macros showing `0` when legacy serving columns are zero but `*_per_100g` columns contain the real values. Serving macros are now derived using the serving-calorie ratio, while populated serving macros remain authoritative.
- Added a responsive `0–1 kg/week` progress control to fitness onboarding, defaulted to the commonly used `0.5 kg/week` pace. Target date is derived and persisted instead of being typed into a cramped date field.
- Fixed calorie targets so the local baseline and eligible AI recalibration produce maintenance calories first, then the selected weekly pace produces the goal-direction surplus or deficit. Selecting `0 kg/week` keeps the target at maintenance.
- Fixed hydration planning so required millilitres are calculated first from AI or the body-weight fallback (`35 ml/kg`, minimum `2200 ml`), rounded up into complete 250 ml glasses, and then persisted. Nine glasses is only a possible calculated result, never a hardcoded default.
- Replaced generic Push/Pull/Legs/Upper/Lower exercises with the approved 15-exercise catalogues. The same catalogue is used by deterministic onboarding plans, AI body-recalibration normalization, Gym templates, and the Add Exercise library.

### June 22, 2026 AI workflow status

- AI is unavailable before registration is complete and the user has an authenticated profile with `onboarding_completed = true`.
- Registration saves the deterministic starting plan and starts the first 14-day recalibration window.
- Onboarding plan reveal, Daily Hub briefs, Nutrition, Goals, insight cards, notifications, and background work use deterministic application logic and do not call an AI provider.
- Logging body weight writes only to `body_metrics`; it does not immediately change `profiles.weight_kg`, calories, macros, water, or workout targets.
- The Body Progress **Generate AI targets** action is the only target-recalibration AI path. It unlocks once per 14 days, uses the latest logged weight, and updates profile weight and targets together only after a valid AI response; failures leave the profile unchanged.
- AI Coach allows at most two user questions per UTC day. The UI displays usage and disables the composer at two; the `lifeos-ai` Edge Function is the authoritative enforcement boundary.

## 2. Source Of Truth Reviewed

The PRD is grounded in these project areas:

- `app/`: Expo Router screens and navigation.
- `stores/`: Zustand state for user, nutrition, gym, goals, analytics, AI coach, and settings.
- `lib/`: AI provider, calculations, profile serialization, notifications, water sync, workout planning, workout task creation, Supabase client.
- `supabase/migrations/`: implemented database migrations.
- `supabase/functions/lifeos-anomaly-alerts/`: anomaly alert edge function.
- `types/database.ts`: broad Supabase table type surface used by the app.
- `package.json` and `app.json`: platform, runtime, dependencies, and Expo configuration.

## 3. Product Goals

LifeOS should help one user turn profile data and goals into daily execution:

- Complete onboarding once and restore the user's dashboard later.
- Generate a nutrition, water, and first-week workout plan from profile inputs.
- Present a single Daily Hub for today's plan, Life Score, calories, hydration, workout, and tasks.
- Let the user log meals, foods, workouts, body weight, water, tasks, goals, and spending.
- Show analytics across life score, calories, workouts, strength, tasks, weight, correlations, and category scores.
- Offer AI only for user-triggered biweekly target recalibration and two daily AI Coach questions.
- Send local notifications and background anomaly alerts.
- Protect the app with optional biometric/device authentication.

## 4. Current Technology Stack

### Client

- React Native `0.85.3`.
- Expo `~56.0.11`.
- Expo Router `~56.2.10`.
- React `19.2.3`.
- Zustand `^5.0.14`.
- AsyncStorage for persisted local stores.
- React Native Reanimated, Gesture Handler, SVG, Victory Native, Skia.
- Expo Notifications, Background Fetch, Task Manager, Local Authentication.

### Backend

- Supabase JS `^2.108.1`.
- Supabase Postgres migrations in `supabase/migrations`.
- Supabase Edge Function for anomaly alert checks.

### AI

Current implementation:

- OpenAI chat completions use the `lifeos-ai` Supabase Edge Function with server-side `OPENAI_API_KEY`.
- The Edge Function accepts only authenticated `coach` and `body_recalibration` purposes after onboarding completion.
- Coach requests are limited to two per UTC day; body recalibration is limited by `profiles.last_body_recalibration_at` and a 14-day cooldown.
- These production paths do not fall back to Ollama, preventing a local provider from bypassing the server limits.

Important product decision:

- Gemini is not implemented in the current codebase. If Gemini is desired, this is a provider migration requirement, not current product behavior.

## 5. Platform Scope

Current Expo config contains Android, iOS, and web settings. Android is configured with adaptive icons and predictive back disabled. iOS and web are also present in `app.json`, but the project appears mobile-first and all screen work is React Native.

PRD scope for the next release:

- Primary: Android mobile.
- Secondary: code should not knowingly break Expo web or iOS scaffolding, but Android is the acceptance platform unless project ownership decides otherwise.

## 6. Navigation And Information Architecture

### Root Navigation

Root stack:

- `(onboarding)`
- `(tabs)`
- `ai-coach` as modal
- `finance`
- `notifications`
- `profile`

Root redirect rules:

- If no completed user session exists, redirect to onboarding or login.
- If a completed session exists and the user is inside onboarding, redirect to tabs.
- If app lock is enabled, block app content behind local authentication.

### Bottom Tabs

The tab navigator has six tabs:

- Home: Daily Hub
- Diet: Nutrition
- Gym: Gym Floor
- Goals: combined weekly, monthly, and finance areas
- Analytics: Performance Hub
- Settings: Control Center

### Placeholder Routes

- `app/finance.tsx` is implemented as a standalone finance tracker.

Finance also has surfaces inside the Goals tab.

## 7. User And Account Model

LifeOS uses Supabase Auth for the primary username/password login path. The visible username is mapped to an internal auth email and stored on `profiles`.

Registration flow:

1. User completes onboarding and plan reveal.
2. User chooses username and password.
3. App creates a Supabase Auth account.
4. App inserts a `profiles` row with `id = auth.users.id`.
5. App initializes today's water log.
6. App persists local session state.

Login flow:

1. User enters username and password.
2. App signs in with Supabase Auth.
3. App loads the matching `profiles` row by auth user id.
4. App restores profile, calorie target, macros, generated plan, workout split, and onboarding completion.

## 8. Implemented Screens

### 8.1 Welcome

Route: `app/(onboarding)/index.tsx`

Purpose:

- Entry screen for new and returning users.
- Routes completed users to tabs, returning registered users to login, and new users to onboarding.

Requirements:

- Show LifeOS brand and feature bullets.
- Provide "start" and login actions.
- Respect local registration and onboarding state.

Primary data:

- Local `useUserStore`.

### 8.2 Login

Route: `app/(onboarding)/login.tsx`

Purpose:

- Restore an existing LifeOS account.

Requirements:

- Normalize username.
- Sign in with Supabase Auth.
- Load profile by auth user id.
- Reject incomplete onboarding.
- Restore generated plan and current split.

Primary data:

- Supabase Auth session
- `profiles`

### 8.3 Basic Profile

Route: `app/(onboarding)/basic-profile.tsx`

Purpose:

- Collect identity and body basics.

Requirements:

- Capture name, gender, age, and height.
- Validate name, age range, and height range.
- Save data to local onboarding draft.

Primary data:

- Local `onboardingProfile`.

### 8.4 Fitness Profile

Route: `app/(onboarding)/fitness-profile.tsx`

Purpose:

- Capture fitness goals and training frequency.

Requirements:

- Choose primary goal: build muscle and lose fat, lose body fat, build muscle, or stay fit.
- Choose experience: beginner, intermediate, advanced.
- Step gym days per week from 1 to 7.
- Capture current and target weight.
- Show a touch progress control from `0` to `1 kg/week` in 0.1 kg increments, with `0.5` visible as the middle reference.
- Derive and show the estimated target date from current weight, target weight, and selected pace. At `0 kg/week`, show maintenance pace with no target date.
- Save to local onboarding draft.

Primary data:

- Local `onboardingProfile`.

### 8.5 Diet Profile

Route: `app/(onboarding)/diet-profile.tsx`

Purpose:

- Capture food preferences, disliked foods, meal timing, and AI calculation preference.

Requirements:

- Select cuisine preferences from South Indian, Hyderabadi, North Indian, Telugu.
- Toggle foods eaten from the app-provided list.
- Add/remove disliked foods.
- Capture first and last meal times as text.
- Toggle "Let AI calculate calories".

Primary data:

- Local `onboardingProfile`.

### 8.6 Plan Reveal

Route: `app/(onboarding)/plan-reveal.tsx`

Purpose:

- Generate and display first plan before account creation.

Requirements:

- Calculate local maintenance TDEE, allow a bounded AI maintenance estimate, then deterministically add/subtract `weekly pace × 7,700 / 7` calories according to build/cut/target direction before calculating macros.
- Allow the user-selected magnitude from `0–1 kg/week`; never confuse maintenance calories with the final surplus/deficit target.
- Accept AI hydration only as required millilitres. If unavailable, calculate `max(2200, weightKg × 35)` ml, then round up to complete 250 ml glasses.
- Build fallback weekly workout plan from gym days per week.
- If AI calculation is enabled, request a JSON plan through current AI provider.
- Treat AI/local maintenance and the deterministic selected-pace adjustment as separate values in the result UI.
- Cache plan requests in session.
- Show calorie target, macros, workout split, day pills, water target, and first-week goals.
- Save profile, targets, and generated plan to local store before registration.

Primary data:

- Local `onboardingProfile`
- Local `profile`
- Local `generatedPlan`

Current AI label issue:

- Status copy says OpenAI, matching current provider implementation.

### 8.7 Register

Route: `app/(onboarding)/register.tsx`

Purpose:

- Persist completed onboarding and create a Supabase Auth-backed account.

Requirements:

- Require generated plan.
- Require username to match the supported username format.
- Require password length at least 12.
- Check username availability with `profile_username_available`.
- Create Supabase Auth user.
- Insert profile payload with `profiles.id = auth.users.id`.
- Initialize today's `water_log`.
- Open tabs after success.

Primary data:

- `profiles`
- Supabase Auth session
- `water_log`

### 8.8 Daily Hub

Route: `app/(tabs)/index.tsx`

Purpose:

- Main command center for today's execution.

Requirements:

- Show greeting, name, date, notification icon, tappable avatar, Life Score, calories remaining, workout status, and task progress.
- Open the notification inbox from the home header and show unread count/badge when notifications are unread.
- Open the editable profile from the home header avatar.
- Build today's plan from meal logs and tasks.
- Ensure today's workout task exists from the generated workout template.
- Add tasks with date, time, priority, notes, and optional notification.
- Toggle task completion.
- Log water in 250 ml increments.
- Sync water to Supabase with user/date uniqueness.
- Generate the one-line daily brief locally from current score, calories, and task progress; do not call AI.
- Route quick actions to nutrition and gym.
- Open reflection modal through navigation params.

Primary data:

- `profiles`
- `tasks`
- `water_log`
- `meal_logs`
- `notifications`
- local `useNutritionStore`
- local `useAnalyticsStore`
- generated workout plan

### 8.9 Nutrition

Route: `app/(tabs)/nutrition.tsx`

Purpose:

- Log meals, search foods, apply meal templates, and show calorie/macro progress.

Requirements:

- Show date navigation.
- Load meals for selected date.
- Load meal templates.
- Search `food_items` with local Indian fallback foods.
- Read numeric values whether Supabase returns numbers or numeric strings.
- Prefer populated serving macro columns; when legacy serving macros are zero, derive each macro from its `*_per_100g` value and the serving calorie ratio.
- Sum item snapshots once; do not add meal-level cached totals on top of item totals.
- Add custom food items.
- Log meal items into breakfast, mid-morning, lunch, evening snack, dinner, or bedtime snack.
- Delete meal items by long press.
- Apply templates to meals.
- Clone yesterday's meals into today.
- Display calorie ring and macro bars.
- Keep AI meal suggestion paused on the Nutrition screen until the manual food, meal slot, and template flows are stable.
- Allow users to save a logged food as a meal template for faster repeat logging.

Primary data:

- `food_items`
- `meal_logs`
- `meal_log_items`
- `meal_templates`
- `meal_template_items`

### 8.10 Gym

Route: `app/(tabs)/gym.tsx`

Purpose:

- Execute and persist today's workout.

Requirements:

- Build workout templates from generated plan and profile fallback.
- Normalize Push, Pull, Legs, Upper, and Lower templates to the approved exercise catalogue in `lib/exerciseCatalog.ts`; AI text cannot silently replace these lists.
- Ensure today's workout task exists.
- Support selecting a schedule day.
- Log sets with weight and reps.
- Track rest timer.
- Add library or custom exercises.
- Detect personal-record estimates locally.
- Load recent muscle work for recovery warnings.
- Detect completed workout for today's template.
- Save workout session with date, template name, muscle groups, start/end times, duration, volume, sets, and notes.
- Save workout sets linked to session.
- Optionally save body weight.
- Mark today's workout task complete.
- Navigate to Workout History after saving.

Primary data:

- `workout_sessions`
- `workout_sets`
- `body_metrics`
- `tasks`
- `profiles`

### 8.11 Workout History

Route: `app/workout-history.tsx`

Purpose:

- Display recent completed workouts.

Requirements:

- Load up to 30 sessions for current user.
- Sort by `completed_at` descending.
- Show name, date/time, muscle group, duration, volume, and sets.
- Show empty state when no workouts exist.

Primary data:

- `workout_sessions`

### 8.12 Goals

Route: `app/(tabs)/goals.tsx`

Purpose:

- Combine weekly goals, monthly goals, and finance into one screen with internal tabs.

Requirements:

- Provide tabs: This Week, This Month, Finance.
- Load weekly goals, monthly goals, and finance transactions.
- Show fallback data if Supabase tables are empty or unavailable.
- Create weekly goals.
- Break monthly goals into linked weekly goals.
- Add finance transactions.
- Show locally derived pattern and weekly/monthly review snippets without AI requests.

Primary data:

- `weekly_goals`
- `monthly_goals`
- `finance_transactions`

Product note:

- This is a multi-domain screen today. A standalone Finance route also exists. The previous Learning screen/tab has been removed.

### 8.13 Analytics

Route: `app/(tabs)/analytics.tsx`

Purpose:

- Performance and trend dashboard.

Requirements:

- Filter periods: 7D, 30D, 90D, 1Y.
- Load life scores, meals, workouts, sets, tasks, body metrics, and finance transactions.
- Show Life Score trend.
- Show calories against goal.
- Show workout heatmap.
- Show strength gains for bench, shoulder, and tricep buckets.
- Show completed versus incomplete tasks.
- Show body weight against target.
- Show gym-day versus score correlation.
- Show monthly category score balance.
- Use fallback/generated points where data is missing.

Primary data:

- `life_scores`
- `meal_logs`
- `workout_sessions`
- `workout_sets`
- `tasks`
- `body_metrics`
- `finance_transactions`

### 8.14 AI Coach

Route: `app/ai-coach.tsx`

Purpose:

- Provide chat-based coaching and quick insight cards.

Requirements:

- Display active model label from current AI provider.
- Show insight cards for correlation, protein/nutrient alert, and streak win.
- Persist/reload recent coach messages.
- Let user select context chips: diet today, today's workout, weekly progress, sleep last night.
- Build recent context from meals, workouts, weekly goals, and life scores.
- Require completed registration and authentication.
- Send at most two prompts per user per UTC day to the Edge Function with purpose `coach`.
- Display daily usage and disable the composer after two questions; keep backend enforcement authoritative across devices.
- Infer message type from answer text.
- Animate AI response word by word.
- Allow meal suggestion cards to log an evening snack through nutrition store.

Primary data:

- `meal_logs`
- `meal_log_items`
- `food_items`
- `workout_sessions`
- `workout_sets`
- `weekly_goals`
- `life_scores`
- `ai_coach_messages`

### 8.16 Settings

Route: `app/(tabs)/settings.tsx`

Purpose:

- Control notification, AI model, privacy, backup, and logout settings.

Requirements:

- Show the current user profile entry and route to the editable profile screen.
- Toggle notification types: morning, lunch, workout, evening, weekly, AI alerts.
- Edit reminder times.
- Toggle quiet hours.
- Refresh notification schedules.
- Select AI model: OpenAI or Ollama.
- Enable app lock through local authentication.
- Export settings backup JSON.
- Logout and return to login.

Primary data:

- Local `lifeos-settings` persisted Zustand store.
- Local authentication APIs.
- Expo notification scheduling.
- `profiles`

### 8.17 Profile

Route: `app/profile.tsx`

Purpose:

- Show and edit the active user's LifeOS profile after onboarding.

Requirements:

- Open from the Home avatar and Settings profile section.
- Show avatar initial, display name, username, calorie target, protein target, and gym-day target.
- Toggle between read-only and edit mode.
- Edit display name, gender, age, height, current weight, target weight, weekly weight-change pace, gym days, water target, goal, experience level, and meal timing; target date is derived.
- Save edits to `profiles` and update the local `useUserStore` profile/onboarding target state.
- Validate required display name and clamp gym days/water target to usable ranges.

Primary data:

- `profiles`
- local `useUserStore`

### 8.18 Notifications Inbox

Route: `app/notifications.tsx`

Purpose:

- Display app-related notifications and reminder history in one inbox.

Requirements:

- Open from the Home notification icon.
- Show total and unread counts.
- Display task reminders, Daily Hub prompts, nutrition reminders, workout reminders, evening reviews, weekly summaries, and AI alerts.
- Tap a notification to mark it read and route to the relevant app area when a route is stored.
- Mark all unread notifications as read.
- Pull to refresh.

Primary data:

- `notifications`
- local `useUserStore`

### 8.19 Finance Placeholder

Route: `app/finance.tsx`

Purpose:

- Reserved standalone route.

Current state:

- Empty dark screen.
- Actual finance UI currently lives in Goals > Finance.

## 9. State Management Requirements

### User Store

Store: `stores/useUserStore.ts`

Responsibilities:

- Current user id and username.
- Registration-state routing flag.
- Profile and onboarding profile.
- Calorie target, macros, water target.
- Generated workout and first-week plan.
- Food exclusions and cuisine preferences.

Defaults currently include:

- Calorie target: 2380.
- Macros: 165 g protein, 240 g carbs, 72 g fat.
- Water target: 3000 ml.
- Cuisine preferences: South Indian, Hyderabadi, Telugu.
- Gym days: 4.
- Goal: build muscle and lose fat.

### Nutrition Store

Store: `stores/useNutritionStore.ts`

Responsibilities:

- Today's meals and calories.
- Food search.
- Custom food creation.
- Meal item logging.
- Meal template application.
- Meal item deletion.
- Meal template loading.
- Water ml local value.

### Gym Store

Store: `stores/useGymStore.ts`

Responsibilities:

- Active session sets.
- PR map.
- Streak.
- Current split label.

Note:

- The full Gym screen now manages most workout execution locally rather than relying heavily on this store.

### Goals, Analytics, AI Coach, Settings Stores

Responsibilities:

- Goals store: lightweight weekly/monthly goal arrays.
- Analytics store: Life Score and trend placeholders.
- AI Coach store: persisted messages and Supabase message sync.
- Settings store: notifications, quiet hours, reminder times, AI model, app lock.

## 10. Database Surface

### 10.1 Tables Created Or Directly Altered By Migrations In This Repo

| Table | Migration status | Current purpose |
| --- | --- | --- |
| `profiles` | Created and evolved | Onboarding profile, targets, generated plan, preferences, account profile |
| `water_log` | Created and constrained | Daily hydration by user/date |
| `app_users` | Legacy artifact | Locked by hardening migration; no longer used by app login |
| `tasks` | Created and indexed | Daily tasks and generated workout tasks |
| `notifications` | Created and indexed | Persisted app notification inbox and reminder delivery state |
| `workout_sessions` | Altered only | Workout history/session persistence expects table to pre-exist |
| `workout_sets` | Altered only | Set history expects table to pre-exist |
| `body_metrics` | Altered only | Body-weight metrics expects table to pre-exist |

Clean database status:

- `workout_sessions`, `workout_sets`, and `body_metrics` are now created defensively before follow-up alterations.

### 10.2 Tables Referenced By Code Or Types But Missing Creation Migrations

| Table | Referenced by | Needed for |
| --- | --- | --- |
| `food_items` | Nutrition store | Food search and custom foods |
| `meal_logs` | Nutrition, Daily Hub, Analytics, AI Coach, anomaly function | Meal/day calories |
| `meal_log_items` | Nutrition, AI Coach, clone yesterday | Foods inside meal logs |
| `meal_templates` | Nutrition store | Reusable meals |
| `meal_template_items` | Nutrition store | Foods inside reusable meals |
| `weekly_goals` | Goals, AI Coach | Weekly execution |
| `monthly_goals` | Goals | Monthly planning |
| `life_scores` | Analytics, AI Coach | Daily score history |
| `finance_transactions` | Goals, Analytics | Spending tracker |
| `finance_categories` | Database type only | Category budgets, not currently used by code |
| `weekly_summaries` | Database type only | Weekly rollups, not currently used by code |
| `ai_coach_messages` | AI coach store | Persisted AI chat messages |

Requirement:

- Add explicit migrations for every referenced table before treating the app as deployable from a clean Supabase project.

## 11. Data Relationships

### Account And Ownership

- Supabase Auth owns credentials; `profiles.id` is the auth user id.
- `tasks.user_id` references `profiles.id`.
- `notifications.user_id` references `profiles.id`.
- `water_log.user_id` references `profiles.id`.
- `workout_sessions.user_id`, `workout_sets.user_id`, and `body_metrics.user_id` are added as references to `profiles.id`.
- Other referenced domain tables should include `user_id` and reference `profiles.id`, but creation migrations are not present.

### Nutrition

- `meal_logs` should own one or more `meal_log_items`.
- `meal_log_items.food_item_id` should optionally reference `food_items.id`.
- `meal_templates` should own one or more `meal_template_items`.
- `meal_template_items.food_item_id` should optionally reference `food_items.id`.
- Nutrition screen expects nested selects: `meal_logs` with `meal_log_items` and `food_items`.

### Fitness

- `workout_sessions` should own many `workout_sets`.
- Gym writes set rows using `session_id`, while analytics and AI nested selects expect `workout_sets(*)`.
- Migrations do not document whether the foreign key column is `session_id` or `workout_session_id`; standardize this before release.
- `body_metrics` belongs to a user and date.
- Generated workout tasks are stored in `tasks` with category `fitness`.

### Goals

- `weekly_goals.monthly_goal_id` links a weekly goal to a monthly goal.
- Monthly breakdown creates new weekly goals.
- Goals screen uses `finance_transactions` in the same route as weekly and monthly goal planning.

### AI Coach

- `ai_coach_messages` persists chat messages.
- AI Coach reads recent meal, workout, weekly goal, and life score context.

## 12. AI Requirements

Current behavior:

- `callAI` requires an explicit purpose: `coach` or `body_recalibration`.
- Both purposes require an authenticated user whose profile has completed onboarding.
- `coach` is capped at two questions per UTC day using durable `ai_rate_limits` when the service-role secret is configured.
- `body_recalibration` is rejected until 14 days after `last_body_recalibration_at`.
- No other product surface calls `callAI`.

Required operational work:

- Decide provider strategy: keep OpenAI/Ollama or migrate to Gemini.
- Make provider names in Settings, Plan Reveal, AI Coach, and profile payload match the chosen provider.
- Deploy the updated `lifeos-ai` function with `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- Smoke-test coach quota and recalibration cooldown against the deployed backend.

AI surfaces:

- Body Progress: user-triggered AI target recalibration, once every 14 days.
- AI Coach: user-triggered chat response, at most two questions per UTC day.

## 13. Notifications And Background Work

Notification capabilities:

- Morning brief.
- Lunch calorie reminder.
- Workout reminder.
- Evening review.
- Weekly summary.
- AI anomaly alerts.
- Task-specific scheduled reminders.
- Persisted in-app notification inbox with unread/read state.

Background function:

- `lifeos-anomaly-alerts` checks:
  - Calories below 70 percent of goal for three recent days.
  - No recent workout in five days when weekly gym goal is four or more.

Requirements:

- Store scheduled and delivered app notifications in `notifications`.
- Include notification route metadata so taps can deep-link to the relevant screen.
- Align notification routes with Expo Router paths.
- Respect quiet hours.
- Avoid scheduling invalid times.
- Ensure anomaly function uses user-scoped data in production.

## 14. Security And Privacy Requirements

Current controls:

- Supabase Auth is the production auth model.
- Follow-up migration `202606140012_production_auth_rls_hardening.sql` replaces broad policies with owner-scoped `auth.uid()` checks.
- Anonymous profile/table access is revoked; username availability is exposed through a narrow security-definer function.
- OpenAI provider credentials are server-side in the `lifeos-ai` Edge Function.

Required hardening:

- Apply all migrations to the target Supabase project before release.
- Keep public profile reads disabled.
- Do not store or send unnecessary personal health data to AI providers.
- Keep app lock optional and local-only.

## 15. Current Release Gaps

High priority:

- Add missing Supabase table creation migrations for all tables used by code.
- Standardize workout set foreign key naming.
- Replace broad RLS policies with user-scoped policies.
- Fix AI provider consistency across code, labels, settings, and persisted profile payload.
- Decide whether the standalone Finance route should become a real screen or be removed from root stack.

Medium priority:

- Persist Life Score snapshots rather than only local calculation.
- Add CRUD for monthly goals, categories, and richer finance data.
- Replace fallback/generated analytics data with clear empty states where appropriate.
- Add error UI for Supabase table-missing failures.
- Add tests for plan generation parsing, workout task deduping, water upsert, and profile restore.

Low priority:

- Improve route naming so product names and route names match.
- Move large screen logic into domain hooks when behavior stabilizes.
- Add import/export for more than settings.

## 16. Acceptance Criteria For A Repo-Accurate MVP

The current LifeOS MVP is acceptable when:

- A clean Supabase project can run all migrations without missing-table failures.
- A new user can complete onboarding, reveal a plan, register, and land on Daily Hub.
- A returning user can login and restore profile, targets, generated plan, and split.
- Daily Hub can create/toggle tasks, sync water, show calories, show workout state, and produce a deterministic daily brief without AI.
- Home avatar opens editable Profile, and Home notification icon opens the persisted notification inbox.
- Nutrition can add foods, log meal items, apply templates, delete items, and clone yesterday.
- Gym can log sets, save sessions and sets, save optional body weight, complete workout task, and show workout history.
- Goals can load and create weekly goals, break monthly goals into weekly goals, and log finance transactions.
- Analytics loads real domain data when present and handles missing data deliberately.
- Weight logging remains in `body_metrics` until the eligible Generate AI targets action updates profile weight and targets together.
- AI Coach can load context, enforce two questions per UTC day in UI/backend, persist messages, and handle provider failure.
- Settings can open Profile, schedule notifications, validate times, toggle app lock, export settings, change AI model, and logout.
- Notifications inbox can load persisted notifications, mark one/all as read, and route notification taps.
- All user-owned data is protected by owner-scoped RLS or an equivalent access model.

## 17. Suggested Next PRD Decisions

These are product-owner decisions, not assumptions:

- Should LifeOS be Android-only, or should iOS/web remain supported because `app.json` and package scripts include them?
- Should AI provider be OpenAI/Ollama as implemented, or Gemini as a new migration?
- Should Finance become a standalone screen, or stay inside Goals?
- Should the legacy `app_users` table be dropped after deployed accounts are migrated?
- Should the app keep fallback demo data in production, or show explicit empty states until real data exists?
