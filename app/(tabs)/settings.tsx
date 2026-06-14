import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LifeOSCard } from '@/components/ui/LifeOSCard';
import { exportSettingsBackup, scheduleLifeOSNotifications } from '@/lib/notifications';
import { appModeOptions, colorsForAppMode, radii, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';
import { syncCurrentSettings } from '@/lib/settingsService';
import { type AIModel, type AppMode, type NotificationType, useSettingsStore } from '@/stores/useSettingsStore';
import { useUserStore } from '@/stores/useUserStore';

const NOTIFICATION_ROWS: { key: NotificationType; title: string; detail: string }[] = [
  { key: 'morning', title: 'Morning brief', detail: '7 AM Daily Hub prompt with AI insight' },
  { key: 'lunch', title: 'Lunch calories', detail: 'Midday remaining-calorie reminder' },
  { key: 'workout', title: 'Workout reminder', detail: 'Gym-day reminder based on split' },
  { key: 'evening', title: 'Evening review', detail: 'Reflection modal reminder' },
  { key: 'weekly', title: 'Weekly summary', detail: 'Sunday 8 PM goal review' },
  { key: 'aiAlerts', title: 'AI anomaly alerts', detail: 'Background nutrition and gym checks' },
];

const TIME_ROWS = [
  { key: 'morning', label: 'Morning' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'workout', label: 'Workout' },
  { key: 'evening', label: 'Evening' },
  { key: 'weekly', label: 'Weekly' },
] as const;

const SETTINGS_SYNC_DEBOUNCE_MS = 700;

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const notifications = useSettingsStore((state) => state.notifications);
  const quietHours = useSettingsStore((state) => state.quietHours);
  const notificationTimes = useSettingsStore((state) => state.notificationTimes);
  const aiModel = useSettingsStore((state) => state.aiModel);
  const appMode = useSettingsStore((state) => state.appMode);
  const appLockEnabled = useSettingsStore((state) => state.appLockEnabled);
  const settingsSyncStatus = useSettingsStore((state) => state.settingsSyncStatus);
  const lastSyncedAt = useSettingsStore((state) => state.lastSyncedAt);
  const lastSyncError = useSettingsStore((state) => state.lastSyncError);
  const setNotificationEnabled = useSettingsStore((state) => state.setNotificationEnabled);
  const setQuietHours = useSettingsStore((state) => state.setQuietHours);
  const setNotificationTime = useSettingsStore((state) => state.setNotificationTime);
  const setAIModel = useSettingsStore((state) => state.setAIModel);
  const setAppMode = useSettingsStore((state) => state.setAppMode);
  const setAppLockEnabled = useSettingsStore((state) => state.setAppLockEnabled);
  const profile = useUserStore((state) => state.profile);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const resetAuth = useUserStore((state) => state.resetAuth);

  const [backupVisible, setBackupVisible] = useState(false);
  const [backupJson, setBackupJson] = useState('');
  const [saving, setSaving] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncSettings = useCallback(() => {
    if (!currentUserId) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      void syncCurrentSettings(currentUserId);
    }, SETTINGS_SYNC_DEBOUNCE_MS);
  }, [currentUserId]);

  const syncSettingsNow = useCallback(async () => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (!currentUserId) return false;
    return syncCurrentSettings(currentUserId);
  }, [currentUserId]);

  useEffect(
    () => () => {
      if (!syncTimerRef.current) return;
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      if (currentUserId) void syncCurrentSettings(currentUserId);
    },
    [currentUserId],
  );

  const updateNotification = (type: NotificationType, enabled: boolean) => {
    setNotificationEnabled(type, enabled);
    syncSettings();
  };

  const updateAIModel = (model: AIModel) => {
    setAIModel(model);
    syncSettings();
  };

  const updateAppMode = (mode: AppMode) => {
    setAppMode(mode);
    syncSettings();
  };

  const toggleAppLock = async (enabled: boolean) => {
    if (!enabled) {
      setAppLockEnabled(false);
      return;
    }

    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!compatible || !enrolled) {
      Alert.alert('Biometric lock unavailable', 'Set up Face ID, Touch ID, or device biometrics first.');
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Enable LifeOS app lock',
      fallbackLabel: 'Use passcode',
    });
    if (result.success) setAppLockEnabled(true);
  };

  const refreshSchedules = async () => {
    const invalid = TIME_ROWS.find((row) => !validTime(notificationTimes[row.key]));
    if (invalid) {
      Alert.alert('Check reminder time', `${invalid.label} must use 24-hour HH:mm format.`);
      return;
    }

    if (quietHours.enabled && (!validTime(quietHours.start) || !validTime(quietHours.end))) {
      Alert.alert('Check quiet hours', 'Quiet hours must use 24-hour HH:mm format.');
      return;
    }

    setSaving(true);
    try {
      await syncSettingsNow();
      const scheduled = await scheduleLifeOSNotifications();
      Alert.alert(scheduled ? 'Notifications scheduled' : 'Permission needed', scheduled ? 'Your LifeOS reminders are refreshed.' : 'Enable notifications to schedule reminders.');
    } catch (error) {
      console.warn('Unable to schedule notifications', error);
      Alert.alert('Could not schedule notifications', 'Please try again after checking notification permissions.');
    } finally {
      setSaving(false);
    }
  };

  const showBackup = () => {
    setBackupJson(exportSettingsBackup());
    setBackupVisible(true);
  };

  const performLogout = () => {
    resetAuth();
    router.replace('/(onboarding)/login');
  };

  const logout = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Logout? You will need to login again to open your dashboard.')) {
        performLogout();
      }
      return;
    }

    Alert.alert('Logout', 'You will need to login again to open your dashboard.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: performLogout,
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Control Center</Text>
            <Text style={styles.title}>Settings</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={refreshSchedules} style={styles.iconButton}>
            <Ionicons name="notifications-outline" color={colors.violetLight} size={22} />
          </TouchableOpacity>
        </View>

        <LifeOSCard>
          <View style={styles.profileRow}>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>{(profile?.name?.charAt(0) || 'U').toUpperCase()}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.sectionTitle}>Profile</Text>
              <Text style={styles.rowDetail}>
                {profile?.name ?? 'User'} - {profile?.goal ?? 'LifeOS profile'}
              </Text>
            </View>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/profile' as never)} style={styles.secondaryButton}>
            <Ionicons name="person-circle-outline" color={colors.textPrimary} size={18} />
            <Text style={styles.secondaryText}>View and edit profile</Text>
          </TouchableOpacity>
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>System Status</Text>
          <View style={styles.statusGrid}>
            <View style={styles.statusPill}>
              <Text style={styles.statusLabel}>Account</Text>
              <Text style={styles.statusValue}>{currentUserId ? 'Signed in' : 'Local only'}</Text>
            </View>
            <View style={styles.statusPill}>
              <Text style={styles.statusLabel}>Settings sync</Text>
              <Text style={styles.statusValue}>{settingsSyncStatus}</Text>
            </View>
            <View style={styles.statusPill}>
              <Text style={styles.statusLabel}>Last sync</Text>
              <Text style={styles.statusValue}>{lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}</Text>
            </View>
            <View style={styles.statusPill}>
              <Text style={styles.statusLabel}>App lock</Text>
              <Text style={styles.statusValue}>{appLockEnabled ? 'On' : 'Off'}</Text>
            </View>
          </View>
          {lastSyncError ? <Text style={styles.errorText}>Sync issue: {lastSyncError}</Text> : null}
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>Notifications</Text>
          {NOTIFICATION_ROWS.map((row) => (
            <View key={row.key} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowDetail}>{row.detail}</Text>
              </View>
              <Switch
                value={notifications[row.key]}
                onValueChange={(value) => updateNotification(row.key, value)}
                thumbColor={notifications[row.key] ? colors.violetLight : colors.textMuted}
                trackColor={{ false: colors.surface3, true: colors.violetBg }}
              />
            </View>
          ))}
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>Reminder Times</Text>
          {TIME_ROWS.map((row) => (
            <View key={row.key} style={styles.timeRow}>
              <Text style={styles.rowTitle}>{row.label}</Text>
              <TextInput
                value={notificationTimes[row.key]}
                onChangeText={(value) => setNotificationTime(row.key, value)}
                onBlur={syncSettings}
                keyboardType="numbers-and-punctuation"
                placeholder="HH:mm"
                placeholderTextColor={colors.textMuted}
                style={[styles.timeInput, !validTime(notificationTimes[row.key]) && styles.inputError]}
              />
            </View>
          ))}
          <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={refreshSchedules} style={styles.primaryButton}>
            <Ionicons name="refresh-outline" color={colors.background} size={18} />
            <Text style={styles.primaryText}>{saving ? 'Scheduling...' : 'Refresh schedules'}</Text>
          </TouchableOpacity>
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>Quiet Hours</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Silence scheduled reminders</Text>
              <Text style={styles.rowDetail}>{quietHours.start} to {quietHours.end}</Text>
            </View>
            <Switch
              value={quietHours.enabled}
              onValueChange={(value) => {
                setQuietHours({ enabled: value });
                syncSettings();
              }}
              thumbColor={quietHours.enabled ? colors.violetLight : colors.textMuted}
              trackColor={{ false: colors.surface3, true: colors.violetBg }}
            />
          </View>
          <View style={styles.timeGrid}>
            <TextInput
              value={quietHours.start}
              onChangeText={(value) => setQuietHours({ start: value })}
              onBlur={syncSettings}
              style={[styles.timeInput, quietHours.enabled && !validTime(quietHours.start) && styles.inputError]}
              placeholder="22:30"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              value={quietHours.end}
              onChangeText={(value) => setQuietHours({ end: value })}
              onBlur={syncSettings}
              style={[styles.timeInput, quietHours.enabled && !validTime(quietHours.end) && styles.inputError]}
              placeholder="06:30"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>AI Model</Text>
          <View style={styles.segment}>
            {(['openai', 'ollama'] as AIModel[]).map((model) => {
              const active = model === 'openai' ? aiModel !== 'ollama' : aiModel === model;
              return (
                <TouchableOpacity
                  key={model}
                  accessibilityRole="button"
                  onPress={() => updateAIModel(model)}
                  style={[styles.segmentButton, active && styles.segmentActive]}>
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{model}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>App Mode</Text>
          <View style={styles.modeGrid}>
            {appModeOptions.map((mode) => {
              const active = appMode === mode.key;
              const palette = colorsForAppMode(mode.key, 'dark');
              return (
                <TouchableOpacity
                  key={mode.key}
                  accessibilityRole="button"
                  onPress={() => updateAppMode(mode.key)}
                  style={[styles.modeButton, active && styles.modeButtonActive]}>
                  <View style={[styles.modeDot, { backgroundColor: palette.background, borderColor: palette.violetLight }]} />
                  <View style={styles.rowText}>
                    <Text style={[styles.modeLabel, active && styles.segmentTextActive]}>{mode.label}</Text>
                    <Text style={styles.modeDetail}>{mode.detail}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>Privacy & Data</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>App lock</Text>
              <Text style={styles.rowDetail}>Require biometric unlock when LifeOS opens</Text>
            </View>
            <Switch
              value={appLockEnabled}
              onValueChange={toggleAppLock}
              thumbColor={appLockEnabled ? colors.violetLight : colors.textMuted}
              trackColor={{ false: colors.surface3, true: colors.violetBg }}
            />
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={showBackup} style={styles.secondaryButton}>
            <Ionicons name="document-text-outline" color={colors.textPrimary} size={18} />
            <Text style={styles.secondaryText}>Export settings JSON</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={logout} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" color={colors.rose} size={18} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </LifeOSCard>
      </ScrollView>

      <Modal visible={backupVisible} animationType="slide" transparent onRequestClose={() => setBackupVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Settings Export</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => setBackupVisible(false)}>
                <Ionicons name="close" color={colors.textPrimary} size={22} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.backupBox}>
              <Text selectable style={styles.backupText}>{backupJson}</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xl },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  eyebrow: { ...typography.labelCaps, color: colors.violetLight },
  title: { ...typography.stats, color: colors.textPrimary, fontSize: 34 },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sectionTitle: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  profileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  profileAvatar: {
    alignItems: 'center',
    backgroundColor: colors.violetBg,
    borderColor: colors.violet,
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  profileAvatarText: {
    color: colors.violetLight,
    fontSize: 20,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  rowDetail: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'none' },
  errorText: { ...typography.labelCaps, color: colors.rose, marginTop: spacing.sm, textTransform: 'none' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  statusPill: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    padding: spacing.sm,
  },
  statusLabel: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'none' },
  statusValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', marginTop: 2, textTransform: 'capitalize' },
  essentialGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  essentialPill: {
    backgroundColor: colors.violetBg,
    borderColor: colors.violet,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  essentialText: { ...typography.labelCaps, color: colors.violetLight, textTransform: 'none' },
  timeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  timeInput: {
    ...typography.body,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    color: colors.textPrimary,
    minWidth: 92,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
  inputError: { borderColor: colors.rose },
  timeGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.violetLight,
    borderRadius: radii.inner,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.md,
    padding: spacing.md,
  },
  primaryText: { ...typography.body, color: colors.background, fontWeight: '800' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.md,
    padding: spacing.md,
  },
  secondaryText: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: colors.roseBg,
    borderColor: colors.rose,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  logoutText: { ...typography.body, color: colors.rose, fontWeight: '800' },
  segment: { backgroundColor: colors.surface2, borderRadius: radii.inner, flexDirection: 'row', padding: 4 },
  segmentButton: { alignItems: 'center', borderRadius: radii.inner, flex: 1, padding: spacing.sm },
  segmentActive: { backgroundColor: colors.violetBg },
  segmentText: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'uppercase' },
  segmentTextActive: { color: colors.violetLight },
  modeGrid: { gap: spacing.xs },
  modeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  modeButtonActive: { backgroundColor: colors.violetBg, borderColor: colors.violetLight },
  modeDot: {
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    width: 28,
  },
  modeLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  modeDetail: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'none' },
  modalOverlay: { backgroundColor: 'rgba(0,0,0,0.58)', flex: 1, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    maxHeight: '76%',
    padding: spacing.lg,
  },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  modalTitle: { ...typography.h1, color: colors.textPrimary },
  backupBox: { backgroundColor: colors.surface2, borderRadius: radii.inner, padding: spacing.md },
  backupText: { ...typography.labelCaps, color: colors.textSecondary, fontFamily: 'SpaceMono', textTransform: 'none' },
  });
}
