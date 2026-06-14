# LifeOS Settings Flow And Standalone App Analysis

Date: 2026-06-14

## Purpose

This document analyzes the current LifeOS Settings flow, how it connects to the rest of the app, and what Settings should contain for LifeOS to become a standalone personal operating system instead of a mobile-first MVP with several local-only controls.

It uses three lenses:

- Business analyst lens: what settings the product needs to make the app self-serve and complete.
- Architect lens: where settings should live, what must sync, and what should remain device-local.
- UX lens: how Settings should feel like a control center rather than a long list of toggles.

## Sources Reviewed

- `docs/prd.md`
- `docs/architecture.md`
- `app/(tabs)/settings.tsx`
- `stores/useSettingsStore.ts`
- `stores/useUserStore.ts`
- `lib/notifications.ts`
- `lib/ai.ts`
- `lib/profile.ts`
- `app/profile.tsx`
- `app/_layout.tsx`
- `app/(onboarding)/login.tsx`
- `app/(onboarding)/register.tsx`
- `supabase/migrations/202606120001_onboarding_accounts.sql`
- `supabase/migrations/202606140004_notifications_profile_inbox.sql`
- BMAD agent notes from:
  - `.agents/skills/bmad-agent-analyst/`
  - `.agents/skills/bmad-agent-architect/`
  - `.agents/skills/bmad-agent-ux-designer/`

## Executive Summary

Settings currently matches the MVP requirement in `docs/prd.md`: profile shortcut, notification toggles, reminder times, quiet hours, AI provider choice, app lock, settings backup JSON, and logout.

The current flow is useful, but it is not yet a standalone app control plane because most settings are local-only and are not restored from the user's account. A returning user can restore profile and plan data from Supabase, but their settings preferences depend on local AsyncStorage on that device.

The biggest standalone gaps are:

- Account settings are minimal: no username management, password change, account deletion, session/device management, or data reset.
- Settings are not account-synced: `lifeos-settings` is persisted only in AsyncStorage.
- AI model selection is local-only and not aligned with `profiles.ai_model`, which is currently written as `'openai'` during registration.
- Backup only exports settings, not the user's profile, goals, nutrition, gym history, finance, AI coach messages, notifications, or templates.
- Import/restore is missing.
- Notification scheduling currently calls `cancelAllScheduledNotificationsAsync()`, which can cancel unrelated task reminders.
- Refreshing notification schedules creates persisted notification records, so repeated refreshes can leave scheduled-history noise in the notification inbox table.
- Quiet hour time inputs are not validated before save, only reminder times are validated.
- There is no visible permissions/status area for notification permission, background task status, AI provider readiness, Supabase sync status, or local data age.
- Security is app-lock only. Data privacy, AI context controls, and export/delete controls are missing.

Target direction: Settings should become a layered control center with three scopes:

- Account-synced settings stored in Supabase.
- Device-local settings stored in AsyncStorage.
- Domain settings stored with their owning domain tables or profile fields.

## Complete App Flow Snapshot

### 1. Onboarding And Registration

Current flow:

1. User enters basic profile, fitness profile, diet preferences, and meal timing.
2. Plan reveal calculates or generates calorie/macros/water/workout plan.
3. Register creates a username and password.
4. App inserts a `profiles` row.
5. App inserts an `app_users` row with `profile_id`.
6. App initializes water log.
7. Zustand stores profile/session/plan state locally.
8. User lands on tabs.

Settings dependency:

- Settings relies on `useUserStore.profile` for the profile card.
- Settings does not participate in registration except indirectly through default values in `useSettingsStore`.
- `buildProfilePayload()` stores `ai_model: 'openai'` regardless of the selected local settings model.

Standalone gap:

- A user preference captured before or after registration does not become a durable account preference unless it already belongs to `profiles`.

### 2. Login And Restore

Current flow:

1. User enters username/password.
2. App calls `verify_app_login`.
3. App loads `profiles`.
4. `profileFromRow()` restores profile, calorie goal, macros, generated plan, and onboarding status.
5. App restores gym split and redirects to the app.

Settings dependency:

- Login does not fetch or merge account settings.
- Settings values come from the local persisted `lifeos-settings` store on the current device.

Standalone gap:

- Login on a new device cannot restore notification preferences, quiet hours, AI provider, app preferences, privacy preferences, or backup preferences.

### 3. Daily Hub

Current flow:

