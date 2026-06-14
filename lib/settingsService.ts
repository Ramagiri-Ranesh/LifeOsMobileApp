import { supabase } from '@/lib/supabase';
import {
  defaultSettingsSnapshot,
  getSettingsSnapshot,
  type AIModel,
  type AppMode,
  type NotificationTimes,
  type NotificationType,
  type QuietHours,
  type SettingsSnapshot,
  useSettingsStore,
} from '@/stores/useSettingsStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

const SETTINGS_SYNC_TIMEOUT_MS = 10000;

function isObject(value: Json | undefined): value is LooseRow {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asBooleanRecord(value: Json | undefined): Partial<Record<NotificationType, boolean>> {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [NotificationType, boolean] => typeof entry[1] === 'boolean'),
  );
}

function asQuietHours(value: Json | undefined): Partial<QuietHours> {
  if (!isObject(value)) return {};
  return {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
    ...(typeof value.start === 'string' ? { start: value.start } : {}),
    ...(typeof value.end === 'string' ? { end: value.end } : {}),
  };
}

function asNotificationTimes(value: Json | undefined): Partial<NotificationTimes> {
  if (!isObject(value)) return {};
  return {
    ...(typeof value.morning === 'string' ? { morning: value.morning } : {}),
    ...(typeof value.lunch === 'string' ? { lunch: value.lunch } : {}),
    ...(typeof value.workout === 'string' ? { workout: value.workout } : {}),
    ...(typeof value.evening === 'string' ? { evening: value.evening } : {}),
    ...(typeof value.weekly === 'string' ? { weekly: value.weekly } : {}),
  };
}

function asAIModel(value: Json | undefined): AIModel | undefined {
  return value === 'ollama' || value === 'openai' ? value : undefined;
}

function asAppMode(value: Json | undefined): AppMode | undefined {
  return value === 'system' || value === 'dark' || value === 'light' || value === 'amoled' || value === 'focus'
    ? value
    : undefined;
}

function snapshotToJson(snapshot: SettingsSnapshot) {
  return {
    notifications: JSON.parse(JSON.stringify(snapshot.notifications)) as Json,
    quiet_hours: JSON.parse(JSON.stringify(snapshot.quietHours)) as Json,
    notification_times: JSON.parse(JSON.stringify(snapshot.notificationTimes)) as Json,
    ai: JSON.parse(JSON.stringify({ model: snapshot.aiModel })) as Json,
    preferences: JSON.parse(JSON.stringify({ appMode: snapshot.appMode })) as Json,
  };
}

export function settingsSnapshotFromRow(row: LooseRow | null | undefined): SettingsSnapshot {
  if (!row) return defaultSettingsSnapshot;

  const ai = isObject(row.ai) ? row.ai : {};
  const preferences = isObject(row.preferences) ? row.preferences : {};

  return {
    notifications: {
      ...defaultSettingsSnapshot.notifications,
      ...asBooleanRecord(row.notifications),
    },
    quietHours: {
      ...defaultSettingsSnapshot.quietHours,
      ...asQuietHours(row.quiet_hours),
    },
    notificationTimes: {
      ...defaultSettingsSnapshot.notificationTimes,
      ...asNotificationTimes(row.notification_times),
    },
    aiModel: asAIModel(ai.model) ?? defaultSettingsSnapshot.aiModel,
    appMode: asAppMode(preferences.appMode) ?? defaultSettingsSnapshot.appMode,
  };
}

export async function loadAccountSettings(userId: string) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('Unable to load account settings', error.message);
    return null;
  }

  return {
    snapshot: settingsSnapshotFromRow((data ?? null) as LooseRow | null),
    updatedAt: typeof (data as LooseRow | null)?.updated_at === 'string' ? String((data as LooseRow).updated_at) : null,
  };
}

export async function saveAccountSettings(userId: string, snapshot = getSettingsSnapshot()) {
  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    ...snapshotToJson(snapshot),
    updated_at: now,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SETTINGS_SYNC_TIMEOUT_MS);

  try {
    const { error } = await supabase
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select('user_id, updated_at')
      .abortSignal(controller.signal)
      .single();

    if (error) {
      console.warn('Unable to sync account settings', error.message);
      return { ok: false, error: error.message } as const;
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Settings sync timed out. Check Supabase connectivity and try again.'
      : error instanceof Error
        ? error.message
        : 'Settings sync failed.';
    console.warn('Unable to sync account settings', message);
    return { ok: false, error: message } as const;
  } finally {
    clearTimeout(timeout);
  }

  return { ok: true, syncedAt: now } as const;
}

export async function hydrateAccountSettings(userId: string) {
  const loaded = await loadAccountSettings(userId);
  if (!loaded) return false;

  useSettingsStore.getState().hydrateSettings(loaded.snapshot, loaded.updatedAt ?? new Date().toISOString());
  return true;
}

export async function syncCurrentSettings(userId?: string | null) {
  if (!userId) return false;

  const store = useSettingsStore.getState();
  store.markSettingsSyncing();

  const result = await saveAccountSettings(userId, getSettingsSnapshot());
  if (result.ok) {
    useSettingsStore.getState().markSettingsSynced(result.syncedAt);
    return true;
  }

  useSettingsStore.getState().markSettingsError(result.error);
  return false;
}

export function exportSettingsJson() {
  const settings = useSettingsStore.getState();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      settings: {
        ...getSettingsSnapshot(settings),
        appLockEnabled: settings.appLockEnabled,
      },
    },
    null,
    2,
  );
}
