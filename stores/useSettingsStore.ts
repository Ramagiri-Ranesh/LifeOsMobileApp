import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type NotificationType = 'morning' | 'lunch' | 'workout' | 'evening' | 'weekly' | 'aiAlerts';
export type AIModel = 'openai' | 'ollama';
export type AppMode = 'system' | 'dark' | 'light' | 'amoled' | 'focus';
export type SettingsSyncStatus = 'local' | 'dirty' | 'syncing' | 'synced' | 'error';

export type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
};

export type NotificationTimes = {
  morning: string;
  lunch: string;
  workout: string;
  evening: string;
  weekly: string;
};

export type SettingsSnapshot = {
  notifications: Record<NotificationType, boolean>;
  quietHours: QuietHours;
  notificationTimes: NotificationTimes;
  aiModel: AIModel;
  appMode: AppMode;
};

export type SettingsState = SettingsSnapshot & {
  appLockEnabled: boolean;
  settingsSyncStatus: SettingsSyncStatus;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  setNotificationEnabled: (type: NotificationType, enabled: boolean) => void;
  setQuietHours: (quietHours: Partial<QuietHours>) => void;
  setNotificationTime: (type: keyof NotificationTimes, time: string) => void;
  setAIModel: (model: AIModel) => void;
  setAppMode: (mode: AppMode) => void;
  setAppLockEnabled: (enabled: boolean) => void;
  hydrateSettings: (settings: Partial<SettingsSnapshot>, syncedAt?: string) => void;
  markSettingsSyncing: () => void;
  markSettingsSynced: (syncedAt?: string) => void;
  markSettingsError: (message: string) => void;
};

const defaultNotifications: Record<NotificationType, boolean> = {
  morning: true,
  lunch: true,
  workout: true,
  evening: true,
  weekly: true,
  aiAlerts: true,
};

const defaultQuietHours: QuietHours = {
  enabled: false,
  start: '22:30',
  end: '06:30',
};

const defaultNotificationTimes: NotificationTimes = {
  morning: '07:00',
  lunch: '13:00',
  workout: '18:00',
  evening: '21:30',
  weekly: '20:00',
};

export const defaultSettingsSnapshot: SettingsSnapshot = {
  notifications: defaultNotifications,
  quietHours: defaultQuietHours,
  notificationTimes: defaultNotificationTimes,
  aiModel: 'openai',
  appMode: 'system',
};

function normalizeAIModel(model: unknown): AIModel {
  return model === 'ollama' || model === 'openai' ? model : defaultSettingsSnapshot.aiModel;
}

function normalizeAppMode(mode: unknown): AppMode {
  return mode === 'system' || mode === 'dark' || mode === 'light' || mode === 'amoled' || mode === 'focus'
    ? mode
    : defaultSettingsSnapshot.appMode;
}

export function getSettingsSnapshot(state: SettingsState = useSettingsStore.getState()): SettingsSnapshot {
  return {
    notifications: state.notifications,
    quietHours: state.quietHours,
    notificationTimes: state.notificationTimes,
    aiModel: normalizeAIModel(state.aiModel),
    appMode: normalizeAppMode(state.appMode),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettingsSnapshot,
      appLockEnabled: false,
      settingsSyncStatus: 'local',
      lastSyncedAt: null,
      lastSyncError: null,
      setNotificationEnabled: (type, enabled) =>
        set((state) => ({ notifications: { ...state.notifications, [type]: enabled }, settingsSyncStatus: 'dirty' })),
      setQuietHours: (quietHours) =>
        set((state) => ({ quietHours: { ...state.quietHours, ...quietHours }, settingsSyncStatus: 'dirty' })),
      setNotificationTime: (type, time) =>
        set((state) => ({ notificationTimes: { ...state.notificationTimes, [type]: time }, settingsSyncStatus: 'dirty' })),
      setAIModel: (aiModel) => set({ aiModel, settingsSyncStatus: 'dirty' }),
      setAppMode: (appMode) => set({ appMode, settingsSyncStatus: 'dirty' }),
      setAppLockEnabled: (appLockEnabled) => set({ appLockEnabled }),
      hydrateSettings: (settings, syncedAt) =>
        set((state) => ({
          notifications: { ...defaultNotifications, ...state.notifications, ...settings.notifications },
          quietHours: { ...defaultQuietHours, ...state.quietHours, ...settings.quietHours },
          notificationTimes: { ...defaultNotificationTimes, ...state.notificationTimes, ...settings.notificationTimes },
          aiModel: normalizeAIModel(settings.aiModel ?? state.aiModel),
          appMode: normalizeAppMode(settings.appMode ?? state.appMode),
          settingsSyncStatus: syncedAt ? 'synced' : state.settingsSyncStatus,
          lastSyncedAt: syncedAt ?? state.lastSyncedAt,
          lastSyncError: null,
        })),
      markSettingsSyncing: () => set({ settingsSyncStatus: 'syncing', lastSyncError: null }),
      markSettingsSynced: (syncedAt) =>
        set({ settingsSyncStatus: 'synced', lastSyncedAt: syncedAt ?? new Date().toISOString(), lastSyncError: null }),
      markSettingsError: (message) => set({ settingsSyncStatus: 'error', lastSyncError: message }),
    }),
    {
      name: 'lifeos-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        notifications: state.notifications,
        quietHours: state.quietHours,
        notificationTimes: state.notificationTimes,
        aiModel: state.aiModel,
        appMode: state.appMode,
        appLockEnabled: state.appLockEnabled,
        settingsSyncStatus: state.settingsSyncStatus,
        lastSyncedAt: state.lastSyncedAt,
        lastSyncError: state.lastSyncError,
      }),
    },
  ),
);
