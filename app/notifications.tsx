import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LifeOSCard } from '@/components/ui/LifeOSCard';
import {
  loadAppNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/notifications';
import { colors, domains, radii, spacing, typography } from '@/lib/design';
import { useUserStore } from '@/stores/useUserStore';

const KIND_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  task_reminder: { icon: 'checkbox-outline', color: domains.goals.color, label: 'Task' },
  daily_brief: { icon: 'sunny-outline', color: colors.violetLight, label: 'Brief' },
  nutrition_reminder: { icon: 'restaurant-outline', color: domains.nutrition.color, label: 'Diet' },
  workout_reminder: { icon: 'barbell-outline', color: domains.fitness.color, label: 'Gym' },
  evening_review: { icon: 'moon-outline', color: colors.indigo, label: 'Review' },
  weekly_summary: { icon: 'analytics-outline', color: colors.blueLight, label: 'Weekly' },
  ai_alert: { icon: 'sparkles-outline', color: colors.amberLight, label: 'AI' },
  system: { icon: 'notifications-outline', color: colors.violetLight, label: 'LifeOS' },
};

function formatWhen(value?: string) {
  if (!value) return 'Scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Scheduled';

  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(date);
  if (isToday) return `Today, ${time}`;

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function metaFor(notification: AppNotification) {
  return KIND_META[notification.kind] ?? KIND_META.system;
}

function needsAttention(notification: AppNotification) {
  if (notification.read_at) return false;
  if (notification.delivery_status === 'delivered') return true;
  if (!notification.scheduled_at) return true;
  return new Date(notification.scheduled_at).getTime() <= Date.now();
}

export default function NotificationsScreen() {
  const currentUserId = useUserStore((state) => state.currentUserId);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const unreadCount = useMemo(() => notifications.filter(needsAttention).length, [notifications]);

  const loadNotifications = useCallback(async () => {
    if (!currentUserId) return;
    setRefreshing(true);
    try {
      setNotifications(await loadAppNotifications(currentUserId));
    } finally {
      setRefreshing(false);
    }
  }, [currentUserId]);

  useFocusEffect(
    useCallback(() => {
      void loadNotifications();
    }, [loadNotifications]),
  );

  const markAllRead = async () => {
    if (!currentUserId) return;
    await markAllNotificationsRead(currentUserId);
    setNotifications((current) =>
      current.map((item) => (needsAttention(item) ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item)),
    );
  };

  const openNotification = async (notification: AppNotification) => {
    if (needsAttention(notification)) {
      await markNotificationRead(notification.id);
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item)),
      );
    }

    if (notification.route) {
      router.push(notification.route as never);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadNotifications} tintColor={colors.violetLight} />}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Inbox</Text>
            <Text style={styles.title}>Notifications</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" disabled={unreadCount === 0} onPress={markAllRead} style={styles.iconButton}>
            <Ionicons name="checkmark-done-outline" size={21} color={unreadCount > 0 ? colors.violetLight : colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{notifications.length}</Text>
            <Text style={styles.summaryLabel}>total</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryValue}>{unreadCount}</Text>
            <Text style={styles.summaryLabel}>unread</Text>
          </View>
        </View>

        {notifications.length === 0 ? (
          <LifeOSCard style={styles.emptyCard}>
            <Ionicons name="notifications-off-outline" color={colors.textMuted} size={28} />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyText}>Task reminders, Daily Hub prompts, workout nudges, and AI alerts will appear here.</Text>
          </LifeOSCard>
        ) : (
          notifications.map((notification) => {
            const meta = metaFor(notification);
            const unread = needsAttention(notification);
            return (
              <TouchableOpacity
                key={notification.id}
                accessibilityRole="button"
                activeOpacity={0.84}
                onPress={() => void openNotification(notification)}
                style={[styles.notificationCard, unread && styles.notificationUnread]}>
                <View style={[styles.kindIcon, { borderColor: meta.color }]}>
                  <Ionicons name={meta.icon} color={meta.color} size={18} />
                </View>
                <View style={styles.notificationBody}>
                  <View style={styles.notificationTop}>
                    <Text style={styles.kindLabel}>{meta.label}</Text>
                    <Text style={styles.whenText}>{formatWhen(notification.delivered_at ?? notification.scheduled_at ?? notification.created_at)}</Text>
                  </View>
                  <Text style={styles.notificationTitle}>{notification.title}</Text>
                  <Text style={styles.notificationText}>{notification.body}</Text>
                </View>
                {unread ? <View style={styles.unreadDot} /> : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.xl },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  headerCopy: { flex: 1 },
  eyebrow: { ...typography.labelCaps, color: colors.violetLight },
  title: { ...typography.stats, color: colors.textPrimary, fontSize: 32, lineHeight: 38 },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  summaryRow: { flexDirection: 'row', gap: spacing.xs },
  summaryPill: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flex: 1,
    padding: spacing.sm,
  },
  summaryValue: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  summaryLabel: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'none' },
  emptyCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  emptyTitle: { ...typography.h1, color: colors.textPrimary },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  notificationCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
    position: 'relative',
  },
  notificationUnread: { borderColor: colors.violetLight },
  kindIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: 16,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  notificationBody: { flex: 1, gap: 4 },
  notificationTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  kindLabel: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'uppercase' },
  whenText: { ...typography.labelCaps, color: colors.textMuted, textTransform: 'none' },
  notificationTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  notificationText: { ...typography.body, color: colors.textSecondary },
  unreadDot: {
    backgroundColor: colors.violetLight,
    borderRadius: 5,
    height: 10,
    position: 'absolute',
    right: 10,
    top: 10,
    width: 10,
  },
});
