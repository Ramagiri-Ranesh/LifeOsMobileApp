import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing, typography, useLifeOSColors, type ColorPalette } from '@/lib/design';
import { supabase } from '@/lib/supabase';
import { useUserStore } from '@/stores/useUserStore';
import type { Json } from '@/types/database';

type LooseRow = Record<string, Json | undefined>;

type HistorySession = {
  id: string;
  name: string;
  completedAt: string;
  durationMinutes: number;
  volumeKg: number;
  setsDone: number;
  muscleGroup: string;
};

function asText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sessionFromRow(row: LooseRow, index: number): HistorySession {
  const muscleGroups = Array.isArray(row.muscle_groups)
    ? row.muscle_groups.filter((item): item is string => typeof item === 'string').join(', ')
    : '';

  return {
    id: String(row.id ?? `session-${index}`),
    name: asText(row.template_name) || asText(row.name, 'Workout'),
    completedAt: asText(row.completed_at) || asText(row.started_at) || asText(row.created_at),
    durationMinutes: asNumber(row.duration_minutes),
    volumeKg: asNumber(row.total_volume_kg),
    setsDone: asNumber(row.total_sets) || asNumber(row.sets_done),
    muscleGroup: muscleGroups || asText(row.muscle_group, 'Mixed'),
  };
}

function formatDate(value: string) {
  if (!value) return 'Recent session';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recent session';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export default function WorkoutHistoryScreen() {
  const insets = useSafeAreaInsets();
  const colors = useLifeOSColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const currentUserId = useUserStore((state) => state.currentUserId);
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!currentUserId) {
      setSessions([]);
      return;
    }

    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('workout_sessions')
        .select('*')
        .eq('user_id', currentUserId)
        .order('completed_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setSessions(((data ?? []) as LooseRow[]).map(sessionFromRow));
    } catch (error) {
      console.warn('Unable to load workout history', error);
      setSessions([]);
    } finally {
      setRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return (
    <View style={styles.screen}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadSessions} tintColor={colors.amberLight} />}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}
        ListHeaderComponent={
          <View style={styles.header}>
            <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.headerCopy}>
              <Text style={styles.label}>Gym</Text>
              <Text style={styles.title}>Workout History</Text>
            </View>
            <View style={styles.iconButton} />
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View>
                <Text style={styles.sessionName}>{item.name}</Text>
                <Text style={styles.sessionDate}>{formatDate(item.completedAt)}</Text>
              </View>
              <Text style={styles.musclePill}>{item.muscleGroup}</Text>
            </View>
            <View style={styles.statRow}>
              <HistoryStat label="Duration" value={`${item.durationMinutes || 0}m`} styles={styles} />
              <HistoryStat label="Volume" value={`${Math.round(item.volumeKg || 0).toLocaleString()}kg`} styles={styles} />
              <HistoryStat label="Sets" value={`${item.setsDone || 0}`} styles={styles} />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="barbell-outline" size={26} color={colors.amberLight} />
            <Text style={styles.emptyTitle}>No saved workouts yet</Text>
            <Text style={styles.emptyText}>Complete a gym session and it will appear here.</Text>
          </View>
        }
      />
    </View>
  );
}

function HistoryStat({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
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
  },
  iconButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  headerCopy: {
    flex: 1,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  title: {
    color: colors.amber,
    fontSize: 24,
    fontWeight: '900',
  },
  card: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  cardTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  sessionName: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  sessionDate: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
  },
  musclePill: {
    backgroundColor: colors.amberBg,
    borderColor: colors.amber,
    borderRadius: radii.pill,
    borderWidth: 1,
    color: colors.amberLight,
    fontSize: 11,
    fontWeight: '900',
    maxWidth: 140,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: 5,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  stat: {
    backgroundColor: colors.surface2,
    borderRadius: radii.inner,
    flex: 1,
    padding: spacing.xs,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: colors.borderLight,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 6,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  });
}
