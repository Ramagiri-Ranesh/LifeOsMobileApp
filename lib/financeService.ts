import { colors } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

export type FinanceCategory = {
  id: string;
  userId: string;
  name: string;
  monthlyBudget: number;
  allocationPercent: number;
  color: string;
  icon: string;
};

export type FinanceSettings = {
  id: string;
  userId: string;
  monthlyIncome: number;
  currency: string;
};

export type FinanceTransaction = {
  id: string;
  userId: string;
  financeCategoryId: string;
  title: string;
  merchant: string;
  category: string;
  amount: number;
  note: string;
  date: string;
  createdAt: string;
};

export type FinanceTransactionDraft = {
  userId: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  title: string;
  note?: string;
  date: string;
};

export type FinanceSummary = {
  monthlyIncome: number;
  savingsTarget: number;
  monthlySpent: number;
  monthlyBudget: number;
  remaining: number;
  usedPercent: number;
  overspent: number;
};

export const SAVINGS_ALLOCATION_PERCENT = 20;
export const SPENDING_ALLOCATION_PERCENT = 80;

export const DEFAULT_FINANCE_CATEGORIES = [
  { name: 'Food', allocationPercent: 30, color: colors.emerald, icon: 'restaurant-outline' },
  { name: 'Gym', allocationPercent: 10, color: colors.violetLight, icon: 'barbell-outline' },
  { name: 'Travel', allocationPercent: 10, color: colors.blueLight, icon: 'car-outline' },
  { name: 'Shopping', allocationPercent: 15, color: colors.rose, icon: 'bag-outline' },
  { name: 'Other', allocationPercent: 15, color: colors.textSecondary, icon: 'cube-outline' },
] as const;

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function rowId(row: LooseRow, fallback: string) {
  const id = row.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : fallback;
}

function categoryFromRow(row: LooseRow, index: number): FinanceCategory {
  const fallback = DEFAULT_FINANCE_CATEGORIES[index % DEFAULT_FINANCE_CATEGORIES.length];
  const allocationPercent = asNumber(row.allocation_percent, fallback.allocationPercent);
  return {
    id: rowId(row, `finance-category-${index}`),
    userId: asText(row.user_id),
    name: asText(row.name, fallback.name),
    monthlyBudget: asNumber(row.monthly_budget, 0),
    allocationPercent,
    color: asText(row.color, fallback.color),
    icon: asText(row.icon, fallback.icon),
  };
}

function settingsFromRow(row: LooseRow | null | undefined, userId: string): FinanceSettings {
  if (!row) {
    return {
      id: '',
      userId,
      monthlyIncome: 0,
      currency: 'INR',
    };
  }

  return {
    id: rowId(row, ''),
    userId: asText(row.user_id, userId),
    monthlyIncome: asNumber(row.monthly_income),
    currency: asText(row.currency, 'INR'),
  };
}

function transactionFromRow(row: LooseRow, index: number): FinanceTransaction {
  return {
    id: rowId(row, `finance-transaction-${index}`),
    userId: asText(row.user_id),
    financeCategoryId: asText(row.finance_category_id),
    title: asText(row.title, asText(row.merchant, 'Expense')),
    merchant: asText(row.merchant),
    category: asText(row.category, 'Other'),
    amount: asNumber(row.amount),
    note: asText(row.note),
    date: asText(row.date).slice(0, 10),
    createdAt: asText(row.created_at),
  };
}

function categoriesForIncome(categories: FinanceCategory[], monthlyIncome: number) {
  return categories.map((category) => ({
    ...category,
    monthlyBudget: monthlyIncome > 0 ? Math.round((monthlyIncome * category.allocationPercent) / 100) : 0,
  }));
}

