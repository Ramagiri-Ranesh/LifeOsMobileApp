import * as BackgroundFetch from 'expo-background-fetch';
import Constants from 'expo-constants';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { getDailyBrief, getWeeklyReview } from '@/lib/ai';
import { supabase } from '@/lib/supabase';
import { useGymStore } from '@/stores/useGymStore';
import { useHabitsStore } from '@/stores/useHabitsStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';

const LIFEOS_ANOMALY_TASK = 'lifeos-ai-anomaly-alerts';

type NotificationRoute =
  | '/(tabs)'
  | '/(tabs)?reflection=1'
  | '/(tabs)/nutrition'
  | '/(tabs)/gym'
  | '/(tabs)/analytics'
  | '/(tabs)/settings';

type EdgeAlert = {
  title?: string;
  body?: string;
  route?: NotificationRoute;
};

type RouterLike = {
  push: (href: never) => void;
};

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;
let notificationHandlerConfigured = false;

function isExpoGoNotificationsUnsupported() {
  return Platform.OS === 'android' && Constants.appOwnership === 'expo';
}

function getNotifications() {
  if (Platform.OS === 'web' || isExpoGoNotificationsUnsupported()) return null;
  if (notificationsModule !== undefined) return notificationsModule;

  try {
    notificationsModule = require('expo-notifications') as NotificationsModule;
  } catch (error) {
    console.warn('Notifications are unavailable in this runtime', error);
    notificationsModule = null;
  }

  if (notificationsModule && !notificationHandlerConfigured) {
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    notificationHandlerConfigured = true;
  }

  return notificationsModule;
}

function parseTime(time: string) {
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return { hour: 7, minute: 0 };
  return {
    hour: Math.min(23, Math.max(0, hour)),
    minute: Math.min(59, Math.max(0, minute)),
  };
}

function minutesSinceMidnight(time: string) {
  const { hour, minute } = parseTime(time);
  return hour * 60 + minute;
}

function isWithinQuietHours(time: string) {
  const { quietHours } = useSettingsStore.getState();
  if (!quietHours.enabled) return false;

  const value = minutesSinceMidnight(time);
  const start = minutesSinceMidnight(quietHours.start);
  const end = minutesSinceMidnight(quietHours.end);

  if (start <= end) return value >= start && value <= end;
  return value >= start || value <= end;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekNumber(date = new Date()) {
  const firstDay = new Date(date.getFullYear(), 0, 1);
  const elapsedDays = Math.floor((date.getTime() - firstDay.getTime()) / 86400000);
  return Math.ceil((elapsedDays + firstDay.getDay() + 1) / 7);
}

function workoutForToday() {
  const split = useGymStore.getState().currentSplit;
  const day = new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date());
  const longDay = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date());

  if (!split.toLowerCase().includes(day.toLowerCase()) && !split.toLowerCase().includes(longDay.toLowerCase())) {
    return null;
  }

  const beforeDay = split.split(new RegExp(`${day}|${longDay}`, 'i'))[0]?.trim();
  const label = beforeDay?.split(',').pop()?.replace(/[:·-]/g, '').trim();
  return label || 'Workout';
}

function aggregateWeeklyData() {
  const nutrition = useNutritionStore.getState();
  const gym = useGymStore.getState();
  const habits = useHabitsStore.getState();
  const goalsHit = habits.habits.length
    ? Math.round((habits.habits.filter((habit) => habit.completedToday).length / habits.habits.length) * 100)
    : 74;

  return {
    week: weekNumber(),
    goalsHit,
    gymSessions: Math.max(gym.activeSession.length > 0 ? 1 : 0, Math.min(useUserStore.getState().profile?.gymDaysPerWeek ?? 4, 3)),
    averageCalories: nutrition.calories || 2180,
    caloriesToday: nutrition.calories,
    meals: nutrition.todaysMeals,
    habitStreaks: habits.habits.map((habit) => ({ name: habit.name, streak: habit.streak })),
    workoutSplit: gym.currentSplit,
  };
}

async function requestNotificationPermissions(notifications: NotificationsModule) {
  if (Platform.OS === 'web' || isExpoGoNotificationsUnsupported()) return false;

  const existing = await notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const requested = await notifications.requestPermissionsAsync();
  return requested.granted;
}

async function scheduleRepeatingNotification(params: {
  title: string;
  body: string;
  time: string;
  data: Record<string, unknown>;
  weekday?: number;
}) {
  if (isWithinQuietHours(params.time)) return;

  const notifications = getNotifications();
  if (!notifications) return;

  const { hour, minute } = parseTime(params.time);
  const trigger = params.weekday
    ? ({ type: notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: params.weekday, hour, minute } as const)
    : ({ type: notifications.SchedulableTriggerInputTypes.DAILY, hour, minute } as const);

  await notifications.scheduleNotificationAsync({
    content: {
      title: params.title,
      body: params.body,
      data: params.data,
    },
    trigger,
  });
}

