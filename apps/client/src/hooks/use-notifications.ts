import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { useSession } from '@/providers/session-provider';

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

const mapRow = (row: NotificationRow): AppNotification => ({
  id: row.id,
  kind: row.kind.toUpperCase(),
  title: row.title,
  body: row.body,
  readAt: row.read_at,
  createdAt: row.created_at,
});

export function useNotifications() {
  const { user } = useSession();
  const [notifications, setNotifications] = useState<readonly AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !user) {
      setLoading(false);
      return;
    }
    const result = await supabase
      .from('notifications')
      .select('id, kind, title, body, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (result.error) setError(result.error.message);
    else setNotifications((result.data as NotificationRow[]).map(mapRow));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
    if (!supabase || !user) return;
    if (Platform.OS === 'web') {
      const interval = setInterval(() => void load(), 5_000);
      return () => clearInterval(interval);
    }
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [load, user]);

  const markRead = useCallback(
    async (id: string) => {
      const result =
        Platform.OS === 'web'
          ? await betaCommand('mark_notification_read', {
              p_notification_id: id,
              p_idempotency_key: `notification-read-${id}`,
            })
          : supabase
            ? await supabase
                .from('notifications')
                .update({ read_at: new Date().toISOString() })
                .eq('id', id)
            : { error: { message: 'Supabase is not configured.' } };
      if (result.error) {
        setError(typeof result.error === 'string' ? result.error : result.error.message);
      } else await load();
    },
    [load],
  );

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications],
  );
  return { notifications, unreadCount, loading, error, markRead };
}