- Shows greeting, profile-driven plan state, calories remaining, water, workout state, daily tasks, AI brief, and notification badge.
- Can schedule task notifications through `scheduleTaskNotification()`.
- Home notification icon opens `/notifications`.
- Home avatar opens `/profile`.

Settings dependency:

- Notification permission and schedule behavior are controlled in Settings.
- App lock is enforced globally by `app/_layout.tsx`.
- AI brief uses the active AI provider logic in `lib/ai.ts`.

Standalone gap:

- Task reminders and LifeOS recurring reminders share the same Expo notification scheduler. Settings refresh currently cancels all scheduled notifications, which can wipe task reminders.

### 4. Nutrition

Current flow:

- Uses profile targets and food preferences.
- Logs meals to Supabase nutrition tables.
- Can add food items, templates, clone yesterday, and sync water.

Settings dependency:

- Meal timing lives in Profile, not Settings.
- AI meal suggestions use `lib/ai.ts` and user food/cuisine context.

Standalone gap:

- Nutrition defaults should be surfaced in Settings or Profile: meal slots, food exclusions, cuisine preference, calorie calculation mode, default water target, units, and template reset/import/export.

### 5. Gym

Current flow:

- Uses generated/fallback workout split.
- Logs workout sessions, sets, body weight, and completes generated workout tasks.

Settings dependency:

- Workout reminder time and toggle live in Settings.
- Gym days, goal, target weight, and experience live in Profile.

Standalone gap:

- Gym defaults should be configurable: training days, rest days, default workout time, exercise units, body-weight prompt, default set targets, and whether gym completion should create/update goals automatically.

### 6. Goals And Finance

Current flow:

- Goals screen combines weekly/monthly goals and finance transaction logging.
- Finance also has a standalone route and service layer.
- Finance settings are separate in `finance_settings`.

Settings dependency:

- Currency exists in profile and finance settings, but Settings does not expose currency or budget preferences.
- Goal notification preferences are not centralized.

Standalone gap:

- Settings should expose currency, monthly income setup, finance category reset/export, goal cadence preferences, and default reminders.

### 7. Analytics

Current flow:

- Loads real domain data when present and otherwise uses placeholders/fallbacks in some areas.
- Life Score and charts are app-domain outputs.

Settings dependency:

- No analytics preferences in Settings today.

Standalone gap:

- Settings should control whether analytics uses generated fallback data or strict empty states, snapshot retention, and whether weekly summaries are generated/stored.

### 8. AI Coach

Current flow:

- AI calls are routed through `lib/ai.ts`.
- Settings store controls `aiModel`.
- OpenAI is used only when `allowOpenAI` is true, the selected model is not `ollama`, and an API key exists.
- Ollama uses `http://localhost:11434/api/generate`.

Settings dependency:

- Settings only exposes a simple `openai` / `ollama` segmented control.

Standalone gap:

- Standalone AI settings need provider status, model selection, endpoint configuration, API-key handling strategy, context-sharing controls, data redaction, and "AI off" mode.

### 9. Notifications Inbox

Current flow:

- `notifications` table stores inbox records.
- `/notifications` loads records for `currentUserId`.
- Tapping can mark a notification read and route to the relevant screen.
- Received notification handler updates delivery status.

Settings dependency:

- Settings toggles which recurring reminders are scheduled.
- AI anomaly alert toggle controls background alert checks.

Standalone gap:

- Settings should show notification permission status, scheduled reminder count, last refresh time, background check status, and a link to notification history/cleanup.

### 10. Profile

Current flow:

- Profile screen edits name, gender, age, height, weight, target weight, gym days, water target, goal, experience, and meal timing.
- Saves to `profiles` and updates local `useUserStore`.

Settings dependency:

- Settings profile card routes to `/profile`.

Standalone gap:

- Profile and Settings currently overlap conceptually. The product needs a clear split:
  - Profile: who the user is and what their body/goal plan is.
  - Settings: how the app behaves, syncs, protects data, sends reminders, and uses AI.

## Current Settings Flow

### Entry Point

Route:

- `app/(tabs)/settings.tsx`

Navigation:

- Opened from the bottom tab labelled `Setup`.
- Header action button calls `refreshSchedules()`.
- Profile card button routes to `/profile`.

### State Source

Settings uses `useSettingsStore`, persisted as:

- Storage key: `lifeos-settings`
- Storage engine: AsyncStorage

