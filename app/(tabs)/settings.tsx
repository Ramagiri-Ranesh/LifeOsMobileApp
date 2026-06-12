import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useState } from 'react';
import {
  Alert,
  Modal,
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
import { colors, radii, spacing, typography } from '@/lib/design';
import { type AIModel, type NotificationType, useSettingsStore } from '@/stores/useSettingsStore';

const NOTIFICATION_ROWS: { key: NotificationType; title: string; detail: string }[] = [
  { key: 'morning', title: 'Morning brief', detail: '7 AM Daily Hub prompt with AI insight' },
  { key: 'lunch', title: 'Lunch calories', detail: 'Midday remaining-calorie reminder' },
  { key: 'workout', title: 'Workout reminder', detail: 'Gym-day reminder based on split' },
  { key: 'evening', title: 'Evening review', detail: 'Reflection modal reminder' },
  { key: 'weekly', title: 'Weekly summary', detail: 'Sunday 8 PM goal review' },
  { key: 'aiAlerts', title: 'AI anomaly alerts', detail: 'Background nutrition, gym, and habit checks' },
];

const TIME_ROWS = [
  { key: 'morning', label: 'Morning' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'workout', label: 'Workout' },
  { key: 'evening', label: 'Evening' },
  { key: 'weekly', label: 'Weekly' },
] as const;

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const notifications = useSettingsStore((state) => state.notifications);
  const quietHours = useSettingsStore((state) => state.quietHours);
  const notificationTimes = useSettingsStore((state) => state.notificationTimes);
  const aiModel = useSettingsStore((state) => state.aiModel);
  const appLockEnabled = useSettingsStore((state) => state.appLockEnabled);
  const setNotificationEnabled = useSettingsStore((state) => state.setNotificationEnabled);
  const setQuietHours = useSettingsStore((state) => state.setQuietHours);
  const setNotificationTime = useSettingsStore((state) => state.setNotificationTime);
  const setAIModel = useSettingsStore((state) => state.setAIModel);
  const setAppLockEnabled = useSettingsStore((state) => state.setAppLockEnabled);

  const [backupVisible, setBackupVisible] = useState(false);
  const [backupJson, setBackupJson] = useState('');
  const [saving, setSaving] = useState(false);

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

    setSaving(true);
    try {
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
          <Text style={styles.sectionTitle}>Notifications</Text>
          {NOTIFICATION_ROWS.map((row) => (
            <View key={row.key} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowDetail}>{row.detail}</Text>
              </View>
              <Switch
                value={notifications[row.key]}
                onValueChange={(value) => setNotificationEnabled(row.key, value)}
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
              onValueChange={(value) => setQuietHours({ enabled: value })}
              thumbColor={quietHours.enabled ? colors.violetLight : colors.textMuted}
              trackColor={{ false: colors.surface3, true: colors.violetBg }}
            />
          </View>
          <View style={styles.timeGrid}>
            <TextInput
              value={quietHours.start}
              onChangeText={(value) => setQuietHours({ start: value })}
              style={styles.timeInput}
              placeholder="22:30"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              value={quietHours.end}
              onChangeText={(value) => setQuietHours({ end: value })}
              style={styles.timeInput}
              placeholder="06:30"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>AI Model</Text>
          <View style={styles.segment}>
            {(['gemini', 'ollama'] as AIModel[]).map((model) => {
              const active = aiModel === model;
              return (
                <TouchableOpacity
                  key={model}
                  accessibilityRole="button"
                  onPress={() => setAIModel(model)}
                  style={[styles.segmentButton, active && styles.segmentActive]}>
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{model}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </LifeOSCard>

        <LifeOSCard>
          <Text style={styles.sectionTitle}>Privacy & Backup</Text>
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
            <Text style={styles.secondaryText}>Backup settings JSON</Text>
          </TouchableOpacity>
        </LifeOSCard>
      </ScrollView>

      <Modal visible={backupVisible} animationType="slide" transparent onRequestClose={() => setBackupVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Settings Backup</Text>
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

const styles = StyleSheet.create({
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
  segment: { backgroundColor: colors.surface2, borderRadius: radii.inner, flexDirection: 'row', padding: 4 },
  segmentButton: { alignItems: 'center', borderRadius: radii.inner, flex: 1, padding: spacing.sm },
  segmentActive: { backgroundColor: colors.violetBg },
  segmentText: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'uppercase' },
  segmentTextActive: { color: colors.violetLight },
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
