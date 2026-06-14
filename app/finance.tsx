import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressRing } from '@/components/ui/ProgressRing';
import { radii, shadows, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';
import {
  currentMonthRange,
  dateKey,
  loadFinance,
  SAVINGS_ALLOCATION_PERCENT,
  saveFinanceIncome,
  saveFinanceTransaction,
  spendingByCategory,
  SPENDING_ALLOCATION_PERCENT,
  summarizeMonthlyFinance,
  type FinanceCategory,
  type FinanceSettings,
  type FinanceTransaction,
} from '@/lib/financeService';
import { useUserStore } from '@/stores/useUserStore';

type Period = 'daily' | 'monthly' | 'yearly';

type TransactionDraft = {
  amount: string;
  title: string;
  categoryId: string;
  date: string;
  note: string;
};

const PERIODS: { id: Period; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

function emptyDraft(date = dateKey(new Date())): TransactionDraft {
  return {
    amount: '',
    title: '',
    categoryId: '',
    date,
    note: '',
  };
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function periodRange(period: Period) {
  const now = new Date();
  if (period === 'daily') {
    const today = dateKey(now);
    return { start: today, end: today, label: 'Today', budgetMultiplier: 1 / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() };
  }

  if (period === 'yearly') {
    return {
      start: dateKey(new Date(now.getFullYear(), 0, 1)),
      end: dateKey(new Date(now.getFullYear(), 11, 31)),
      label: String(now.getFullYear()),
      budgetMultiplier: 12,
    };
  }

  const month = currentMonthRange(now);
  return {
    ...month,
    label: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(now),
    budgetMultiplier: 1,
  };
}

function formatCurrency(value: number) {
  const rounded = Math.round(Math.abs(value));
  return `\u20B9${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rounded)}`;
}

function formatSignedExpense(value: number) {
  return `-${formatCurrency(value)}`;
}

function formatTransactionDate(key: string) {
  if (!key) return 'Today';
  const today = dateKey(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dateKey(yesterdayDate);
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(dateFromKey(key));
}

function iconName(icon: string) {
  return (icon || 'card-outline') as keyof typeof Ionicons.glyphMap;
}

export default function FinanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const [period, setPeriod] = useState<Period>('monthly');
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [incomeSheetVisible, setIncomeSheetVisible] = useState(false);
  const [draft, setDraft] = useState<TransactionDraft>(emptyDraft());
  const [incomeDraft, setIncomeDraft] = useState('');

  const range = useMemo(() => periodRange(period), [period]);

  const visibleTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date >= range.start && transaction.date <= range.end),
    [range.end, range.start, transactions],
  );

  const summary = useMemo(() => {
    const monthlyIncome = settings?.monthlyIncome ?? 0;
    const base = summarizeMonthlyFinance(categories, transactions, range.start, range.end, monthlyIncome);
    const monthlyBudget = categories.reduce((sum, category) => sum + category.monthlyBudget, 0);
    const periodBudget = monthlyBudget * range.budgetMultiplier;
    const usedPercent = periodBudget > 0 ? Math.round((base.monthlySpent / periodBudget) * 100) : 0;

    return {
      ...base,
      monthlyBudget: periodBudget,
      remaining: periodBudget - base.monthlySpent,
      usedPercent,
      overspent: Math.max(0, base.monthlySpent - periodBudget),
    };
  }, [categories, range.budgetMultiplier, range.end, range.start, settings?.monthlyIncome, transactions]);

  const categoryRows = useMemo(() => {
    const rows = spendingByCategory(categories, transactions, range.start, range.end);
    return rows.map((category) => {
      const budget = category.monthlyBudget * range.budgetMultiplier;
      return {
        ...category,
        monthlyBudget: budget,
        percent: budget > 0 ? Math.round((category.spent / budget) * 100) : 0,
        overspent: budget > 0 && category.spent > budget,
      };
    });
  }, [categories, range.budgetMultiplier, range.end, range.start, transactions]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!currentUserId) {
        setLoading(false);
        setRefreshing(false);
        setSettings(null);
        setCategories([]);
        setTransactions([]);
        return;
      }

      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      setError('');

      try {
        const nextFinance = await loadFinance(currentUserId);
        setSettings(nextFinance.settings);
        setCategories(nextFinance.categories);
        setTransactions(nextFinance.transactions);
        setIncomeDraft(nextFinance.settings.monthlyIncome > 0 ? String(Math.round(nextFinance.settings.monthlyIncome)) : '');
        setDraft((value) => ({
          ...value,
          categoryId: value.categoryId || nextFinance.categories[0]?.id || '',
        }));
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : 'Unable to load finance.';
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currentUserId],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const selectedCategory = categories.find((category) => category.id === draft.categoryId) ?? categories[0];

  const openAddSheet = () => {
    setDraft({
      ...emptyDraft(),
      categoryId: categories[0]?.id || '',
    });
    setSheetVisible(true);
  };

  const openIncomeSheet = () => {
    setIncomeDraft(settings?.monthlyIncome ? String(Math.round(settings.monthlyIncome)) : '');
    setIncomeSheetVisible(true);
  };

  const saveIncome = useCallback(async () => {
    if (!currentUserId) {
      Alert.alert('Login required', 'Please login before setting income.');
      return;
    }

    const monthlyIncome = Number(incomeDraft.replace(/,/g, '').trim());
    if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
      Alert.alert('Income needed', 'Enter your monthly salary or income greater than zero.');
      return;
    }

    setSaving(true);
    try {
      const nextBudget = await saveFinanceIncome(currentUserId, monthlyIncome, categories);
      setSettings(nextBudget.settings);
      setCategories(nextBudget.categories);
      setIncomeSheetVisible(false);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Income was not saved.';
      Alert.alert('Income not saved', message);
    } finally {
      setSaving(false);
    }
  }, [categories, currentUserId, incomeDraft]);

  const saveTransaction = useCallback(async () => {
    if (!currentUserId) {
      Alert.alert('Login required', 'Please login before adding transactions.');
      return;
    }

    const amount = Number(draft.amount.replace(/,/g, '').trim());
    const title = draft.title.trim();
    const date = draft.date.trim();
    const category = selectedCategory;

    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Amount needed', 'Enter an expense amount greater than zero.');
      return;
    }

    if (!title) {
      Alert.alert('Title needed', 'Add a merchant or transaction title.');
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Date needed', 'Use the date format YYYY-MM-DD.');
      return;
    }

    if (!category) {
      Alert.alert('Category needed', 'Choose a category before saving.');
      return;
    }

    setSaving(true);
    try {
      const transaction = await saveFinanceTransaction({
        userId: currentUserId,
        categoryId: category.id,
        categoryName: category.name,
        amount,
        title,
        note: draft.note,
        date,
      });

      setTransactions((items) => [transaction, ...items].sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`)));
      setSheetVisible(false);
      setDraft(emptyDraft());
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Transaction was not saved.';
      Alert.alert('Transaction not saved', message);
    } finally {
      setSaving(false);
    }
  }, [currentUserId, draft, selectedCategory]);

  const renderPeriodToggle = () => (
    <View style={styles.periodToggle}>
      {PERIODS.map((item) => (
        <TouchableOpacity key={item.id} style={[styles.periodPill, period === item.id && styles.periodPillActive]} onPress={() => setPeriod(item.id)}>
          <Text style={[styles.periodText, period === item.id && styles.periodTextActive]}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderIncomeCard = () => {
    const monthlyIncome = settings?.monthlyIncome ?? 0;
    const allocatedPercent = categories.reduce((sum, category) => sum + category.allocationPercent, 0);
    const savingsTarget = Math.round((monthlyIncome * SAVINGS_ALLOCATION_PERCENT) / 100);

    return (
      <TouchableOpacity style={styles.incomeCard} onPress={openIncomeSheet}>
        <View style={styles.incomeIcon}>
          <Ionicons name="cash-outline" size={20} color={colors.emeraldLight} />
        </View>
        <View style={styles.incomeCopy}>
          <Text style={styles.eyebrow}>Monthly income</Text>
          <Text style={styles.incomeValue}>{monthlyIncome > 0 ? formatCurrency(monthlyIncome) : 'Set salary or income'}</Text>
          <Text style={styles.incomeHint}>
            {monthlyIncome > 0
              ? `${allocatedPercent}% spending plan · ${SAVINGS_ALLOCATION_PERCENT}% savings target ${formatCurrency(savingsTarget)}`
              : 'Budgets stay empty until income is added.'}
          </Text>
        </View>
        <Ionicons name="create-outline" size={19} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  };

  const renderSummary = () => (
    <View style={styles.summaryCard}>
      <View style={styles.summaryGlow} />
      <View style={styles.summaryTop}>
        <View style={styles.summaryCopy}>
          <Text style={styles.eyebrow}>Total spent</Text>
          <Text style={styles.totalText}>{formatCurrency(summary.monthlySpent)}</Text>
          <Text style={styles.budgetText}>
            of <Text style={styles.budgetStrong}>{formatCurrency(summary.monthlyBudget)}</Text> spending budget
          </Text>
          <View style={styles.remainingRow}>
            <Ionicons name={summary.remaining >= 0 ? 'trending-down' : 'trending-up'} size={16} color={summary.remaining >= 0 ? colors.emeraldLight : colors.rose} />
            <Text style={[styles.remainingText, summary.remaining < 0 && styles.overspentText]}>
              {summary.remaining >= 0 ? `${formatCurrency(summary.remaining)} remaining` : `${formatCurrency(Math.abs(summary.remaining))} over budget`}
            </Text>
          </View>
        </View>
        <ProgressRing progress={summary.usedPercent} size={88} strokeWidth={9} color={summary.usedPercent > 100 ? colors.rose : colors.emeraldLight}>
          <Text style={styles.ringValue}>{Math.min(summary.usedPercent, 999)}%</Text>
        </ProgressRing>
      </View>

      {summary.usedPercent > 85 ? (
        <View style={[styles.alertRow, summary.usedPercent > 100 && styles.alertRowDanger]}>
          <Ionicons name="warning-outline" size={17} color={summary.usedPercent > 100 ? colors.rose : colors.amberLight} />
          <Text style={[styles.alertText, summary.usedPercent > 100 && styles.alertTextDanger]}>
            {summary.usedPercent > 100 ? 'Budget crossed for this period' : 'Close to budget limit for this period'}
          </Text>
        </View>
      ) : null}
      {(settings?.monthlyIncome ?? 0) <= 0 ? (
        <TouchableOpacity style={styles.setupBudgetRow} onPress={openIncomeSheet}>
          <Ionicons name="wallet-outline" size={17} color={colors.emeraldLight} />
          <Text style={styles.setupBudgetText}>Add monthly income to generate category budgets.</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderCategories = () => (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionLabel}>Categories</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
        {categoryRows.map((category) => (
          <View key={category.id} style={[styles.categoryCard, category.overspent && styles.categoryCardDanger]}>
            <View style={styles.categoryTop}>
              <View style={[styles.financeIcon, { backgroundColor: `${category.color}24`, borderColor: `${category.color}55` }]}>
                <Ionicons name={iconName(category.icon)} size={18} color={category.color} />
              </View>
              <Text style={styles.categoryName}>{category.name}</Text>
            </View>
            <Text style={[styles.categoryAmount, category.overspent && styles.categoryAmountDanger]}>
              {formatCurrency(category.spent)} <Text style={styles.categoryBudget}>/ {formatCurrency(category.monthlyBudget)}</Text>
            </Text>
            <Text style={styles.categoryAllocation}>{category.allocationPercent}% of income</Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, category.percent)}%`,
                    backgroundColor: category.overspent ? colors.rose : colors.emeraldLight,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  const renderTransactions = () => (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{range.label}</Text>
        <Text style={styles.viewAllText}>{visibleTransactions.length} entries</Text>
      </View>
      {visibleTransactions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="receipt-outline" size={22} color={colors.emeraldLight} />
          <Text style={styles.emptyTitle}>No transactions yet</Text>
          <Text style={styles.emptyText}>Add your first expense to start tracking this period.</Text>
        </View>
      ) : (
        <View style={styles.transactionList}>
          {visibleTransactions.slice(0, 30).map((transaction) => {
            const category = categories.find((item) => item.id === transaction.financeCategoryId);
            const accent = category?.color || colors.emeraldLight;
            return (
              <View key={transaction.id} style={styles.transactionRow}>
                <View style={[styles.transactionIcon, { backgroundColor: `${accent}20` }]}>
                  <Ionicons name={iconName(category?.icon || 'receipt-outline')} size={19} color={accent} />
                </View>
                <View style={styles.transactionCopy}>
                  <Text style={styles.transactionTitle}>{transaction.title}</Text>
                  <Text style={styles.transactionMeta}>
                    {formatTransactionDate(transaction.date)} · {transaction.category}
                  </Text>
                </View>
                <Text style={styles.transactionAmount}>{formatSignedExpense(transaction.amount)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyCard}>
      <Ionicons name="warning-outline" size={22} color={colors.amber} />
      <Text style={styles.emptyTitle}>Finance needs setup</Text>
      <Text style={styles.emptyText}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={() => void load()}>
        <Ionicons name="refresh" size={16} color={colors.textPrimary} />
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSheet = () => (
    <Modal visible={sheetVisible} animationType="slide" transparent onRequestClose={() => setSheetVisible(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.modalTitle}>Add transaction</Text>
            <TouchableOpacity onPress={() => setSheetVisible(false)}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Amount</Text>
              <TextInput
                value={draft.amount}
                onChangeText={(amount) => setDraft((value) => ({ ...value, amount }))}
                keyboardType="decimal-pad"
                placeholder="450"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.amountInput]}
              />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Title or merchant</Text>
              <TextInput
                value={draft.title}
                onChangeText={(title) => setDraft((value) => ({ ...value, title }))}
                placeholder="Lunch, auto, subscription..."
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                {categories.map((category) => (
                  <TouchableOpacity
                    key={category.id}
                    style={[styles.categoryChip, draft.categoryId === category.id && styles.categoryChipActive]}
                    onPress={() => setDraft((value) => ({ ...value, categoryId: category.id }))}>
                    <Ionicons name={iconName(category.icon)} size={16} color={category.color} />
                    <Text style={styles.categoryChipText}>{category.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Date</Text>
              <TextInput
                value={draft.date}
                onChangeText={(date) => setDraft((value) => ({ ...value, date }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Note optional</Text>
              <TextInput
                value={draft.note}
                onChangeText={(note) => setDraft((value) => ({ ...value, note }))}
                placeholder="Any detail worth remembering"
                placeholderTextColor={colors.textMuted}
                multiline
                style={[styles.input, styles.notesInput]}
              />
            </View>

            <TouchableOpacity disabled={saving} style={[styles.primaryButton, saving && styles.disabledButton]} onPress={() => void saveTransaction()}>
              <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Save transaction'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderIncomeSheet = () => (
    <Modal visible={incomeSheetVisible} animationType="slide" transparent onRequestClose={() => setIncomeSheetVisible(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.modalTitle}>Set monthly income</Text>
            <TouchableOpacity onPress={() => setIncomeSheetVisible(false)}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.sheetContent}>
            <View style={styles.formSection}>
              <Text style={styles.fieldLabel}>Salary or income</Text>
              <TextInput
                value={incomeDraft}
                onChangeText={setIncomeDraft}
                keyboardType="decimal-pad"
                placeholder="50000"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.amountInput]}
              />
              <Text style={styles.incomeHint}>
                LifeOS will use {SPENDING_ALLOCATION_PERCENT}% for spending categories and keep {SAVINGS_ALLOCATION_PERCENT}% as savings.
              </Text>
            </View>

            <View style={styles.allocationBox}>
              {categories.map((category) => (
                <View key={category.id} style={styles.allocationRow}>
                  <Text style={styles.allocationName}>{category.name}</Text>
                  <Text style={styles.allocationValue}>{category.allocationPercent}%</Text>
                </View>
              ))}
              <View style={styles.allocationDivider} />
              <View style={styles.allocationRow}>
                <Text style={styles.allocationName}>Savings target</Text>
                <Text style={styles.allocationValue}>{SAVINGS_ALLOCATION_PERCENT}%</Text>
              </View>
            </View>

            <TouchableOpacity disabled={saving} style={[styles.primaryButton, saving && styles.disabledButton]} onPress={() => void saveIncome()}>
              <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Generate budgets'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.emeraldLight} onRefresh={() => void load('refresh')} />}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + 118 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Finance</Text>
            <Text style={styles.subtitle}>Track spending, budgets, and recent expenses.</Text>
          </View>
        </View>

        {renderPeriodToggle()}

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.emeraldLight} />
            <Text style={styles.helperText}>Loading finance...</Text>
          </View>
        ) : error ? (
          renderError()
        ) : (
          <>
            {renderIncomeCard()}
            {renderSummary()}
            {renderCategories()}
            {renderTransactions()}
          </>
        )}
      </ScrollView>

      {!loading && !error ? (
        <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 26 }]} onPress={openAddSheet}>
          <Ionicons name="add" size={30} color={colors.background} />
        </TouchableOpacity>
      ) : null}

      {renderSheet()}
      {renderIncomeSheet()}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.sm, paddingHorizontal: spacing.gutter },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  headerCopy: { flex: 1 },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  periodToggle: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 4,
  },
  periodPill: { alignItems: 'center', borderRadius: radii.pill, flex: 1, justifyContent: 'center', minHeight: 38 },
  periodPillActive: { backgroundColor: colors.emerald },
  periodText: { ...typography.labelCaps, color: colors.textSecondary },
  periodTextActive: { color: colors.background },
  incomeCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  incomeIcon: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: `${colors.emeraldLight}55`,
    borderRadius: radii.inner,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  incomeCopy: { flex: 1, gap: 3 },
  incomeValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '900' },
  incomeHint: { ...typography.body, color: colors.textSecondary },
  summaryCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderLeftColor: colors.emeraldLight,
    borderLeftWidth: 4,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  summaryGlow: {
    backgroundColor: colors.emerald,
    borderRadius: 60,
    height: 120,
    opacity: 0.08,
    position: 'absolute',
    right: -40,
    top: -40,
    width: 120,
  },
  summaryTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  summaryCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { ...typography.labelCaps, color: colors.textSecondary, textTransform: 'uppercase' },
  totalText: { color: colors.textPrimary, fontSize: 42, fontWeight: '800', lineHeight: 50 },
  budgetText: { ...typography.body, color: colors.textSecondary },
  budgetStrong: { color: colors.textPrimary, fontWeight: '800' },
  remainingRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  remainingText: { color: colors.emeraldLight, fontSize: 14, fontWeight: '800' },
  overspentText: { color: colors.rose },
  ringValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  alertRow: {
    alignItems: 'center',
    backgroundColor: colors.amberBg,
    borderColor: `${colors.amber}55`,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  alertRowDanger: { backgroundColor: colors.roseBg, borderColor: `${colors.rose}55` },
  alertText: { color: colors.amberLight, flex: 1, fontSize: 12, fontWeight: '800' },
  alertTextDanger: { color: colors.rose },
  setupBudgetRow: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: `${colors.emeraldLight}55`,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  setupBudgetText: { color: colors.emeraldLight, flex: 1, fontSize: 12, fontWeight: '800' },
  sectionBlock: { gap: spacing.xs },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionLabel: { ...typography.labelCaps, color: colors.textSecondary, letterSpacing: 1.2, textTransform: 'uppercase' },
  viewAllText: { ...typography.labelCaps, color: colors.emeraldLight },
  categoryList: { gap: spacing.sm, paddingBottom: spacing.base, paddingRight: spacing.gutter },
  categoryCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    minWidth: 154,
    padding: spacing.sm,
  },
  categoryCardDanger: { borderColor: `${colors.rose}88` },
  categoryTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between' },
  financeIcon: {
    alignItems: 'center',
    borderRadius: radii.inner,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  categoryName: { color: colors.textPrimary, flex: 1, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  categoryAmount: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  categoryAmountDanger: { color: colors.rose },
  categoryBudget: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  categoryAllocation: { ...typography.labelCaps, color: colors.textSecondary, textTransform: 'none' },
  progressTrack: { backgroundColor: colors.surface3, borderRadius: radii.pill, height: 8, overflow: 'hidden' },
  progressFill: { borderRadius: radii.pill, height: 8 },
  transactionList: { gap: spacing.xs },
  transactionRow: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  transactionIcon: { alignItems: 'center', borderRadius: radii.inner, height: 42, justifyContent: 'center', width: 42 },
  transactionCopy: { flex: 1, gap: 2 },
  transactionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  transactionMeta: { ...typography.labelCaps, color: colors.textSecondary, textTransform: 'none' },
  transactionAmount: { color: colors.rose, fontSize: 15, fontWeight: '900' },
  emptyCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  emptyText: { ...typography.body, color: colors.textSecondary },
  retryButton: {
    alignItems: 'center',
    backgroundColor: colors.violet,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  retryText: { ...typography.labelCaps, color: colors.textPrimary },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  helperText: { ...typography.body, color: colors.textSecondary },
  fab: {
    ...shadows.ambient,
    alignItems: 'center',
    backgroundColor: colors.emeraldLight,
    borderRadius: 22,
    height: 64,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.gutter,
    width: 64,
  },
  modalOverlay: { backgroundColor: 'rgba(0,0,0,0.58)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.gutter,
  },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalTitle: { ...typography.h1, color: colors.textPrimary },
  sheetContent: { gap: 14, paddingBottom: spacing.lg },
  formSection: { gap: 8 },
  fieldLabel: { ...typography.labelCaps, color: colors.textSecondary, lineHeight: 18, textTransform: 'uppercase' },
  input: {
    backgroundColor: colors.surface2,
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
    paddingVertical: 14,
  },
  amountInput: { color: colors.emeraldLight, fontSize: 24, fontWeight: '900' },
  notesInput: { minHeight: 96, paddingTop: 14, textAlignVertical: 'top' },
  allocationBox: {
    backgroundColor: colors.surface2,
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    gap: 10,
    padding: spacing.sm,
  },
  allocationRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  allocationDivider: { backgroundColor: colors.borderLight, height: 1 },
  allocationName: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  allocationValue: { color: colors.emeraldLight, fontSize: 14, fontWeight: '900' },
  chipScroll: { gap: 10, paddingBottom: 2, paddingRight: spacing.gutter },
  categoryChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  categoryChipActive: { backgroundColor: colors.emeraldBg, borderColor: colors.emeraldLight },
  categoryChipText: { ...typography.labelCaps, color: colors.textPrimary },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: radii.pill,
    justifyContent: 'center',
    minHeight: 58,
  },
  primaryButtonText: { color: colors.background, fontSize: 15, fontWeight: '900' },
  disabledButton: { opacity: 0.6 },
  });
}
