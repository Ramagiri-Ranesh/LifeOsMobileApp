import * as BackgroundFetch from 'expo-background-fetch';
import Constants from 'expo-constants';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { getDailyBrief, getWeeklyReview } from '@/lib/ai';
import { supabase } from '@/lib/supabase';
import { useGoalsStore } from '@/stores/useGoalsStore';
import { useGymStore } from '@/stores/useGymStore';
import { useNutritionStore } from '@/stores/useNutritionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

const LIFEOS_ANOMALY_TASK = 'lifeos-ai-anomaly-alerts';
const LIFEOS_RECURRING_SCHEDULER = 'lifeos_recurring';
const TASK_REMINDER_SCHEDULER = 'task_reminder';
const LIFEOS_RECURRING_KINDS = [
  'daily_brief',
  'nutrition_reminder',
  'workout_reminder',
  'evening_review',
  'weekly_summary',
];

type NotificationRoute =
  | '/(tabs)'
  | '/(tabs)?reflection=1'
  | '/(tabs)/nutrition'
  | '/(tabs)/gym'
  | '/(tabs)/analytics'
  | '/(tabs)/settings'
  | '/notifications';

type EdgeAlert = {
  title?: string;
  body?: string;
  route?: NotificationRoute;
};

export type AppNotification = {
  id: string;
  user_id?: string;
  title: string;
  body: string;
  kind: string;
  route?: string;
  related_entity_type?: string;
  related_entity_id?: string;
  scheduled_at?: string;
  delivered_at?: string;
  read_at?: string;
  delivery_status?: string;
  metadata?: Json;
  created_at?: string;
};

type RouterLike = {
  push: (href: never) => void;
};

type NotificationsModule = typeof import('expo-notifications');

export type TaskNotificationScheduleResult =
  | { scheduled: true }
  | {
      scheduled: false;
      reason:
        | 'unsupported_runtime'
        | 'permission_denied'
        | 'invalid_date'
        | 'past_time'
        | 'schedule_failed';
      message: string;
    };

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

function nextScheduledAt(time: string, weekday?: number) {
  const { hour, minute } = parseTime(time);
  const next = new Date();
  next.setHours(hour, minute, 0, 0);

  if (weekday) {
    const currentWeekday = next.getDay() + 1;
    const daysToAdd = (weekday - currentWeekday + 7) % 7 || (next.getTime() <= Date.now() ? 7 : 0);
    next.setDate(next.getDate() + daysToAdd);
  } else if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
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
  const weeklyGoals = useGoalsStore.getState().weeklyGoals;
  const goalProgress = weeklyGoals.length
    ? Math.round(weeklyGoals.reduce((total, goal) => total + goal.progress, 0) / weeklyGoals.length)
    : 0;

  return {
    week: weekNumber(),
    goalProgress,
    gymSessions: Math.max(gym.activeSession.length > 0 ? 1 : 0, Math.min(useUserStore.getState().profile?.gymDaysPerWeek ?? 4, 3)),
    averageCalories: nutrition.calories || 2180,
    caloriesToday: nutrition.calories,
    meals: nutrition.todaysMeals,
    workoutSplit: gym.currentSplit,
  };
}

async function requestNotificationPermissions(notifications: NotificationsModule) {
  if (Platform.OS === 'web' || isExpoGoNotificationsUnsupported()) return false;

  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync('lifeos-reminders', {
      name: 'LifeOS reminders',
      importance: notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C3AED',
    });
  }

  const existing = await notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const requested = await notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function createNotificationRecord(params: {
  userId?: string | null;
  title: string;
  body: string;
  kind: string;
  route?: NotificationRoute;
  relatedEntityType?: string;
  relatedEntityId?: string;
  scheduledAt?: string;
  deliveredAt?: string;
  deliveryStatus?: 'scheduled' | 'delivered' | 'failed';
  metadata?: Record<string, unknown>;
}) {
  if (!params.userId) return null;

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: params.userId,
      title: params.title,
      body: params.body,
      kind: params.kind,
      route: params.route,
      related_entity_type: params.relatedEntityType,
      related_entity_id: params.relatedEntityId,
      scheduled_at: params.scheduledAt,
      delivered_at: params.deliveredAt,
      delivery_status: params.deliveryStatus ?? 'scheduled',
      metadata: JSON.parse(JSON.stringify(params.metadata ?? {})) as Json,
    })
    .select('*')
    .single();

  if (error) {
    console.warn('Unable to store notification', error.message);
    return null;
  }

  return data as AppNotification;
}

