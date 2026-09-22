import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppShell, Card, EmptyState, Pill, SectionTitle } from '@/components/ui';
import { useThemedStyles, type ThemeColors } from '@/theme';
import { useNotifications } from '@/hooks/use-notifications';
import { useRequireUser } from '@/hooks/use-route-access';
import { notificationHref } from '@/lib/notification-route';

export default function NotificationsScreen() {
  useRequireUser();
  const router = useRouter();
  const styles = useStyles();
  const { notifications, unreadCount, loading, error, markRead } = useNotifications();
  return (
    <AppShell
      eyebrow="Updates"
      title="Notifications"
      action={<Pill label={`${unreadCount} UNREAD`} tone="info" />}
    >
      <SectionTitle title="Inbox" detail="Push delivery is enabled in mobile builds" />
      {error ? <EmptyState title="Inbox unavailable" body={error} /> : null}
      {!error && !loading && notifications.length === 0 ? (
        <EmptyState
          title="No notifications"
          body="Draft, transaction, and scoring updates will appear here."
        />
      ) : null}
      {notifications.length > 0 ? (
        <Card style={styles.card}>
          {notifications.map((notification) => {
            const href = notificationHref(notification.data);
            return (
              <Pressable
                accessibilityRole={href ? 'link' : 'button'}
                accessibilityLabel={
                  href ? `Open ${notification.title}` : `Mark ${notification.title} as read`
                }
                disabled={!href && Boolean(notification.readAt)}
                key={notification.id}
                onPress={() => {
                  if (!notification.readAt) void markRead(notification.id);
                  if (href) router.push(href);
                }}
                style={styles.row}
              >
                <View style={[styles.dot, notification.readAt && styles.dotRead]} />
                <View style={styles.copy}>
                  <Text style={styles.kind}>{notification.kind}</Text>
                  <Text style={styles.title}>{notification.title}</Text>
                  <Text style={styles.body}>{notification.body}</Text>
                </View>
                <Text style={styles.time}>{formatRelativeTime(notification.createdAt)}</Text>
              </Pressable>
            );
          })}
        </Card>
      ) : null}
    </AppShell>
  );
}

function formatRelativeTime(value: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (elapsedMinutes < 1) return 'Now';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  if (elapsedMinutes < 1_440) return `${Math.floor(elapsedMinutes / 60)} hr`;
  return `${Math.floor(elapsedMinutes / 1_440)} d`;
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: { maxWidth: 760 },
    row: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
    dotRead: { backgroundColor: colors.border },
    copy: { flex: 1 },
    kind: { color: colors.brand, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
    title: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 3 },
    body: { color: colors.muted, fontSize: 11, marginTop: 3 },
    time: { color: colors.muted, fontSize: 9 },
  });

const useStyles = () => useThemedStyles(createStyles);
