# Finance Transaction Flow Analysis

## Purpose

This document explains how the Finance transaction experience should work in LifeOS before implementation begins.

At the start of this work, the repository had a Finance tab inside `app/(tabs)/goals.tsx`, but that tab only showed an empty state. The standalone `app/finance.tsx` route was also a blank placeholder. The PRD expected finance transactions, and Analytics already tried to read `finance_transactions`, but the database migration for finance tables was still missing.

The goal of this analysis is to define a simple, truthful, buildable v1 finance flow as a standalone LifeOS section.

## Implementation Status

Initial standalone transaction tracking has been started:

- `app/finance.tsx` is the standalone Finance route.
- `lib/financeService.ts` owns finance reads, income settings, default category setup, transaction saves, and summary helpers.
- `supabase/migrations/202606130009_finance_tracker.sql` creates finance categories, finance settings, and transactions.
- `supabase/migrations/202606130010_finance_income_budget.sql` upgrades existing finance data to income-based budgeting.
- `supabase/migrations/202606130011_finance_80_20_budget_rule.sql` updates existing users to an 80% spending and 20% savings rule.
- `app/(tabs)/goals.tsx` links to Finance with a shortcut card instead of embedding Finance as a Goals tab.
- `app/(tabs)/analytics.tsx` scopes finance reads by `currentUserId`.

## Current State

### Product State

The PRD currently says the Goals screen should combine:

- Weekly goals
- Monthly goals
- Finance

The Finance section should support:

- Loading finance transactions
- Adding finance transactions
- Feeding finance data into Analytics

### Code State

Pre-build implementation:

- `app/(tabs)/goals.tsx` has an internal `Finance` tab.
- `renderFinance()` returned an empty state that said dummy transactions were removed.
- `app/finance.tsx` exists but renders only a dark empty view.
- `app/(tabs)/analytics.tsx` queried `finance_transactions`, but did not filter those rows by `currentUserId`.

Target implementation, now started:

- `app/finance.tsx` becomes the real Finance screen.
- `app/(tabs)/goals.tsx` returns to goal planning only.
- Finance is opened from a lightweight entry point instead of being embedded inside Goals.
- Finance is not added as an eighth bottom tab in v1.

### Database State

The architecture document defines target tables:

- `finance_categories`
- `finance_transactions`

The implementation also adds:

- `finance_settings`

At the start of this work, there was no migration creating those tables.

This means a UI-only build would compile, but real transaction persistence will fail on a clean Supabase project until the migration exists.

## Key Product Decisions

### Decision 1: Finance Should Be Standalone

Finance should not live inside Goals.

Reason:

Goals and Finance have different mental models.

Goals is about:

- Monthly goals
- Weekly goals
- Daily tasks
- Execution progress

Finance is about:

- Transactions
- Budgets
- Spending categories
- Monthly summaries
- Recent expenses
- Financial analytics

Keeping Finance inside Goals would make `goals.tsx` too large and would make money tracking feel like a subtype of goal planning. Finance is a separate LifeOS domain and should have its own route.

### Decision 2: Do Not Add Finance To Bottom Tabs Yet

The bottom tab bar already has six tabs:

- Home
- Diet
- Gym
- Goals
- Analytics
- Settings

Adding Finance as an eighth bottom tab would make navigation crowded. V1 should use the existing standalone route:

```text
app/finance.tsx
```

Recommended entry points:

- A Finance shortcut card on the Goals screen.
- A Finance shortcut card on Analytics.
- Optional quick link from Home later.

### Decision 3: V1 Is Expense Tracking Only

Finance v1 should focus on expense tracking only.

Do not include these in the first build:

- Income transaction tracking
- Wallets or bank accounts
- Recurring bills
- Split payments
- Debt tracking
- Investment tracking
- Multi-currency support

These can be added later. The current LifeOS need is a fast spending tracker that helps the user understand where money is going.

### Decision 4: Budgets Come From Monthly Income

Finance should not use random fixed budgets.

The user enters a monthly salary or income. LifeOS keeps a savings target separate and derives expense category budgets only from the spending portion.

Default allocation plan:

```text
Spending categories  80%
Savings target       20%
```