export async function scheduleLifeOSNotifications() {
  const notifications = getNotifications();
  if (!notifications) return false;

  const granted = await requestNotificationPermissions(notifications);
  if (!granted) return false;

  const settings = useSettingsStore.getState();
  const user = useUserStore.getState();
  const nutrition = useNutritionStore.getState();
  const caloriesRemaining = Math.max(0, user.calorieGoal - nutrition.calories);
  const workoutLabel = workoutForToday();
  const weekly = aggregateWeeklyData();

  await notifications.cancelAllScheduledNotificationsAsync();

  if (settings.notifications.morning) {
    let brief = 'Check your plan and start with breakfast.';
    try {
      brief =
        (await getDailyBrief({
          date: localDateKey(),
          caloriesRemaining,
          meals: nutrition.todaysMeals,
          workout: workoutLabel,
        }))
          .trim()
          .split('\n')[0] || brief;
    } catch (error) {
      console.warn('Unable to prepare morning notification brief', error);
    }

    await scheduleRepeatingNotification({
      title: 'Good morning! Log breakfast + check today\'s plan',
      body: brief,
      time: settings.notificationTimes.morning,
      data: { route: '/(tabs)', action: 'dailyHub' },
    });
  }

  if (settings.notifications.lunch) {
    await scheduleRepeatingNotification({
      title: 'Lunch reminder',
      body: `${caloriesRemaining} kcal remaining today`,
      time: settings.notificationTimes.lunch,
      data: { route: '/(tabs)/nutrition' },
    });
  }

  if (settings.notifications.workout && workoutLabel) {
    await scheduleRepeatingNotification({
      title: 'Workout time?',
      body: `${workoutLabel} is scheduled today`,
      time: settings.notificationTimes.workout,
      data: { route: '/(tabs)/gym' },
    });
  }

  if (settings.notifications.evening) {
    await scheduleRepeatingNotification({
      title: 'Evening review',
      body: 'How was today?',
      time: settings.notificationTimes.evening,
      data: { route: '/(tabs)?reflection=1', action: 'reflection' },
    });
  }

  if (settings.notifications.weekly) {
    try {
      await getWeeklyReview(weekly);
    } catch (error) {
      console.warn('Unable to prepare weekly AI review', error);
    }

    await scheduleRepeatingNotification({
      title: `Week ${weekly.week} complete`,
      body: `${weekly.goalsHit}% goals hit, ${weekly.gymSessions} gym sessions, avg ${weekly.averageCalories.toLocaleString()} kcal`,
      time: settings.notificationTimes.weekly,
      weekday: 1,
      data: { route: '/(tabs)/analytics', action: 'weeklyReview', weekly },
    });
  }

  return true;
}

export function registerNotificationResponseHandler(router: RouterLike) {
  const notifications = getNotifications();
  if (!notifications) return () => {};

  const subscription = notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { route?: NotificationRoute; action?: string };
    const route = data.route ?? '/(tabs)';
    router.push(route as never);
  });

  return () => subscription.remove();
}

async function runAnomalyCheck() {
  if (!useSettingsStore.getState().notifications.aiAlerts) return BackgroundFetch.BackgroundFetchResult.NoData;

  const notifications = getNotifications();
  if (!notifications) return BackgroundFetch.BackgroundFetchResult.NoData;

  const payload = {
    date: localDateKey(),
    calorieGoal: useUserStore.getState().calorieGoal,
    gymGoalPerWeek: useUserStore.getState().profile?.gymDaysPerWeek ?? useUserStore.getState().onboardingProfile.gymDaysPerWeek,
    meals: useNutritionStore.getState().todaysMeals,
    habits: useHabitsStore.getState().habits,
  };

  const { data, error } = await supabase.functions.invoke('lifeos-anomaly-alerts', { body: payload });
  if (error) throw error;

  const alerts = Array.isArray((data as { alerts?: EdgeAlert[] } | null)?.alerts)
    ? ((data as { alerts: EdgeAlert[] }).alerts)
    : [];

  await Promise.all(
    alerts.map((alert) =>
      notifications.scheduleNotificationAsync({
        content: {
          title: alert.title ?? 'LifeOS alert',
          body: alert.body ?? 'There is a pattern worth checking today.',
          data: { route: alert.route ?? '/(tabs)' },
        },
        trigger: null,
      }),
    ),
  );

  return alerts.length > 0 ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
}

if (!TaskManager.isTaskDefined(LIFEOS_ANOMALY_TASK)) {
  TaskManager.defineTask(LIFEOS_ANOMALY_TASK, async () => {
    try {
      return await runAnomalyCheck();
    } catch (error) {
      console.warn('LifeOS anomaly task failed', error);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

export async function registerLifeOSBackgroundTasks() {
  if (Platform.OS === 'web' || isExpoGoNotificationsUnsupported()) return;

  const registered = await TaskManager.isTaskRegisteredAsync(LIFEOS_ANOMALY_TASK);
  if (registered) return;

  await BackgroundFetch.registerTaskAsync(LIFEOS_ANOMALY_TASK, {
    minimumInterval: 60 * 60 * 6,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export function exportSettingsBackup() {
  const settings = useSettingsStore.getState();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      settings: {
        notifications: settings.notifications,
        quietHours: settings.quietHours,
        notificationTimes: settings.notificationTimes,
        aiModel: settings.aiModel,
        appLockEnabled: settings.appLockEnabled,
      },
    },
    null,
    2,
  );
}