Current stored fields:

- `notifications`
  - `morning`
  - `lunch`
  - `workout`
  - `evening`
  - `weekly`
  - `aiAlerts`
- `quietHours`
  - `enabled`
  - `start`
  - `end`
- `notificationTimes`
  - `morning`
  - `lunch`
  - `workout`
  - `evening`
  - `weekly`
- `aiModel`
  - `openai`
  - `ollama`
- `appLockEnabled`

Important behavior:

- Toggle changes are saved locally immediately.
- Time input changes are saved locally immediately.
- Supabase is not called while changing most Settings controls.
- This explains why the browser Network tab can show no requests on `/settings`.

### Profile Card Flow

Current UI:

- Displays profile initial.
- Displays profile name and goal.
- Opens `/profile` with "View and edit profile".

Data:

- Reads from `useUserStore.profile`.
- Profile edits happen on the Profile screen, not Settings.

Assessment:

- This is a good MVP split.
- For standalone, add account identity and sync status near this area.

### Notification Toggle Flow

Current UI:

- Morning brief
- Lunch calories
- Workout reminder
- Evening review
- Weekly summary
- AI anomaly alerts

Current behavior:

- Each switch calls `setNotificationEnabled(row.key, value)`.
- The switch only updates local Settings state.
- Existing schedules are not updated until the user taps refresh.

Assessment:

- The delayed "Refresh schedules" model is understandable but easy to forget.
- A standalone app should either autosync schedules after changes or show a clear "Unsynced changes" state.

### Reminder Time Flow

Current UI:

- `HH:mm` text fields for morning, lunch, workout, evening, weekly.
- Invalid reminder times get error border.
- `refreshSchedules()` blocks scheduling if any reminder time is invalid.

Current behavior:

- Times are saved locally even if invalid.
- Validation runs only before refresh.

Assessment:

- MVP acceptable.
- Standalone should use a time picker and store only valid times.

### Quiet Hours Flow

Current UI:

- Toggle for quiet hours.
- Start and end text inputs.

Current behavior:

- Quiet hours are applied in `scheduleRepeatingNotification()`.
- If a reminder time falls within quiet hours, that reminder is skipped.
- Start/end values are not validated in the Settings UI before save.

Assessment:

- Quiet hours currently skip scheduling instead of deferring to the next allowed time.
- Standalone should make this explicit or reschedule to the next available window.

### Refresh Schedules Flow

Current code path:

1. Settings calls `scheduleLifeOSNotifications()`.
2. `lib/notifications.ts` checks whether Expo notifications are available.
3. It requests notification permission.
4. It reads settings, user state, nutrition state, and gym state.
5. It calls `cancelAllScheduledNotificationsAsync()`.
6. It schedules enabled recurring reminders.
7. It creates `notifications` table records for scheduled reminders.
8. It updates each record with the Expo device notification id.

Important issue:

- `cancelAllScheduledNotificationsAsync()` cancels all scheduled notifications, including one-off task reminders created from Daily Hub or Goals. This makes Settings refresh risky because it can silently remove user-created task reminders.

Second issue:

- Refreshing schedules creates new notification records each time. If a user taps refresh multiple times, the inbox table can accumulate scheduled records that are not meaningful user history.

Standalone recommendation:

- Namespace notification jobs by kind.
- Only cancel/reschedule LifeOS recurring reminders.
- Preserve task reminders unless explicitly cancelled.
- Store scheduled reminder definitions separately from delivered inbox messages.

### AI Model Flow

Current UI:

- Segmented control with `openai` and `ollama`.

Current behavior:

- Writes `aiModel` to local `lifeos-settings`.
- `lib/ai.ts` reads `useSettingsStore.getState().aiModel`.
- `buildProfilePayload()` still saves `ai_model: 'openai'` during registration.
- Login restore does not hydrate `useSettingsStore.aiModel` from `profiles.ai_model`.

Assessment:

- Runtime AI provider follows local settings.
- Account-level AI model is inconsistent.

Standalone recommendation:

- Decide whether AI provider is account-synced or device-local.
- Suggested split:
  - Preferred provider: account-synced.
  - API key and local Ollama endpoint: device-local/private.
  - AI context permissions: account-synced.

### Privacy And Backup Flow

Current UI:

- App lock switch.
- Backup settings JSON button.
- Logout button.

Current app lock behavior:

