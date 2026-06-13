# LifeOS Goals Flow Plan

## Purpose

The Goals section should become the planning spine of LifeOS:

```text
Monthly Goals -> Weekly Goals -> Daily Goals
```

The user should be able to create a monthly direction, break it into weekly execution goals, and then convert those weekly goals into daily tasks that appear in the Daily Hub.

## Current Problem

The current Goals screen is not clean yet because it contains dummy fallback data.

Current issues:

- Weekly goals show hardcoded sample goals when the database is empty.
- Monthly goals show hardcoded sample goals when the database is empty.
- Finance transactions show hardcoded sample transactions.
- Categories are fixed in code as `Work` and `Health`.
- `Learning` is missing, even though the product currently needs `Learning`, `Work`, and `Health`.
- The frontend inserts/reads a `current` column on `weekly_goals`, but Supabase reports that column is missing from the schema cache.
- Monthly, weekly, and daily goals are not strongly linked yet.

This makes the app feel full but not truthful. A clean database should show a clean empty state.

## Target Mental Model

```text
Category
  -> Monthly Goal
      -> Weekly Goal
          -> Daily Task
```

Example:

```text
Learning
  Monthly Goal: Complete React Native module
    Weekly Goal: Finish navigation and Supabase lessons
      Daily Task: Watch lesson 12
      Daily Task: Build one small screen
      Daily Task: Revise notes
```

Another example:

```text
Health
  Monthly Goal: Drop 2 kg while keeping strength
    Weekly Goal: Complete 4 gym sessions
      Daily Task: Push workout
      Daily Task: Pull workout
      Daily Task: Legs workout
      Daily Task: 10k steps
```

## Categories

Initial default categories:

- Learning
- Work
- Health

Categories should be dynamic.

When adding a monthly goal, the user can:

- Select an existing category.
- Create a new category inline.

Example:

```text
Add Monthly Goal
Title: Save emergency fund
Category: + Finance
```

After saving, `Finance` becomes available as a category everywhere.

## Data Model Plan

### `goal_categories`

Stores dynamic categories.

```text
id
user_id
name
color
icon
sort_order
created_at
```

Default rows for a new user:

```text
Learning
Work
Health
```

### `monthly_goals`

Monthly goals are parent goals.

```text
id
user_id
category_id
title
target_value
current_value
unit
month_start
status
created_at
updated_at
```

Example:

```text
title: Complete React Native module
category: Learning
target_value: 10
current_value: 0
unit: lessons
month_start: 2026-06-01
```

### `weekly_goals`

Weekly goals belong to a category and can optionally link to a monthly goal.

```text
id
user_id
category_id
monthly_goal_id
title
target_value
current_value
unit
week_start
created_at
updated_at
```

Example:

```text
title: Finish navigation and Supabase lessons
category: Learning
monthly_goal_id: Complete React Native module
target_value: 3
current_value: 0
unit: tasks
week_start: 2026-06-08
```

### `tasks`

Daily goals should use the existing `tasks` table.

Add goal-linking columns:

```text
category_id
monthly_goal_id
weekly_goal_id
```

This makes daily execution visible in the Daily Hub and traceable back to weekly and monthly goals.

Example:

```text
title: Watch lesson 12
date: 2026-06-13
category_id: Learning
weekly_goal_id: Finish navigation and Supabase lessons
monthly_goal_id: Complete React Native module
completed: false
```

## Product Flow

### 1. Add Monthly Goal

User taps `Add Goal`.

They choose:

```text
Goal Type: Monthly Goal
Category: Learning / Work / Health / + New
Title: Complete React Native module
Target: 10
Unit: lessons
Month: June 2026
```

Result:

```text
Monthly goal is created.
It appears under its category in This Month.
No weekly or daily goals are created automatically unless user chooses that action.
```

### 2. Break Monthly Goal Into Weekly Goals

From a monthly goal, user taps:

```text
Break into weeks
```

They can create one or more weekly goals:

```text
Week 1: Finish basics
Week 2: Finish navigation
Week 3: Finish Supabase
Week 4: Build mini project
```

Each weekly goal keeps:

```text
category_id = same as monthly goal
monthly_goal_id = parent monthly goal
```