Default spending category plan:

```text
Food      30%
Gym       10%
Travel    10%
Shopping  15%
Other     15%
```

Example:

```text
Monthly income: ₹50,000

Savings target  ₹10,000
Spending budget ₹40,000

Food      ₹15,000
Gym       ₹5,000
Travel    ₹5,000
Shopping  ₹7,500
Other     ₹7,500
```

If income is not set:

- Category budgets should show `₹0`.
- The Finance screen should prompt the user to add monthly income.
- Transactions can still be added.

## Recommended V1 User Flow

### 1. Open Finance

The user opens:

```text
Goals -> Finance shortcut -> app/finance.tsx
```

Finance should open as its own route.

The route already exists:

```text
app/finance.tsx
```

This route should become the source of truth for the Finance UI. The internal Finance tab in `app/(tabs)/goals.tsx` should be removed.

### 2. Set Monthly Income

Before useful budgets can appear, the user enters:

```text
Monthly salary or income
```

The app stores it in `finance_settings.monthly_income`.

After saving income:

- Category budgets are generated from allocation percentages.
- The monthly summary uses the generated spending budget, not the full income.
- Category cards show their income allocation percentage.

### 3. See Monthly Overview

The top of the Finance screen should show a monthly summary:

```text
Total Spent
₹18,450
of ₹40,000 spending budget
₹21,550 remaining
46% used
```

The summary should be calculated from real transactions for the current month.

Required calculations:

- `monthlySpent = sum(current month transaction amounts)`
- `monthlyIncome = finance_settings.monthly_income`
- `monthlyBudget = sum(category monthly budgets derived from income allocation)`
- `savingsTarget = monthlyIncome * 20%`
- `remaining = monthlyBudget - monthlySpent`
- `usedPercent = monthlySpent / monthlyBudget`

If no budget exists yet:

- Show total spent.
- Hide or soften the budget percentage.
- Prompt the user to set budgets later, but do not block transaction entry.

### 4. Review Category Spend

The screen should show horizontal category cards:

```text
Food      ₹4,200 / ₹5,000
Gym       ₹1,500 / ₹2,000
Travel    ₹2,100 / ₹3,000
Shopping  ₹5,800 / ₹4,000
Other     ₹4,850 / ₹6,000
```

Each card should show:

- Category icon
- Category name
- Amount spent this month
- Monthly category budget derived from income
- Allocation percentage
- Progress bar
- Overspent visual state when spending exceeds budget

Default categories for v1:

- Food
- Gym
- Travel
- Shopping
- Other

### 5. Add Transaction

The user taps the floating `+` button.

A bottom sheet should open with a fast transaction form:

```text
Amount
Title or merchant
Category
Date
Note optional
Save
```

Recommended field behavior:

- `Amount` should be required and numeric.
- `Title` should be required.
- `Category` should default to the first available category, probably `Food`.
- `Date` should default to today.
- `Note` should be optional.

The form should be optimized for quick entry, not accounting-level detail.

### 6. Save Transaction

On save, insert into `finance_transactions`:

```text
user_id
finance_category_id
title
merchant
category
amount
note
date
```

Recommended mapping:

- Use the form title as `title`.
- Use the same text as `merchant` for v1 unless a separate merchant field is added later.
- Store the selected category name in `category` as a denormalized label.
- Store the category id in `finance_category_id`.
- Store only positive values for expenses in v1.

After save:

- Close the sheet.
- Reload or locally append the transaction.
- Recalculate monthly summary.
- Recalculate category cards.
- Show the new transaction under recent transactions.

### 7. Show Recent Transactions

The screen should show the latest transactions grouped by date.

Example:

```text
Today

Lunch - Hyderabad Biryani
1:15 PM - Food
-₹180

Auto - Kondapur to Madhapur
9:10 AM - Travel
-₹85
```

For v1, show the latest 20 to 30 transactions.

## Screen Structure

Recommended standalone Finance screen layout:

