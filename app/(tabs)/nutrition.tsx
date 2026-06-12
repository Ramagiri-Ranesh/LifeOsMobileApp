import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
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

import { MacroBar } from '@/components/ui/MacroBar';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { getMealSuggestion } from '@/lib/ai';
import { cloneYesterdayMeals } from '@/lib/cloneYesterday';
import { colors, radii, shadows, spacing, typography } from '@/lib/design';
import {
  type FoodItem,
  type Meal,
  type MealType,
  useNutritionStore,
} from '@/stores/useNutritionStore';
import { useUserStore } from '@/stores/useUserStore';

const MEAL_META: Record<MealType, { label: string; emoji: string; fallbackTime: string }> = {
  breakfast: { label: 'Breakfast', emoji: '🍳', fallbackTime: '08:00' },
  lunch: { label: 'Lunch', emoji: '🍛', fallbackTime: '13:00' },
  dinner: { label: 'Dinner', emoji: '🍽️', fallbackTime: '20:00' },
  snack: { label: 'Snack', emoji: '🍌', fallbackTime: '17:00' },
};

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const BANNED_SUGGESTION_FOODS = /\b(curd|dahi|oats?|oatmeal)\b/i;

type FoodDraft = {
  name: string;
  serving: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function shiftDate(key: string, days: number) {
  const next = dateFromKey(key);
  next.setDate(next.getDate() + days);
  return dateKey(next);
}

function formatNavDate(key: string) {
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(dateFromKey(key));
}

function numberFromDraft(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function macroTotals(meals: Meal[]) {
  return meals.reduce(
    (totals, meal) => ({
      protein: totals.protein + meal.protein,
      carbs: totals.carbs + meal.carbs,
      fat: totals.fat + meal.fat,
    }),
    { protein: 0, carbs: 0, fat: 0 },
  );
}

function fallbackSuggestion(remaining: number, cuisine: string[]) {
  const style = cuisine[0] ?? 'South Indian';
  if (remaining < 450) return `${style} egg bhurji with a small rice portion keeps dinner light and protein-forward.`;
  return `${style} chicken or paneer rice bowl with dal and vegetables fits well into the remaining calories.`;
}

export default function NutritionScreen() {
  const insets = useSafeAreaInsets();
  const calorieGoal = useUserStore((state) => state.calorieGoal);
  const macros = useUserStore((state) => state.macros);
  const foodsToAvoid = useUserStore((state) => state.foodsToAvoid);
  const cuisinePreference = useUserStore((state) => state.cuisinePreference);

  const todaysMeals = useNutritionStore((state) => state.todaysMeals);
  const calories = useNutritionStore((state) => state.calories);
  const templates = useNutritionStore((state) => state.templates);
  const loading = useNutritionStore((state) => state.loading);
  const loadDailyData = useNutritionStore((state) => state.loadDailyData);
  const loadTemplates = useNutritionStore((state) => state.loadTemplates);
  const searchFoods = useNutritionStore((state) => state.searchFoods);
  const addFoodItem = useNutritionStore((state) => state.addFoodItem);
  const logMealItem = useNutritionStore((state) => state.logMealItem);
  const applyTemplate = useNutritionStore((state) => state.applyTemplate);
  const deleteMealItem = useNutritionStore((state) => state.deleteMealItem);

  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [expandedMeal, setExpandedMeal] = useState<MealType | null>('breakfast');
  const [activeMealType, setActiveMealType] = useState<MealType>('dinner');
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [addFoodModalVisible, setAddFoodModalVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [foodResults, setFoodResults] = useState<FoodItem[]>([]);
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [qty, setQty] = useState('1');
  const [suggestion, setSuggestion] = useState('');
  const [suggestionLoading, setSuggestionLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [canCloneYesterday, setCanCloneYesterday] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [foodDraft, setFoodDraft] = useState<FoodDraft>({
    name: '',
    serving: 'serving',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });

  const totals = useMemo(() => macroTotals(todaysMeals), [todaysMeals]);
  const todayKey = useMemo(() => dateKey(new Date()), []);
  const isViewingToday = selectedDate === todayKey;
  const caloriesRemaining = Math.max(0, calorieGoal - calories);
  const progress = calorieGoal > 0 ? (calories / calorieGoal) * 100 : 0;
  const mealsByType = useMemo(
    () => new Map(todaysMeals.map((meal) => [meal.type, meal] as const)),
    [todaysMeals],
  );
  const mealRows = useMemo(
    () => MEAL_ORDER.filter((type) => mealsByType.has(type)).map((type) => mealsByType.get(type)!),
    [mealsByType],
  );
  const missingDinnerSnack = MEAL_ORDER.filter((type) => (type === 'dinner' || type === 'snack') && !mealsByType.has(type));
  const scaledPreview = selectedFood
    ? {
        calories: Math.round(selectedFood.calories * numberFromDraft(qty)),
        protein: Math.round(selectedFood.protein * numberFromDraft(qty) * 10) / 10,
        carbs: Math.round(selectedFood.carbs * numberFromDraft(qty) * 10) / 10,
        fat: Math.round(selectedFood.fat * numberFromDraft(qty) * 10) / 10,
      }
    : null;

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadDailyData(selectedDate), loadTemplates()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadDailyData, loadTemplates, selectedDate]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    let mounted = true;

    async function checkCloneAvailability() {
      if (!isViewingToday) {
        if (mounted) setCanCloneYesterday(false);
        return;
      }

      if (mounted) setCanCloneYesterday(true);
    }

    void checkCloneAvailability();
    return () => {
      mounted = false;
    };
  }, [isViewingToday, todayKey, todaysMeals.length]);

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timeout = setTimeout(() => setToastMessage(''), 2600);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(async () => {
      const results = await searchFoods(query);
      if (mounted) setFoodResults(results);
    }, 220);

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, [query, searchFoods]);

  useEffect(() => {
    let mounted = true;

    async function loadSuggestion() {
      setSuggestionLoading(true);
      try {
        const result = await getMealSuggestion({
          todaysMeals,
          calorieRemaining: caloriesRemaining,
          foodsToAvoid: Array.from(new Set([...foodsToAvoid, 'curd', 'dahi', 'oats'])),
          cuisinePreference: cuisinePreference.length > 0 ? cuisinePreference : ['South Indian', 'Hyderabadi', 'Telugu'],
        });
        const firstLine = result.trim().split('\n')[0];
        const safeSuggestion =
          firstLine && !BANNED_SUGGESTION_FOODS.test(firstLine)
            ? firstLine
            : fallbackSuggestion(caloriesRemaining, cuisinePreference);
        if (mounted) setSuggestion(safeSuggestion);
      } catch (error) {
        console.warn('Unable to load meal suggestion', error);
        if (mounted) setSuggestion(fallbackSuggestion(caloriesRemaining, cuisinePreference));
      } finally {
        if (mounted) setSuggestionLoading(false);
      }
    }

    void loadSuggestion();
    return () => {
      mounted = false;
    };
  }, [caloriesRemaining, cuisinePreference, foodsToAvoid, todaysMeals]);

  const openLogMeal = useCallback((mealType: MealType) => {
    setActiveMealType(mealType);
    setExpandedMeal(mealType);
    setSelectedFood(null);
    setQty('1');
    setQuery('');
    setLogModalVisible(true);
  }, []);

  const saveMealItem = useCallback(async () => {
    if (!selectedFood) return;
    const quantity = Math.max(0.1, numberFromDraft(qty));
    await logMealItem(selectedDate, activeMealType, selectedFood, quantity);
    setLogModalVisible(false);
  }, [activeMealType, logMealItem, qty, selectedDate, selectedFood]);

  const saveFoodItem = useCallback(async () => {
    if (!foodDraft.name.trim()) return;
    const food = await addFoodItem({
      name: foodDraft.name.trim(),
      serving: foodDraft.serving.trim() || 'serving',
      calories: numberFromDraft(foodDraft.calories),
      protein: numberFromDraft(foodDraft.protein),
      carbs: numberFromDraft(foodDraft.carbs),
      fat: numberFromDraft(foodDraft.fat),
    });
    if (food) {
      setSelectedFood(food);
      setFoodResults((items) => [food, ...items]);
      setAddFoodModalVisible(false);
      setFoodDraft({ name: '', serving: 'serving', calories: '', protein: '', carbs: '', fat: '' });
    }
  }, [addFoodItem, foodDraft]);

  const confirmDeleteItem = useCallback(
    (mealType: MealType, itemId: string) => {
      Alert.alert('Delete food item?', 'This removes it from the meal log.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteMealItem(selectedDate, mealType, itemId) },
      ]);
    },
    [deleteMealItem, selectedDate],
  );

  const addSuggestionToDinner = useCallback(() => {
    setQuery(suggestion.replace(/^["']|["']$/g, ''));
    openLogMeal('dinner');
  }, [openLogMeal, suggestion]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  const handleClone = useCallback(async () => {
    setCloneLoading(true);
    try {
      const success = await cloneYesterdayMeals();
      if (success) {
        await refreshData();
        setCanCloneYesterday(false);
        showToast("Yesterday's meals cloned ✓ Edit what changed");
      }
    } finally {
      setCloneLoading(false);
    }
  }, [refreshData, showToast]);

  const renderMeal = ({ item }: { item: Meal }) => {
    const meta = MEAL_META[item.type];
    const expanded = expandedMeal === item.type;

    return (
      <View style={styles.mealCard}>
        <TouchableOpacity activeOpacity={0.82} style={styles.mealHeader} onPress={() => setExpandedMeal(expanded ? null : item.type)}>
          <Text style={styles.mealEmoji}>{meta.emoji}</Text>
          <View style={styles.mealTitleWrap}>
            <Text style={styles.mealTitle}>{meta.label}</Text>
            <Text style={styles.mealTime}>{item.time || meta.fallbackTime}</Text>
          </View>
          <View style={styles.kcalBadge}>
            <Text style={styles.kcalBadgeText}>{Math.round(item.calories)} kcal</Text>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {expanded ? (
          <View style={styles.mealBody}>
            {item.items.map((food) => (
              <TouchableOpacity
                activeOpacity={0.78}
                key={food.id}
                onLongPress={() => confirmDeleteItem(item.type, food.id)}
                style={styles.foodRow}>
                <View style={styles.foodTextWrap}>
                  <Text style={styles.foodName}>{food.name}</Text>
                  <Text style={styles.foodQty}>{food.qty} x {food.serving}</Text>
                </View>
                <Text style={styles.foodKcal}>{Math.round(food.calories)} kcal</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity accessibilityRole="button" style={styles.addItemButton} onPress={() => openLogMeal(item.type)}>
              <Ionicons name="add" size={18} color={colors.emeraldLight} />
              <Text style={styles.addItemText}>Add item</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + 170 },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={refreshData} tintColor={colors.emeraldLight} />}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Nutrition</Text>
            <View style={styles.dateNavigator}>
              <View style={styles.dateControls}>
                <TouchableOpacity accessibilityLabel="Previous day" onPress={() => setSelectedDate((date) => shiftDate(date, -1))}>
                  <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
                <Text style={styles.dateText}>{formatNavDate(selectedDate)}</Text>
                <TouchableOpacity accessibilityLabel="Next day" onPress={() => setSelectedDate((date) => shiftDate(date, 1))}>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              {canCloneYesterday ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={cloneLoading}
                  style={[styles.cloneButton, cloneLoading && styles.disabledButton]}
                  onPress={handleClone}>
                  <Ionicons name="copy-outline" size={14} color={colors.emeraldLight} />
                  <Text style={styles.cloneButtonText}>{cloneLoading ? 'Cloning' : 'Clone yesterday'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          <TouchableOpacity style={styles.templateButton} onPress={() => setTemplateModalVisible(true)}>
            <Ionicons name="albums-outline" size={17} color={colors.emeraldLight} />
            <Text style={styles.templateButtonText}>Templates</Text>
          </TouchableOpacity>
        </View>

        {toastMessage ? (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        ) : null}

        <View style={styles.heroCard}>
          <ProgressRing progress={progress} size={188} strokeWidth={15} color={colors.emerald} arcDegrees={240}>
            <Text style={styles.calorieValue}>{Math.round(calories)}</Text>
            <Text style={styles.calorieGoal}>/ {calorieGoal} kcal</Text>
          </ProgressRing>
          <View style={styles.macroStack}>
            <MacroBar label="Protein" current={Math.round(totals.protein)} target={macros.protein} color={colors.indigo} />
            <MacroBar label="Carbs" current={Math.round(totals.carbs)} target={macros.carbs} color={colors.amber} />
            <MacroBar label="Fat" current={Math.round(totals.fat)} target={macros.fat} color={colors.rose} />
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's Meals</Text>
          <TouchableOpacity style={styles.logMealButton} onPress={() => openLogMeal('breakfast')}>
            <Ionicons name="add" size={18} color={colors.textPrimary} />
            <Text style={styles.logMealText}>Log Meal</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={mealRows}
          keyExtractor={(item) => item.id}
          renderItem={renderMeal}
          scrollEnabled={false}
          ListEmptyComponent={<Text style={styles.emptyText}>No meals logged yet. Start with breakfast or jump straight to dinner.</Text>}
          contentContainerStyle={styles.mealList}
        />

        <View style={styles.footerCards}>
          {missingDinnerSnack.map((type) => (
            <TouchableOpacity key={type} style={styles.dashedCard} onPress={() => openLogMeal(type)}>
              <Text style={styles.dashedCardText}>+ Log {MEAL_META[type].label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.suggestionWrap, { bottom: insets.bottom + 76 }]}>
        <View style={styles.suggestionCard}>
          <View style={styles.suggestionIcon}>
            <Ionicons name="sparkles" size={18} color={colors.emeraldLight} />
          </View>
          <View style={styles.suggestionCopy}>
            <Text style={styles.suggestionLabel}>AI Suggestion</Text>
            {suggestionLoading ? (
              <View style={styles.skeletonWrap}>
                <View style={styles.skeletonLine} />
                <View style={[styles.skeletonLine, styles.skeletonShort]} />
              </View>
            ) : (
              <Text numberOfLines={2} style={styles.suggestionText}>{suggestion}</Text>
            )}
          </View>
          <TouchableOpacity disabled={suggestionLoading} style={styles.addDinnerButton} onPress={addSuggestionToDinner}>
            <Text style={styles.addDinnerText}>Add to Dinner</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={logModalVisible} animationType="slide" transparent onRequestClose={() => setLogModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log {MEAL_META[activeMealType].label}</Text>
              <TouchableOpacity onPress={() => setLogModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.mealChips}>
              {MEAL_ORDER.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.mealChip, activeMealType === type && styles.mealChipActive]}
                  onPress={() => setActiveMealType(type)}>
                  <Text style={[styles.mealChipText, activeMealType === type && styles.mealChipTextActive]}>{MEAL_META[type].label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                placeholder="Search food_items"
                placeholderTextColor={colors.textMuted}
                value={query}
                onChangeText={setQuery}
                style={styles.searchInput}
              />
              <TouchableOpacity onPress={() => setAddFoodModalVisible(true)}>
                <Ionicons name="add-circle-outline" size={22} color={colors.emeraldLight} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={foodResults}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              style={styles.foodResults}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.foodResultRow, selectedFood?.id === item.id && styles.foodResultActive]}
                  onPress={() => setSelectedFood(item)}>
                  <View>
                    <Text style={styles.foodName}>{item.name}</Text>
                    <Text style={styles.foodQty}>{item.serving} · P {item.protein}g · C {item.carbs}g · F {item.fat}g</Text>
                  </View>
                  <Text style={styles.foodKcal}>{item.calories} kcal</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No matching foods yet. Add a personal food item.</Text>}
            />
            <View style={styles.qtyPanel}>
              <Text style={styles.inputLabel}>Quantity</Text>
              <TextInput value={qty} onChangeText={setQty} keyboardType="decimal-pad" style={styles.qtyInput} />
              <Text style={styles.previewText}>
                {scaledPreview
                  ? `${scaledPreview.calories} kcal · P ${scaledPreview.protein}g · C ${scaledPreview.carbs}g · F ${scaledPreview.fat}g`
                  : 'Select a food to preview calories and macros'}
              </Text>
            </View>
            <TouchableOpacity disabled={!selectedFood} style={[styles.saveButton, !selectedFood && styles.disabledButton]} onPress={saveMealItem}>
              <Text style={styles.saveButtonText}>Save to meal_log_items</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={templateModalVisible} animationType="slide" transparent onRequestClose={() => setTemplateModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Meal Templates</Text>
              <TouchableOpacity onPress={() => setTemplateModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.mealChips}>
              {MEAL_ORDER.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.mealChip, activeMealType === type && styles.mealChipActive]}
                  onPress={() => setActiveMealType(type)}>
                  <Text style={[styles.mealChipText, activeMealType === type && styles.mealChipTextActive]}>{MEAL_META[type].label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <FlatList
              data={templates}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.templateRow}
                  onPress={async () => {
                    await applyTemplate(selectedDate, item.mealType, item);
                    setExpandedMeal(item.mealType);
                    setTemplateModalVisible(false);
                    showToast(`${item.name} added`);
                  }}>
                  <View style={styles.templateIcon}>
                    <Text style={styles.templateEmoji}>{MEAL_META[item.mealType].emoji}</Text>
                  </View>
                  <View style={styles.templateText}>
                    <Text style={styles.foodName}>{item.name}</Text>
                    <Text style={styles.foodQty}>
                      {item.items.length} items · {Math.round(item.calories)} kcal · P {Math.round(item.protein)}g
                    </Text>
                    <Text numberOfLines={2} style={styles.templateItems}>
                      {item.items.map((food) => `${food.qty} x ${food.name}`).join(' + ')}
                    </Text>
                  </View>
                  <Text style={styles.foodKcal}>{Math.round(item.calories)} kcal</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No saved templates found.</Text>}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={addFoodModalVisible} animationType="fade" transparent onRequestClose={() => setAddFoodModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Food Item</Text>
              <TouchableOpacity onPress={() => setAddFoodModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput placeholder="Food name" placeholderTextColor={colors.textMuted} value={foodDraft.name} onChangeText={(name) => setFoodDraft((draft) => ({ ...draft, name }))} style={styles.formInput} />
            <TextInput placeholder="Serving, e.g. 100g" placeholderTextColor={colors.textMuted} value={foodDraft.serving} onChangeText={(serving) => setFoodDraft((draft) => ({ ...draft, serving }))} style={styles.formInput} />
            <View style={styles.formGrid}>
              {(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => (
                <TextInput
                  key={key}
                  placeholder={key === 'calories' ? 'kcal' : `${key}g`}
                  placeholderTextColor={colors.textMuted}
                  value={foodDraft[key]}
                  keyboardType="decimal-pad"
                  onChangeText={(value) => setFoodDraft((draft) => ({ ...draft, [key]: value }))}
                  style={styles.formGridInput}
                />
              ))}
            </View>
            <TouchableOpacity style={styles.saveButton} onPress={saveFoodItem}>
              <Text style={styles.saveButtonText}>Add to personal database</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.sm,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  dateNavigator: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  dateControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dateText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '700',
    minWidth: 84,
    textAlign: 'center',
  },
  cloneButton: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: colors.emerald,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 30,
    paddingHorizontal: spacing.xs,
  },
  cloneButtonText: {
    color: colors.emeraldLight,
    fontSize: 11,
    fontWeight: '900',
  },
  templateButton: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderColor: colors.emerald,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.xs,
  },
  templateButtonText: {
    color: colors.emeraldLight,
    fontSize: 13,
    fontWeight: '800',
  },
  toast: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface2,
    borderColor: colors.emerald,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  toastText: {
    color: colors.emeraldLight,
    fontSize: 12,
    fontWeight: '800',
  },
  heroCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderTopColor: colors.emerald,
    borderTopWidth: 2,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  calorieValue: {
    color: colors.textPrimary,
    fontSize: 42,
    fontWeight: '800',
    lineHeight: 46,
  },
  calorieGoal: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
  },
  macroStack: {
    alignSelf: 'stretch',
    gap: spacing.xs,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '800',
  },
  logMealButton: {
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: radii.inner,
    flexDirection: 'row',
    gap: 3,
    minHeight: 38,
    paddingHorizontal: spacing.xs,
  },
  logMealText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  mealList: {
    gap: spacing.xs,
  },
  mealCard: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    overflow: 'hidden',
  },
  mealHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 64,
    padding: spacing.sm,
  },
  mealEmoji: {
    fontSize: 24,
    lineHeight: 28,
    width: 34,
  },
  mealTitleWrap: {
    flex: 1,
  },
  mealTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  mealTime: {
    ...typography.labelCaps,
    color: colors.textMuted,
    marginTop: 2,
  },
  kcalBadge: {
    backgroundColor: colors.emeraldBg,
    borderColor: colors.emerald,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: 5,
  },
  kcalBadgeText: {
    color: colors.emeraldLight,
    fontSize: 12,
    fontWeight: '800',
  },
  mealBody: {
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    padding: spacing.xs,
  },
  foodRow: {
    alignItems: 'center',
    borderRadius: radii.inner,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.xs,
  },
  foodTextWrap: {
    flex: 1,
  },
  foodName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  foodQty: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  foodKcal: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  addItemButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    marginTop: spacing.xs,
    minHeight: 40,
  },
  addItemText: {
    color: colors.emeraldLight,
    fontWeight: '800',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    padding: spacing.sm,
    textAlign: 'center',
  },
  footerCards: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dashedCard: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderStyle: 'dashed',
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 58,
  },
  dashedCardText: {
    color: colors.emeraldLight,
    fontWeight: '800',
  },
  suggestionWrap: {
    left: 16,
    position: 'absolute',
    right: 16,
  },
  suggestionCard: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.emerald,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 86,
    padding: spacing.sm,
    ...shadows.ambient,
  },
  suggestionIcon: {
    alignItems: 'center',
    backgroundColor: colors.emeraldBg,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  suggestionCopy: {
    flex: 1,
    gap: 3,
  },
  suggestionLabel: {
    ...typography.labelCaps,
    color: colors.emeraldLight,
  },
  suggestionText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  addDinnerButton: {
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: radii.inner,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: spacing.xs,
  },
  addDinnerText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
  },
  skeletonWrap: {
    gap: 6,
  },
  skeletonLine: {
    backgroundColor: colors.surface3,
    borderRadius: radii.pill,
    height: 10,
    width: '94%',
  },
  skeletonShort: {
    width: '64%',
  },
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.62)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    maxHeight: '88%',
    padding: spacing.sm,
    paddingBottom: spacing.md,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  mealChips: {
    flexDirection: 'row',
    gap: 6,
  },
  mealChip: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flex: 1,
    minHeight: 34,
    justifyContent: 'center',
  },
  mealChipActive: {
    backgroundColor: colors.emeraldBg,
    borderColor: colors.emerald,
  },
  mealChipText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  mealChipTextActive: {
    color: colors.emeraldLight,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.xs,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: 44,
  },
  foodResults: {
    maxHeight: 240,
  },
  foodResultRow: {
    alignItems: 'center',
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    minHeight: 58,
    padding: spacing.xs,
  },
  foodResultActive: {
    backgroundColor: colors.emeraldBg,
    borderColor: colors.emerald,
  },
  qtyPanel: {
    backgroundColor: colors.surface2,
    borderRadius: radii.inner,
    gap: spacing.xs,
    padding: spacing.xs,
  },
  inputLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  qtyInput: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  previewText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.emerald,
    borderRadius: radii.inner,
    justifyContent: 'center',
    minHeight: 48,
  },
  disabledButton: {
    opacity: 0.45,
  },
  saveButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  templateRow: {
    alignItems: 'center',
    borderColor: colors.borderLight,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    minHeight: 66,
    padding: spacing.xs,
  },
  templateIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  templateEmoji: {
    fontSize: 19,
  },
  templateText: {
    flex: 1,
  },
  templateItems: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
    marginTop: 2,
  },
  formInput: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: spacing.xs,
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  formGridInput: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    flexBasis: '47%',
    flexGrow: 1,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: spacing.xs,
  },
});