- Enabling app lock verifies hardware and enrollment.
- App lock state is persisted locally.
- `app/_layout.tsx` blocks app content behind local authentication when enabled.
- Web bypasses app lock.

Current backup behavior:

- `exportSettingsBackup()` returns JSON with only Settings fields.
- The JSON is shown in a modal.
- There is no file save/share flow.
- There is no import/restore flow.

Current logout behavior:

- Calls `resetAuth()`.
- Redirects to login.
- Leaves many persisted local store values intact except session/profile/onboarding flags.

Assessment:

- App lock is a good device-local feature.
- Backup is too narrow for a standalone app.
- Logout should clarify whether local cached data remains.

## What Works Well Today

- Settings is scoped and understandable.
- The PRD requirements for Settings are mostly implemented.
- The UI is mobile-first and follows the app's dark control-center style.
- Profile is editable from Settings.
- Notification settings cover the main app rhythms: morning, lunch, workout, evening, weekly, AI alerts.
- Reminder times are user-editable.
- AI provider can be switched without changing code.
- App lock is integrated into the root layout.
- Notification inbox persistence exists.
- Settings backup JSON is a useful starting point.

## Main Problems To Fix

### 1. Settings Are Local-Only

Problem:

- `lifeos-settings` is AsyncStorage-only.
- Login on another device does not restore settings.

Impact:

- The app does not feel standalone across devices or reinstalls.

Fix:

- Add an account settings table or a `profile_settings` JSON column.
- On login, hydrate settings from Supabase.
- On settings change, save locally first and sync in the background.

### 2. Notification Schedule Refresh Can Remove Task Reminders

Problem:

- `scheduleLifeOSNotifications()` calls `cancelAllScheduledNotificationsAsync()`.

Impact:

- Any existing task reminders can be deleted when the user refreshes recurring LifeOS reminders.

Fix:

- Add notification metadata like `scheduler: 'lifeos_recurring' | 'task'`.
- Cancel only matching recurring reminders.
- Keep a local/synced registry of scheduled notification identifiers by type.

### 3. Scheduled Reminder Records Are Mixed With Inbox History

Problem:

- Settings refresh creates `notifications` rows for future scheduled reminders.

Impact:

- The inbox can include technical schedule records rather than meaningful delivered user messages.

Fix:

- Split reminder definitions from inbox messages:
  - `notification_preferences`
  - `scheduled_notifications`
  - `notifications` for delivered or user-visible messages

### 4. AI Provider Is Inconsistent

Problem:

- Runtime setting is local.
- `profiles.ai_model` exists but registration always writes `openai`.
- Login does not restore AI model into settings.

Impact:

- User intent and stored account data can diverge.

Fix:

- Make `ai_model` a real setting.
- Sync it either to profile or to a new account settings table.
- Use one enum/list across Settings, Plan Reveal, AI Coach, and profile payload.

### 5. Backup Is Not A Real Backup

Problem:

- Current export includes only settings.

Impact:

- A user cannot restore their actual LifeOS data.

Fix:

- Rename current feature to "Export settings".
- Add "Export LifeOS data" that includes profile, targets, nutrition, gym, goals, finance, notifications, templates, and AI coach messages.
- Add import with validation and conflict handling.

### 6. Account Controls Are Missing

Problem:

- No password change, username change, delete account, reset app data, or logout-all-devices behavior.

Impact:

- Users cannot manage ownership of the app.

Fix:

- Add Account section with credential and data ownership actions.

### 7. Permission And Sync Status Are Invisible

Problem:

- Settings has controls but not health/status.

Impact:

- The user cannot tell whether notifications, background tasks, AI, Supabase sync, or backups are working.

Fix:

- Add a "System status" card:
  - Signed in as
  - Last sync
  - Notification permission
  - Background checks
  - AI provider readiness
  - Backup age
  - App version

## What Settings Should Contain For Standalone LifeOS

### 1. Account

Purpose:

- Let the user own identity, credentials, session, and account lifecycle.

Recommended controls:

- Username
- Display name shortcut
- Change password
- Account email or recovery method if Supabase Auth is adopted
- Logout
- Delete account
- Reset local cache
- Reset all cloud data
- Active device/session list when auth supports it

Storage:

- Synced: account identity, recovery metadata.
- Local-only: current device session cache.

### 2. Profile And Plan

Purpose:

- Make plan-defining data accessible without burying it in onboarding.