async function markNotificationDelivered(notificationId?: string, deviceNotificationId?: string) {
  if (!notificationId) return;

  const { error } = await supabase
    .from('notifications')
    .update({
      delivered_at: new Date().toISOString(),
      delivery_status: 'delivered',
      device_notification_id: deviceNotificationId,
    })
    .eq('id', notificationId);

  if (error) console.warn('Unable to mark notification delivered', error.message);
}

export async function loadAppNotifications(userId: string, limit = 50) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('Unable to load notifications', error.message);
    return [];
  }

  return (data ?? []) as AppNotification[];
}

export async function countUnreadNotifications(userId: string) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
    .or(`delivery_status.eq.delivered,scheduled_at.lte.${new Date().toISOString()}`);

  if (error) {
    console.warn('Unable to count notifications', error.message);
    return 0;
  }

  return count ?? 0;
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);

  if (error) console.warn('Unable to mark notification read', error.message);
}

export async function markAllNotificationsRead(userId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
    .or(`delivery_status.eq.delivered,scheduled_at.lte.${new Date().toISOString()}`);

  if (error) console.warn('Unable to mark notifications read', error.message);
}

async function scheduleRepeatingNotification(params: {
  title: string;
  body: string;
  time: string;
  data: Record<string, unknown>;
  weekday?: number;
  kind: string;
  route?: NotificationRoute;
}) {
  if (isWithinQuietHours(params.time)) return;

  const notifications = getNotifications();
  if (!notifications) return;

  const { hour, minute } = parseTime(params.time);
  const userId = useUserStore.getState().currentUserId;
  const notificationRecord = await createNotificationRecord({
    userId,
    title: params.title,
    body: params.body,
    kind: params.kind,
    route: params.route,
    scheduledAt: nextScheduledAt(params.time, params.weekday),
    metadata: { ...params.data, scheduler: LIFEOS_RECURRING_SCHEDULER },
  });
  const trigger = params.weekday
    ? ({ type: notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: params.weekday, hour, minute } as const)
    : ({ type: notifications.SchedulableTriggerInputTypes.DAILY, hour, minute } as const);

  const identifier = await notifications.scheduleNotificationAsync({
    content: {
      title: params.title,
      body: params.body,
      data: { ...params.data, scheduler: LIFEOS_RECURRING_SCHEDULER, userId, notificationId: notificationRecord?.id },
    },
    trigger,
  });

  if (notificationRecord?.id) {
    await supabase.from('notifications').update({ device_notification_id: identifier }).eq('id', notificationRecord.id);
  }
}