async function syncDefaultFinanceCategoryAllocations(userId: string, categories: FinanceCategory[]) {
  const updates = categories
    .map((category) => {
      const defaultCategory = DEFAULT_FINANCE_CATEGORIES.find((item) => item.name.toLowerCase() === category.name.toLowerCase());
      if (!defaultCategory || category.allocationPercent === defaultCategory.allocationPercent) return null;

      return supabase
        .from('finance_categories')
        .update({
          allocation_percent: defaultCategory.allocationPercent,
          monthly_budget: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', category.id)
        .eq('user_id', userId);
    })
    .filter(Boolean);

  if (updates.length === 0) return categories;

  const results = await Promise.all(updates);
  const updateError = results.find((result) => result?.error)?.error;
  if (updateError) throw new Error(updateError.message);

  return categories.map((category) => {
    const defaultCategory = DEFAULT_FINANCE_CATEGORIES.find((item) => item.name.toLowerCase() === category.name.toLowerCase());
    return defaultCategory ? { ...category, allocationPercent: defaultCategory.allocationPercent, monthlyBudget: 0 } : category;
  });
}

export function currentMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: dateKey(start),
    end: dateKey(end),
  };
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

export async function ensureDefaultFinanceCategories(userId: string) {
  const { data, error } = await supabase
    .from('finance_categories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  const existing = ((data ?? []) as LooseRow[]).map(categoryFromRow);
  const existingNames = new Set(existing.map((category) => category.name.trim().toLowerCase()));
  const missing = DEFAULT_FINANCE_CATEGORIES
    .filter((category) => !existingNames.has(category.name.toLowerCase()))
    .map((category) => ({
      user_id: userId,
      name: category.name,
      monthly_budget: 0,
      allocation_percent: category.allocationPercent,
      color: category.color,
      icon: category.icon,
    }));

  if (missing.length > 0) {
    const { error: insertError } = await supabase.from('finance_categories').insert(missing);
    if (insertError) throw new Error(insertError.message);

    const { data: refreshed, error: refreshError } = await supabase
      .from('finance_categories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (refreshError) throw new Error(refreshError.message);
    return syncDefaultFinanceCategoryAllocations(userId, ((refreshed ?? []) as LooseRow[]).map(categoryFromRow));
  }

  return syncDefaultFinanceCategoryAllocations(userId, existing);
}

export async function ensureFinanceSettings(userId: string) {
  const { data, error } = await supabase.from('finance_settings').select('*').eq('user_id', userId).maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return settingsFromRow(data as LooseRow, userId);

  const { data: inserted, error: insertError } = await supabase
    .from('finance_settings')
    .insert({
      user_id: userId,
      monthly_income: 0,
      currency: 'INR',
    })
    .select('*')
    .single();

  if (insertError) throw new Error(insertError.message);
  return settingsFromRow(inserted as LooseRow, userId);
}

export async function loadFinance(userId: string) {
  const [settings, categories] = await Promise.all([ensureFinanceSettings(userId), ensureDefaultFinanceCategories(userId)]);
  const incomeBasedCategories = categoriesForIncome(categories, settings.monthlyIncome);
  const yearStart = dateKey(new Date(new Date().getFullYear(), 0, 1));
  const { data, error } = await supabase
    .from('finance_transactions')
    .select('*')
    .eq('user_id', userId)
    .gte('date', yearStart)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);

  return {
    settings,
    categories: incomeBasedCategories,
    transactions: ((data ?? []) as LooseRow[]).map(transactionFromRow),
  };
}

export async function saveFinanceIncome(userId: string, monthlyIncome: number, categories: FinanceCategory[]) {
  const { data, error } = await supabase
    .from('finance_settings')
    .upsert(
      {
        user_id: userId,
        monthly_income: monthlyIncome,
        currency: 'INR',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  const updates = categories.map((category) =>
    supabase
      .from('finance_categories')
      .update({
        monthly_budget: Math.round((monthlyIncome * category.allocationPercent) / 100),
        updated_at: new Date().toISOString(),
      })
      .eq('id', category.id)
      .eq('user_id', userId),
  );

  const results = await Promise.all(updates);
  const updateError = results.find((result) => result.error)?.error;
  if (updateError) throw new Error(updateError.message);

  return {
    settings: settingsFromRow(data as LooseRow, userId),
    categories: categoriesForIncome(categories, monthlyIncome),
  };
}

export async function saveFinanceTransaction(draft: FinanceTransactionDraft) {
  const { data, error } = await supabase
    .from('finance_transactions')
    .insert({
      user_id: draft.userId,
      finance_category_id: draft.categoryId || null,
      title: draft.title,
      merchant: draft.title,
      category: draft.categoryName || 'Other',
      amount: draft.amount,
      note: draft.note?.trim() || null,
      date: draft.date,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return transactionFromRow(data as LooseRow, 0);
}

export function summarizeMonthlyFinance(
  categories: FinanceCategory[],
  transactions: FinanceTransaction[],
  monthStart: string,
  monthEnd: string,
  monthlyIncome = 0,
): FinanceSummary {
  const monthlyTransactions = transactions.filter((transaction) => transaction.date >= monthStart && transaction.date <= monthEnd);
  const monthlySpent = monthlyTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const monthlyBudget = categories.reduce((sum, category) => sum + category.monthlyBudget, 0);
  const savingsTarget = Math.round((monthlyIncome * SAVINGS_ALLOCATION_PERCENT) / 100);
  const usedPercent = monthlyBudget > 0 ? Math.round((monthlySpent / monthlyBudget) * 100) : 0;
  const remaining = monthlyBudget - monthlySpent;

  return {
    monthlyIncome,
    savingsTarget,
    monthlySpent,
    monthlyBudget,
    remaining,
    usedPercent,
    overspent: Math.max(0, monthlySpent - monthlyBudget),
  };
}

export function spendingByCategory(categories: FinanceCategory[], transactions: FinanceTransaction[], monthStart: string, monthEnd: string) {
  const monthlyTransactions = transactions.filter((transaction) => transaction.date >= monthStart && transaction.date <= monthEnd);

  return categories.map((category) => {
    const spent = monthlyTransactions
      .filter((transaction) => transaction.financeCategoryId === category.id || transaction.category === category.name)
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const percent = category.monthlyBudget > 0 ? Math.round((spent / category.monthlyBudget) * 100) : 0;

    return {
      ...category,
      spent,
      percent,
      overspent: category.monthlyBudget > 0 && spent > category.monthlyBudget,
    };
  });
}