Recommended controls:

- Open full profile editor
- Fitness goal
- Current weight and target weight
- Gym days per week
- Experience level
- Calories/macros target review
- Water target
- Regenerate plan
- Recalculate calories from profile
- Plan history or last generated date

Storage:

- Mostly `profiles`.
- Generated plan in `profiles.first_week_plan` or future plan table.

UX note:

- Keep heavy editing in `/profile`; Settings should summarize and route.

### 3. Notifications And Reminders

Purpose:

- Control reminders and alert delivery with visible status.

Recommended controls:

- Notification permission status
- Enable all/disable all
- Morning brief
- Meal reminders
- Water reminders
- Workout reminders
- Goal/task reminders
- Evening review
- Weekly summary
- AI anomaly alerts
- Quiet hours
- Snooze all reminders
- Reminder timezone
- Last schedule refresh
- Open notification inbox
- Clear notification history

Storage:

- Synced: reminder preferences, preferred times, quiet hours.
- Local-only: device notification identifiers, permission state.

Architecture note:

- Separate recurring reminders from task reminders.

### 4. AI And Personalization

Purpose:

- Let the user control how AI is used and what data AI can see.

Recommended controls:

- AI enabled/off
- Provider: OpenAI, Ollama, none
- Model selection
- Local Ollama endpoint
- OpenAI key strategy or server-side key status
- Allow AI to use nutrition data
- Allow AI to use gym data
- Allow AI to use goals/finance data
- Redact sensitive profile fields
- Clear AI coach chat history
- Test AI connection
- Show active model label

Storage:

- Synced: preferred provider, allowed context domains, AI on/off.
- Local-only: API keys, local endpoint, connection test cache.

Security note:

- Do not put private API keys into broad-readable tables.

### 5. Privacy And Security

Purpose:

- Make data protection explicit.

Recommended controls:

- App lock
- Lock immediately / after delay
- Hide sensitive values in app switcher if supported
- Export personal data
- Delete personal data
- AI data sharing controls
- Crash/diagnostic sharing toggle if added
- Privacy summary

Storage:

- Local-only: app lock enabled, lock timeout, biometric preference.
- Synced: privacy consent choices, AI context choices.

### 6. Data, Sync, Backup, And Restore

Purpose:

- Make the app self-sufficient across reinstall, migration, and debugging.

Recommended controls:

- Last cloud sync time
- Sync now
- Offline mode status
- Export settings JSON
- Import settings JSON
- Export full LifeOS data
- Import full LifeOS data
- Backup destination if later added
- Clear local cache
- Rebuild local cache from Supabase
- Data table health check for development builds

Storage:

- Synced: backup preferences.
- Local-only: sync diagnostics and cache metadata.

Standalone requirement:

- A clean install plus login should restore enough data for the app to be usable without repeating onboarding.

### 7. Units, Locale, And Appearance

Purpose:

- Let the app adapt to user defaults.

Recommended controls:

- Measurement system: metric/imperial
- Weight unit
- Height unit
- Water unit
- Currency
- Week starts on: Monday/Sunday
- Time format: 12-hour/24-hour
- Theme: dark/system/future light mode
- Reduce motion

Storage:

- Synced: measurement, currency, week start, time format.
- Local-only: device-specific theme override if desired.

Current note:

- `currency: 'INR'` and `measurements: 'metric'` are hard-coded in profile type and parsing. Standalone settings should make these user-configurable before widening markets.

### 8. Nutrition Defaults

Purpose:

- Make diet logging less dependent on onboarding-only choices.

Recommended controls:

- First meal time
- Last meal time
- Meal slot names and count
- Cuisine preferences
- Foods eaten/preferred
- Foods avoided
- Calorie target strategy: manual/AI/calculated
- Macro target editor
- Water target
- Template management
- Clear today's nutrition
- Reset food database/templates

Storage:

- Profile for long-lived preferences.
- Nutrition tables for templates and foods.

UX note:

- Settings should summarize and route to a detailed Nutrition Preferences screen if the list grows.

### 9. Gym Defaults

Purpose:

- Make workout behavior controllable after onboarding.

Recommended controls:

- Training days
- Preferred workout time
- Workout split
- Default rest days
- Default set target
- Default rep range
- Body weight prompt on save
- Auto-complete gym task when session saved
- Regenerate workout plan

Storage:

- Profile for gym days and split.
- Future workout settings table for behavior defaults.