export async function scheduleTaskNotification(params: {
  taskId?: string;
  title: string;
  notes?: string | null;
  date: string;
  time: string;
}): Promise<TaskNotificationScheduleResult> {
  const notifications = getNotifications();
  if (!notifications) {
    return {
      scheduled: false,
      reason: 'unsupported_runtime',
      message: 'Android Expo Go cannot schedule LifeOS phone notifications. Use a development build or installed app for real reminders.',
    };
  }

  const granted = await requestNotificationPermissions(notifications);
  if (!granted) {
    return {
      scheduled: false,
      reason: 'permission_denied',
      message: 'Notification permission is off. Enable notifications for LifeOS in device settings and try again.',
    };
  }

  const { hour, minute } = parseTime(params.time);
  const [yearRaw, monthRaw, dayRaw] = params.date.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return {
      scheduled: false,
      reason: 'invalid_date',
      message: 'Use a valid task date in YYYY-MM-DD format.',
    };
  }

  const triggerAt = new Date(year, month - 1, day, hour, minute);
  if (triggerAt.getTime() <= Date.now()) {
    return {
      scheduled: false,
      reason: 'past_time',
      message: 'The reminder time is already past. Choose a future time and save again.',
    };
  }
  const userId = useUserStore.getState().currentUserId;
  const body = params.notes || 'Your task is due now.';
  const notificationRecord = await createNotificationRecord({
    userId,
    title: `Task time: ${params.title}`,
    body,
    kind: 'task_reminder',
    route: '/(tabs)',
    relatedEntityType: 'task',
    relatedEntityId: params.taskId,
    scheduledAt: triggerAt.toISOString(),
    metadata: { scheduler: TASK_REMINDER_SCHEDULER, action: 'taskReminder', taskId: params.taskId },
  });

  try {
    const identifier = await notifications.scheduleNotificationAsync({
      content: {
        title: `Task time: ${params.title}`,
        body,
        data: {
          route: '/(tabs)',
          scheduler: TASK_REMINDER_SCHEDULER,
          action: 'taskReminder',
          taskId: params.taskId,
          userId,
          notificationId: notificationRecord?.id,
        },
      },
      trigger: { type: notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt },
    });

    if (notificationRecord?.id) {
      await supabase.from('notifications').update({ device_notification_id: identifier }).eq('id', notificationRecord.id);
    }
  } catch (error) {
    console.warn('Unable to schedule task notification', error);
    if (notificationRecord?.id) {
      await supabase.from('notifications').update({ delivery_status: 'failed' }).eq('id', notificationRecord.id);
    }
    return {
      scheduled: false,
      reason: 'schedule_failed',
      message: 'LifeOS could not schedule the device reminder. Check notification permission and exact alarm settings.',
    };
  }

  return { scheduled: true };
}

export async function cancelTaskNotification(taskId: string) {
  const notifications = getNotifications();
  if (!notifications) return false;

  const scheduled = await notifications.getAllScheduledNotificationsAsync();
  const taskNotifications = scheduled.filter((notification) => {
    const data = notification.content.data as { action?: string; taskId?: string };
    return data.action === 'taskReminder' && data.taskId === taskId;
  });

  await Promise.all(
    taskNotifications.map((notification) => notifications.cancelScheduledNotificationAsync(notification.identifier)),
  );

  return taskNotifications.length > 0;
}

function isLifeOSRecurringNotification(data: { scheduler?: string; action?: string; route?: string; taskId?: string }) {
  if (data.scheduler === LIFEOS_RECURRING_SCHEDULER) return true;
  if (data.scheduler === TASK_REMINDER_SCHEDULER || data.action === 'taskReminder' || data.taskId) return false;

  return (
    data.action === 'dailyHub' ||
    data.action === 'reflection' ||
    data.action === 'weeklyReview' ||
    data.route === '/(tabs)/nutrition' ||
    data.route === '/(tabs)/gym' ||
    data.route === '/(tabs)/analytics'
  );
}

async function cancelLifeOSRecurringNotifications(notifications: NotificationsModule) {
  const scheduled = await notifications.getAllScheduledNotificationsAsync();
  const recurringNotifications = scheduled.filter((notification) => {
    const data = notification.content.data as { scheduler?: string; action?: string; route?: string; taskId?: string };
    return isLifeOSRecurringNotification(data);
  });

  await Promise.all(
    recurringNotifications.map((notification) => notifications.cancelScheduledNotificationAsync(notification.identifier)),
  );

  return recurringNotifications.length;
}

