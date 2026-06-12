import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type NotificationType = 'morning' | 'lunch' | 'workout' | 'evening' | 'weekly' | 'aiAlerts';
export type AIModel = 'gemini' | 'ollama';

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

type SettingsState = {
  notifications: Record<NotificationType, boolean>;
  quietHours: QuietHours;
  notificationTimes: NotificationTimes;
  aiModel: AIModel;
  appLockEnabled: boolean;
  setNotificationEnabled: (type: NotificationType, enabled: boolean) => void;
  setQuietHours: (quietHours: Partial<QuietHours>) => void;
  setNotificationTime: (type: keyof NotificationTimes, time: string) => void;
  setAIModel: (model: AIModel) => void;
  setAppLockEnabled: (enabled: boolean) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      notifications: {
        morning: true,
        lunch: true,
        workout: true,
        evening: true,
        weekly: true,
        aiAlerts: true,
      },
      quietHours: {
        enabled: false,
        start: '22:30',
        end: '06:30',
      },
      notificationTimes: {
        morning: '07:00',
        lunch: '13:00',
        workout: '18:00',
        evening: '21:30',
        weekly: '20:00',
      },
      aiModel: 'gemini',
      appLockEnabled: false,
      setNotificationEnabled: (type, enabled) =>
        set((state) => ({ notifications: { ...state.notifications, [type]: enabled } })),
      setQuietHours: (quietHours) =>
        set((state) => ({ quietHours: { ...state.quietHours, ...quietHours } })),
      setNotificationTime: (type, time) =>
        set((state) => ({ notificationTimes: { ...state.notificationTimes, [type]: time } })),
      setAIModel: (aiModel) => set({ aiModel }),
      setAppLockEnabled: (appLockEnabled) => set({ appLockEnabled }),
    }),
    {
      name: 'lifeos-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        notifications: state.notifications,
        quietHours: state.quietHours,
        notificationTimes: state.notificationTimes,
        aiModel: state.aiModel,
        appLockEnabled: state.appLockEnabled,
      }),
    },
  ),
);
