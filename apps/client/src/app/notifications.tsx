import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppShell, Card, EmptyState, LoadingState, Pill } from '@/components/ui';

import { useNotifications } from '@/hooks/use-notifications';
import { useRequireUser } from '@/hooks/use-route-access';
import { notificationTarget } from '@/lib/notification-target';

type Category = 'all' | 'trade' | 'game' | 'draft';
export default function NotificationsScreen() {
  const styles = useThemedStyles(createStyles);
  useRequireUser();
  const router = useRouter();
  const { notifications, unreadCount, loading, error, markRead } = useNotifications();
  const [category, setCategory] = useState<Category>('all');
  const filtered = notifications.filter((n) => category === 'all' || n.kind.startsWith(category));
  return (
    <AppShell
      eyebrow="Updates"
      title="Notification center"
      action={<Pill label={unreadCount + ' UNREAD'} tone="info" />}
    >
      <View style={styles.filters}>
        {(['all', 'trade', 'game', 'draft'] as Category[]).map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityState={{ selected: category === c }}
            onPress={() => setCategory(c)}
            style={[styles.filter, category === c ? styles.active : null]}
          >
            <Text style={styles.title}>
              {c === 'all'
                ? 'All updates'
                : c === 'trade'
                  ? 'Trades'
                  : c === 'game'
                    ? 'Games'
                    : 'Drafts'}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {loading && !notifications.length ? (
        <LoadingState label="Loading notifications" />
      ) : !loading && !filtered.length ? (
        <EmptyState
          title="No notifications"
          body="Trade requests, roster game reminders, and draft updates will appear here."
        />
      ) : null}
      {filtered.length ? (
        <Card>
          {filtered.map((n) => (
            <View key={n.id} style={styles.row}>
              <View style={[styles.dot, n.readAt ? styles.read : null]} />
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={'Open ' + n.title}
                onPress={() => {
                  void markRead(n.id);
                  router.push(notificationTarget(n.kind, n.data));
                }}
                style={{ flex: 1, gap: 5 }}
              >
                <Text style={styles.title}>{n.title}</Text>
                <Text style={styles.body}>{n.body}</Text>
                {n.data.obsolete !== true &&
                typeof (n.data.starts_at ?? n.data.scheduled_for) === 'string' ? (
                  <Text style={styles.body}>
                    {new Date(String(n.data.starts_at ?? n.data.scheduled_for)).toLocaleString(
                      'en-CA',
                      { timeZone: 'America/Toronto' },
                    )}{' '}
                    · Toronto time
                  </Text>
                ) : null}
                <Text style={styles.time}>
                  {new Date(n.createdAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}
                </Text>
              </Pressable>
              {!n.readAt ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'Mark ' + n.title + ' as read'}
                  onPress={() => void markRead(n.id)}
                >
                  <Text style={styles.mark}>Mark read</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
    </AppShell>
  );
}
const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
    filter: {
      minHeight: 44,
      padding: 12,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    active: { borderColor: colors.link, borderWidth: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.red },
    read: { backgroundColor: colors.border },
    title: { fontFamily: 'Inter', color: colors.text, fontWeight: '800', fontSize: 14 },
    body: { fontFamily: 'Inter', color: colors.muted, fontSize: 12, lineHeight: 18 },
    time: { fontFamily: 'Inter', color: colors.muted, fontSize: 11 },
    mark: { color: colors.link, fontWeight: '700' },
    error: { color: colors.danger },
  });