async function clearPendingLifeOSReminderRecords(userId?: string | null) {
  if (!userId) return;

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('user_id', userId)
    .eq('delivery_status', 'scheduled')
    .in('kind', LIFEOS_RECURRING_KINDS);

  if (error) console.warn('Unable to clear pending recurring reminder records', error.message);
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

  await cancelLifeOSRecurringNotifications(notifications);
  await clearPendingLifeOSReminderRecords(user.currentUserId);

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
      kind: 'daily_brief',
      route: '/(tabs)',
    });
  }

  if (settings.notifications.lunch) {
    await scheduleRepeatingNotification({
      title: 'Lunch reminder',
      body: `${caloriesRemaining} kcal remaining today`,
      time: settings.notificationTimes.lunch,
      data: { route: '/(tabs)/nutrition' },
      kind: 'nutrition_reminder',
      route: '/(tabs)/nutrition',
    });
  }

  if (settings.notifications.workout && workoutLabel) {
    await scheduleRepeatingNotification({
      title: 'Workout time?',
      body: `${workoutLabel} is scheduled today`,
      time: settings.notificationTimes.workout,
      data: { route: '/(tabs)/gym' },
      kind: 'workout_reminder',
      route: '/(tabs)/gym',
    });
  }

  if (settings.notifications.evening) {
    await scheduleRepeatingNotification({
      title: 'Evening review',
      body: 'How was today?',
      time: settings.notificationTimes.evening,
      data: { route: '/(tabs)?reflection=1', action: 'reflection' },
      kind: 'evening_review',
      route: '/(tabs)?reflection=1',
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
      body: `${weekly.goalProgress}% goal progress, ${weekly.gymSessions} gym sessions, avg ${weekly.averageCalories.toLocaleString()} kcal`,
      time: settings.notificationTimes.weekly,
      weekday: 1,
      data: { route: '/(tabs)/analytics', action: 'weeklyReview', weekly },
      kind: 'weekly_summary',
      route: '/(tabs)/analytics',
    });
  }

  return true;
}

export function registerNotificationResponseHandler(router: RouterLike) {
  const notifications = getNotifications();
  if (!notifications) return () => {};

  const subscription = notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { route?: NotificationRoute; action?: string; notificationId?: string };
    void markNotificationDelivered(data.notificationId, response.notification.request.identifier);
    const route = data.route ?? '/(tabs)';
    router.push(route as never);
  });

  return () => subscription.remove();
}

export function registerNotificationReceivedHandler() {
  const notifications = getNotifications();
  if (!notifications) return () => {};

  const subscription = notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as {
      notificationId?: string;
      userId?: string;
      route?: NotificationRoute;
      action?: string;
      taskId?: string;
    };

    void markNotificationDelivered(data.notificationId, notification.request.identifier);

    if (!data.notificationId && data.userId) {
      void createNotificationRecord({
        userId: data.userId,
        title: notification.request.content.title ?? 'LifeOS notification',
        body: notification.request.content.body ?? 'Open LifeOS to review this update.',
        kind: data.action ?? 'system',
        route: data.route,
        relatedEntityType: data.taskId ? 'task' : undefined,
        relatedEntityId: data.taskId,
        deliveredAt: new Date().toISOString(),
        deliveryStatus: 'delivered',
        metadata: data,
      });
    }
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
  };

  const { data, error } = await supabase.functions.invoke('lifeos-anomaly-alerts', { body: payload });
  if (error) throw error;

  const alerts = Array.isArray((data as { alerts?: EdgeAlert[] } | null)?.alerts)
    ? ((data as { alerts: EdgeAlert[] }).alerts)
    : [];

  await Promise.all(
    alerts.map(async (alert) => {
      const userId = useUserStore.getState().currentUserId;
      const notificationRecord = await createNotificationRecord({
        userId,
        title: alert.title ?? 'LifeOS alert',
        body: alert.body ?? 'There is a pattern worth checking today.',
        kind: 'ai_alert',
        route: alert.route ?? '/(tabs)',
        deliveredAt: new Date().toISOString(),
        deliveryStatus: 'delivered',
        metadata: alert,
      });

      const identifier = await notifications.scheduleNotificationAsync({
        content: {
          title: alert.title ?? 'LifeOS alert',
          body: alert.body ?? 'There is a pattern worth checking today.',
          data: { route: alert.route ?? '/(tabs)', userId, notificationId: notificationRecord?.id },
        },
        trigger: null,
      });

      if (notificationRecord?.id) {
        await supabase.from('notifications').update({ device_notification_id: identifier }).eq('id', notificationRecord.id);
      }
    }),
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
        appMode: settings.appMode,
        appLockEnabled: settings.appLockEnabled,
      },
    },
    null,
    2,
  );
}
