import { useCallback, useEffect, useMemo, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

const demoNotifications: readonly AppNotification[] = [
  {
    id: 'demo-draft',
    kind: 'DRAFT',
    title: 'You are on the clock',
    body: 'Badger Ice League · Pick 17',
    readAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-score',
    kind: 'SCORE',
    title: 'Your matchup is live',
    body: 'Power Playmakers lead 78.5–74.0',
    readAt: null,
    createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  },
  {
    id: 'demo-trade',
    kind: 'TRADE',
    title: 'Trade proposal received',
    body: 'Niagara Knights sent you an offer',
    readAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

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
  const { demoMode, user } = useSession();
  const [notifications, setNotifications] = useState<readonly AppNotification[]>(
    demoMode ? demoNotifications : [],
  );
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demoMode || !supabase || !user) return;
    const result = await supabase
      .from('notifications')
      .select('id, kind, title, body, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (result.error) setError(result.error.message);
    else setNotifications((result.data as NotificationRow[]).map(mapRow));
    setLoading(false);
  }, [demoMode, user]);

  useEffect(() => {
    void load();
    if (demoMode || !supabase || !user) return;
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
  }, [demoMode, load, user]);

  const markRead = useCallback(
    async (id: string) => {
      if (demoMode) {
        setNotifications((current) =>
          current.map((item) =>
            item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
          ),
        );
        return;
      }
      if (!supabase) return;
      const result = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
      if (result.error) setError(result.error.message);
      else await load();
    },
    [demoMode, load],
  );

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications],
  );
  return { notifications, unreadCount, loading, error, markRead };
}