### 10. Goals And Planning

Purpose:

- Control planning cadence and task behavior.

Recommended controls:

- Week start day
- Default daily task reminder
- Default priority
- Auto-create weekly goals from monthly goals
- Auto-create workout tasks
- Goal category management
- Archive completed goals

Storage:

- Synced user settings for behavior.
- Goal categories/goals in domain tables.

### 11. Finance

Purpose:

- Make finance usable as part of LifeOS instead of an isolated route.

Recommended controls:

- Currency
- Monthly income
- Spending/savings rule
- Category allocation percentages
- Reset default categories
- Export finance data
- Hide finance amounts in previews

Storage:

- `finance_settings`
- `finance_categories`
- Possibly synced privacy setting for hiding amounts.

### 12. Support, Diagnostics, And About

Purpose:

- Help the user understand and repair the app.

Recommended controls:

- App version/build
- Supabase connection status
- Notification runtime support
- Background task support
- AI provider status
- Run diagnostics
- Copy debug report
- Open docs/support link if published

Storage:

- Mostly runtime-only.

## Recommended Settings Information Architecture

Proposed top-level Settings screen:

1. Account
   - User card, username, sync status, logout.
2. Profile and Plan
   - Profile summary, calorie/macros/water, edit/regenerate.
3. Reminders
   - Notification permission, main reminder toggles, quiet hours, schedule status.
4. AI Coach
   - Provider, model, connection, context permissions.
5. Privacy and Security
   - App lock, AI data sharing, export/delete.
6. Data and Backup
   - Sync now, export/import, clear cache.
7. App Preferences
   - Units, currency, week start, time format, theme.
8. Domain Preferences
   - Nutrition, gym, goals, finance shortcuts.
9. About and Diagnostics
   - Version, runtime status, debug report.

For mobile UX, avoid one very long page. Keep the current Control Center summary, then route into detail screens:

- `/settings/account`
- `/settings/reminders`
- `/settings/ai`
- `/settings/privacy`
- `/settings/data`
- `/settings/preferences`
- `/settings/domain`
- `/settings/about`

## Data Ownership Model

Recommended setting scopes:

| Setting | Scope | Suggested storage |
| --- | --- | --- |
| App lock | Device-local | AsyncStorage |
| Notification permission | Device-local | OS/runtime |
| Expo notification identifiers | Device-local | AsyncStorage or local notification registry |
| Reminder preferences | Account-synced | `user_settings` or `notification_preferences` |
| Quiet hours | Account-synced | `user_settings` or `notification_preferences` |
| AI preferred provider | Account-synced | `user_settings.ai` or `profiles.ai_model` |
| AI API key | Device-local or backend secret | Never public profile table |
| Ollama endpoint | Device-local | AsyncStorage |
| AI context permissions | Account-synced | `user_settings.ai_context_permissions` |
| Units/currency/week start | Account-synced | `user_settings.preferences` or profile columns |
| Profile/body/goal values | Account-synced | `profiles` |
| Finance income/currency | Account-synced | `finance_settings` |
| Backup/export preferences | Account-synced | `user_settings.backup` |
| Sync status | Device-local plus server timestamps | AsyncStorage and table `updated_at` |

## Recommended Supabase Additions

### Option A: One General Settings Table

Good for fast product iteration.

```sql
create table public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notifications jsonb not null default '{}'::jsonb,
  quiet_hours jsonb not null default '{}'::jsonb,
  ai jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  privacy jsonb not null default '{}'::jsonb,
  backup jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);
```

Pros:

- Fast to add.
- Easy to hydrate `useSettingsStore`.
- Flexible while the app is still changing.

Cons:

- JSON shape must be validated in app code.
- Harder to query/report specific settings.

### Option B: Domain-Specific Settings Tables

Good for long-term clarity.

Examples:

- `notification_preferences`
- `ai_preferences`
- `app_preferences`
- `privacy_preferences`

Pros:

- Clear ownership.
- Easier validation and migrations.
- Better for future backend jobs.

Cons:

- More migrations and service code.
- Slightly slower to build.

Recommended path:

- Start with `user_settings` for app-level settings.
- Keep finance settings in `finance_settings`.
- Keep profile/plan settings in `profiles`.
- Later split high-volume or backend-owned settings into dedicated tables.

## Recommended Service Layer

Add:

- `lib/settingsService.ts`