```text
Header
  Finance
  Back button
  Search optional
  Settings optional

Period Toggle
  Daily | Monthly | Yearly

Monthly Summary Card
  Total spent
  Monthly budget
  Remaining
  Progress ring
  Warning if overspending

Category Cards
  Horizontal scroll

Savings Goal Card
  Optional for v1 display only
  Do not persist savings goals yet unless a separate goal model is defined

Recent Transactions
  Today
  Yesterday
  Earlier

Floating Add Button
```

The provided Stitch mockup is a strong visual target. The React Native implementation should use existing LifeOS tokens from `lib/design.ts`.

## Navigation Plan

### V1 Navigation

Finance should be reachable but not part of the bottom tabs.

Recommended V1 structure:

```text
Bottom tabs
  Home
  Diet
  Gym
  Goals
  Analytics
  Settings

Standalone routes
  Finance
```

The user can reach Finance from:

```text
Goals screen -> Finance shortcut card
Analytics screen -> Finance insight card
```

The Finance screen should include a back affordance because it is outside the tab stack.

### Goals Screen Change

Current Goals tabs:

```text
This Week | This Month | Finance
```

Target Goals tabs:

```text
This Week | This Month
```

Add a small finance entry card somewhere below the main goal summary or near the bottom:

```text
Finance
Track spending, budgets, and recent transactions
Open Finance
```

This keeps Goals focused while still making Finance discoverable.

### Why Not Bottom Tab Yet

Finance can become a bottom tab later if usage proves it deserves first-level navigation.

Promotion criteria:

- User opens Finance daily.
- Finance gains deeper workflows like budgets, recurring transactions, savings goals, or reports.
- One of the existing seven tabs can be merged, removed, or demoted.

Until then, a standalone route is cleaner.

## Data Model

### `finance_categories`

Purpose:

Finance categories, allocation percentages, and generated budgets.

Recommended columns:

```text
id uuid primary key default gen_random_uuid()
user_id uuid references public.profiles(id) on delete cascade null
name text not null
monthly_budget numeric default 0
allocation_percent numeric default 0
color text
icon text
created_at timestamptz default now()
updated_at timestamptz default now()
```

Notes:

- `user_id` can be nullable if global categories are supported.
- For the current custom login model, user-created categories should have `user_id = currentUserId`.
- Default categories can be inserted per user on first load.
- `monthly_budget` is generated from `finance_settings.monthly_income`.
- `allocation_percent` stores how income is split across categories.

### `finance_settings`

Purpose:

Stores the user's monthly income and budget currency.

Recommended columns:

```text
id uuid primary key default gen_random_uuid()
user_id uuid not null references public.profiles(id) on delete cascade
monthly_income numeric default 0
currency text default 'INR'
created_at timestamptz default now()
updated_at timestamptz default now()
```

### `finance_transactions`

Purpose:

Individual expense transactions.

Recommended columns:

```text
id uuid primary key default gen_random_uuid()
user_id uuid not null references public.profiles(id) on delete cascade
finance_category_id uuid references public.finance_categories(id) on delete set null
title text
merchant text
category text
amount numeric not null
note text
date date default current_date
created_at timestamptz default now()
updated_at timestamptz default now()
```

Indexes:

```text
finance_transactions(user_id, date desc)
finance_categories(user_id, name)
finance_settings(user_id)
```

## State And Loading Behavior

Finance screen state should include:

```text
financeCategories
financeSettings
financeTransactions
financeLoading
financeSaving
financeError
incomeSheetVisible
transactionSheetVisible
transactionDraft
```

The screen should load:

- Categories for the current user.
- Finance settings for the current user.
- Current month transactions for the current user.
- Recent transactions for the current user.

All finance reads must filter by `currentUserId`.

Because Finance is moving out of `goals.tsx`, finance state should live in the Finance route or a service module, not in the Goals screen.

Recommended:

- Keep screen-local state in `app/finance.tsx` for v1.
- Put Supabase reads and writes in `lib/financeService.ts`.
- Keep reusable data types near the service or screen until they are needed elsewhere.

## Empty States

### No Transactions

Show:

```text
No transactions yet
Add your first expense to start tracking this month.
```

The `+` button should still be visible.

### No Categories

The app should automatically seed default categories.

If seeding fails, show:

```text
Finance categories need setup
Retry
```

### Missing Schema

If Supabase returns a missing table error, show:

```text
Finance needs schema update
Run the finance migration, then retry.
```

This is better than silently showing fake data.

## Validation Rules

Transaction save should require:

- Logged-in user
- Amount greater than 0
- Title or merchant
- Valid date in `YYYY-MM-DD` format
- Category id or category label

Invalid examples:

- Empty amount
- Negative amount
- Zero amount
- Empty title
- Invalid date

## Analytics Impact

Current Analytics reads finance transactions without user scoping.

This should be changed from:

```text
finance_transactions where date between start and today
```

To:

```text
finance_transactions
  where user_id = currentUserId
  and date between start and today
```

Finance score can stay simple for now:

```text
financeScore = monthlyBudget > 0
  ? max(0, 100 - overspendPercent)
  : fallback score
```

For v1, Analytics should only need transaction count and amount totals.

## Recommended Implementation Order

### Phase 1: Schema

Add migration:

```text
202606130009_finance_tracker.sql
202606130010_finance_income_budget.sql
202606130011_finance_80_20_budget_rule.sql
```

They should create or upgrade:

- `finance_categories`
- `finance_settings`
- `finance_transactions`
- Indexes
- Grants
- Temporary permissive RLS policies matching the current app pattern
- `allocation_percent` on finance categories
- 80/20 spending and savings allocation rule

Security note:

The current app uses custom app-level auth and several broad anonymous policies. Finance should follow the current project pattern for now, but the architecture still needs a future owner-scoped RLS hardening pass.

### Phase 2: Finance Data Helpers

Create:

```text
lib/financeService.ts
```

Do not add finance reads and writes to `goals.tsx`.

Required helpers:

- `ensureDefaultFinanceCategories(userId)`
- `ensureFinanceSettings(userId)`
- `loadFinance(userId)`
- `saveFinanceIncome(userId, monthlyIncome, categories)`
- `saveFinanceTransaction(draft)`
- `summarizeMonthlyFinance(categories, transactions)`

### Phase 3: UI

Build the real screen in:

```text
app/finance.tsx
```

The screen should include:

- Monthly income card
- Summary card
- Category cards
- Recent transaction list
- Empty state

Reuse:

- `ProgressRing`
- `colors`
- `typography`
- `spacing`
- `radii`

Also update:

```text
app/(tabs)/goals.tsx
```

Remove:

- `finance` from the internal tab type.
- The Finance tab label.
- `renderFinance()`.

Add:

- A Finance shortcut card that routes to `/finance`.

### Phase 4: Add Income And Transaction Sheets

Add two modals inside `app/finance.tsx`:

- Income modal for salary/monthly income.
- Transaction modal for expense entry.

Reason:

Income setup and transaction creation have different mental models. Keeping them separate makes the UI and code easier to understand.

### Phase 5: Analytics Fix

Update Analytics finance query to filter by `currentUserId`.

## Acceptance Criteria

Finance v1 is ready when:

- A clean database has finance tables after migrations run.
- A logged-in user can open the standalone `app/finance.tsx` Finance screen.
- Goals no longer has an internal Finance tab.
- Goals has a simple Finance shortcut card or button.
- User can add monthly salary or income.
- Category budgets are derived from monthly income.
- No fixed random category budget values appear before income is set.
- The screen shows a truthful empty state when no transactions exist.
- Default finance categories are created for the user.
- User can add an expense transaction.
- Saved transactions persist in Supabase.
- Monthly total updates after save.
- Category totals update after save.
- Recent transactions show real saved rows.
- Analytics reads only the current user's finance rows.
- No dummy finance transactions are shown.

## Open Questions

These do not block v1:

- Should Finance eventually become its own bottom tab?
- Should budgets be editable in the first release?
- Should savings goals use the existing monthly goals model or a separate finance goal model?
- Should transactions support income later?
- Should recurring subscriptions be detected automatically?

## Recommendation

Build the Finance transaction flow outside Goals in:

```text
app/finance.tsx
```

Remove Finance from the internal Goals tabs. Keep a small route link from Goals to Finance so the section stays discoverable.

This gives Finance a clean domain boundary now without making the bottom navigation heavier. If Finance becomes a daily-use area, promote it to a bottom tab later.