### 3. Break Weekly Goal Into Daily Tasks

From a weekly goal, user taps:

```text
Add daily tasks
```

They add:

```text
Monday: Watch lesson 12
Tuesday: Build one small screen
Wednesday: Revise notes
```

Each task keeps:

```text
category_id = same category
weekly_goal_id = parent weekly goal
monthly_goal_id = parent monthly goal
```

These tasks should appear in the Daily Hub on their scheduled date.

## Screen Structure

### This Week

Purpose:

```text
Show current weekly execution.
```

Layout:

```text
Week card
Category filter or grouped category sections
Weekly goals
Daily tasks linked under each weekly goal
Progress from completed daily tasks
```

Empty state:

```text
No weekly goals yet.
Create one directly or break down a monthly goal.
```

### This Month

Purpose:

```text
Show monthly direction.
```

Layout:

```text
Month overview
Monthly goals grouped by category
Each monthly goal shows linked weekly goals
Button: Break into weeks
Progress from linked weekly goals or linked daily tasks
```

Empty state:

```text
No monthly goals yet.
Add your first monthly goal.
```

### Add Goal Sheet

Fields:

```text
Goal Type: Monthly / Weekly / Daily Task
Category: Existing / New
Title
Target
Unit
Parent Monthly Goal, if weekly
Parent Weekly Goal, if daily
Date or week/month period
```

Recommended first implementation:

```text
Add Monthly Goal
Add Weekly Goal
Add Daily Task
```

Keep them in one sheet but show only the fields needed for the selected type.

## Progress Rules

### Weekly Progress

Preferred calculation:

```text
completed linked daily tasks / total linked daily tasks
```

Fallback if no daily tasks exist:

```text
current_value / target_value
```

### Monthly Progress

Preferred calculation:

```text
completed linked daily tasks / total linked daily tasks across all linked weekly goals
```

Fallback if no daily tasks exist:

```text
average progress of linked weekly goals
```

Final fallback:

```text
current_value / target_value
```

## Implementation Order

### Phase 1: Clean The Current Screen

- Remove weekly dummy fallback data.
- Remove monthly dummy fallback data.
- Remove finance dummy fallback data.
- Add empty states.
- Stop showing fake `68%` progress.
- Fix `weekly_goals.current` schema mismatch.

### Phase 2: Add Dynamic Categories

- Add `goal_categories` migration.
- Seed default categories for each user: `Learning`, `Work`, `Health`.
- Replace hardcoded category list in the Goals screen.
- Allow category selection when creating goals.
- Allow creating a new category from the Add Goal flow.

### Phase 3: Link Monthly To Weekly

- Add/confirm `monthly_goal_id` on `weekly_goals`.
- When creating a weekly goal, optionally select a monthly parent.
- When breaking a monthly goal into weeks, auto-fill category and parent.
- Show linked weekly goals under each monthly goal.

### Phase 4: Link Weekly To Daily

- Add `weekly_goal_id`, `monthly_goal_id`, and `category_id` to `tasks`.
- Use `tasks` as Daily Goals.
- Add daily tasks from weekly goals.
- Show those tasks in Daily Hub.
- Show linked daily tasks under weekly goals.

### Phase 5: Real Progress

- Calculate weekly progress from linked daily tasks.
- Calculate monthly progress from linked weekly/daily progress.
- Remove all hardcoded calendar dots and fake stat text.
- Show clean empty states when there is no data.

## Recommended First Build

Start with the simplest reliable version:

```text
Monthly Goals
  -> can create category
  -> can create weekly goals

Weekly Goals
  -> linked to monthly goal
  -> can create daily tasks

Daily Tasks
  -> stored in tasks
  -> visible in Daily Hub
  -> completion updates progress
```

Do not build advanced automation first. First make the integrity correct.

## Final Desired Flow

```text
1. User creates category: Learning
2. User creates monthly goal: Complete React Native module
3. User breaks it into weekly goal: Finish Supabase lessons
4. User creates daily tasks from weekly goal
5. Daily Hub shows those tasks
6. User completes tasks
7. Weekly progress updates
8. Monthly progress updates
```

This gives LifeOS a clean planning chain:

```text
Direction -> Execution -> Daily Action
```