Responsibilities:

- Load account settings by `userId`.
- Merge defaults with stored settings.
- Save settings patches.
- Export settings.
- Import settings with schema validation.
- Track sync status and conflicts.

Store changes:

- Keep `useSettingsStore` as UI/local state.
- Add hydration actions:
  - `hydrateSettings(settings)`
  - `resetSettings()`
  - `markSettingsSynced(timestamp)`
  - `markSettingsDirty()`

Login flow change:

1. Verify credentials.
2. Load profile.
3. Load user settings.
4. Hydrate user store.
5. Hydrate settings store.
6. Redirect to tabs.

Settings update change:

1. User changes control.
2. Store updates immediately.
3. Mark dirty.
4. Save patch to Supabase in background.
5. Show sync status if it fails.

## UX Improvements To Current Screen

### Quick Fixes

- Rename bottom nav label from `Setup` to `Settings` unless the product intentionally wants a setup/control-center metaphor.
- Add a status line under reminders: "Last scheduled: never/today at 7:02 PM".
- Show "Unsynced reminder changes" after toggles/time edits until refresh completes.
- Use time pickers instead of raw `HH:mm` inputs.
- Validate quiet hour start/end.
- Add "Open notification inbox" under Reminders.
- Add "Test notification" button.
- Add "Test AI provider" button.
- Rename "Backup settings JSON" to "Export settings JSON".
- Add "Import settings JSON" once export exists.
- Add "Clear local cache" only behind a confirmation modal.

### Medium UX Upgrade

- Convert the page into summary cards:
  - Account
  - Reminders
  - AI
  - Privacy
  - Data
  - Preferences
- Each summary card opens a detail screen.
- Keep only the most important toggle/status on the main screen.

### Standalone UX Upgrade

- Add a "System status" card at the top:
  - Signed in
  - Cloud sync
  - Notifications
  - AI
  - App lock
  - Backup

This turns Settings from a static list into a confidence dashboard.

## Implementation Roadmap

### Phase 0: Fix Current MVP Risks

1. Stop `scheduleLifeOSNotifications()` from cancelling task reminders.
2. Add notification schedule namespacing.
3. Validate quiet hour times.
4. Add schedule status and unsynced state.
5. Align `aiModel` with `profiles.ai_model` or remove the unused profile field until sync exists.
6. Rename backup to export settings.
7. Add "Import settings JSON" for the current settings shape.

### Phase 1: Make Settings Account-Synced

1. Add `user_settings` table.
2. Add `lib/settingsService.ts`.
3. Add hydration on login.
4. Add background save on setting changes.
5. Add logout behavior that clearly preserves or clears local settings.
6. Add sync status UI.

### Phase 2: Make LifeOS Standalone

1. Add full data export/import.
2. Add password change and account deletion.
3. Add reset local cache and rebuild from cloud.
4. Add AI context permissions.
5. Add units, currency, week start, and time format.
6. Add notification diagnostics and test notification.
7. Add provider diagnostics and test AI connection.

### Phase 3: Product Polish

1. Split Settings into subroutes.
2. Add searchable Settings.
3. Add setting-level help text only where users need confidence.
4. Add "recommended setup" checklist for new users.
5. Add cloud backup automation if the product needs it.

## Acceptance Criteria For Standalone Settings

LifeOS Settings can be considered standalone-ready when:

- A user can install the app on a new device, login, and recover app preferences.
- A user can change notification preferences and know whether schedules are active.
- Recurring reminder refresh never deletes task reminders.
- AI provider selection is consistent across Settings, AI Coach, onboarding/profile payloads, and persisted account data.
- A user can export and import settings.
- A user can export all LifeOS data.
- A user can delete account data.
- App lock remains device-local and does not block account recovery.
- Settings clearly shows notification permission, sync, AI, and backup status.
- Domain defaults for nutrition, gym, goals, and finance are reachable after onboarding.
- Every setting has a clear storage owner: local device, account settings, profile, or domain table.

## Recommended Next Development Task

Build the smallest standalone foundation first:

1. Create `user_settings` migration.
2. Create `lib/settingsService.ts`.
3. Add `hydrateSettings()` to `useSettingsStore`.
4. Load settings during login.
5. Save settings patches from Settings.
6. Fix notification schedule namespacing so recurring refresh does not cancel task reminders.

This gives LifeOS the missing control-plane layer without redesigning the entire app at once.
