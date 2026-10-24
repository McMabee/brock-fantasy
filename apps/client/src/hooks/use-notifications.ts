import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { useSession } from '@/providers/session-provider';
import { useActivePoll, useAppActive } from '@/hooks/use-active-poll';

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}
interface NotificationStore {
  notifications: readonly AppNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  markRead: (id: string) => Promise<void>;
}
export const NotificationsContext = createContext<NotificationStore | null>(null);
export function useNotifications(): NotificationStore {
  const value = use(NotificationsContext);
  if (!value) throw new Error('NotificationsProvider is required.');
  return value;
}
export function useNotificationStore(): NotificationStore {
  const { user, readScope } = useSession();
  const active = useAppActive();
  const owner = user?.id ?? null;
  const latestScope = useRef(readScope);
  latestScope.current = readScope;
  const [state, setState] = useState<{
    owner: object | null;
    rows: AppNotification[];
    unread: number;
    loading: boolean;
    error: string | null;
  }>({
    owner: null,
    rows: [],
    unread: 0,
    loading: true,
    error: null,
  });
  const pending = useRef<Promise<void> | null>(null);
  const load = useCallback(() => {
    if (pending.current) return pending.current;
    const promise = (async () => {
      if (!supabase || !owner) {
        setState({ owner: readScope, rows: [], unread: 0, loading: false, error: null });
        return;
      }
      try {
        const result = await supabase.rpc('get_notification_snapshot', { p_limit: 100 });
        if (latestScope.current !== readScope) return;
        if (result.error) {
          setState((s) => ({
            ...s,
            ...([401, 403].includes(result.status) ? { rows: [], unread: 0 } : {}),
            loading: false,
            error: 'Notifications are reconnecting…',
          }));
          return;
        }
        const snapshot = result.data as { notifications: NotificationRow[]; unreadCount: number };
        if (
          !Array.isArray(snapshot?.notifications) ||
          !Number.isSafeInteger(snapshot.unreadCount) ||
          snapshot.unreadCount < 0
        )
          throw new Error('Invalid notification snapshot');
        const next = {
          owner: readScope,
          rows: snapshot.notifications.map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            body: r.body,
            data: r.data ?? {},
            readAt: r.read_at,
            createdAt: r.created_at,
          })),
          unread: snapshot.unreadCount,
          loading: false,
          error: null,
        };
        setState((current) =>
          current.owner === next.owner &&
          current.unread === next.unread &&
          !current.loading &&
          !current.error &&
          JSON.stringify(current.rows) === JSON.stringify(next.rows)
            ? current
            : next,
        );
      } catch {
        if (latestScope.current === readScope)
          setState((s) => ({ ...s, loading: false, error: 'Notifications are reconnecting…' }));
      }
    })();
    pending.current = promise;
    void promise.finally(() => {
      if (pending.current === promise) pending.current = null;
    });
    return promise;
  }, [owner, readScope]);
  useEffect(() => {
    pending.current = null;
    setState({ owner: readScope, rows: [], unread: 0, loading: Boolean(owner), error: null });
  }, [owner, readScope]);
  useActivePoll(load, active && Boolean(owner), 5000);
  const markRead = useCallback(
    async (id: string) => {
      const result = await betaCommand('mark_notification_read', {
        p_notification_id: id,
        p_idempotency_key: 'notification-read-' + id,
      });
      if (latestScope.current !== readScope) return;
      if (result.error) setState((s) => ({ ...s, error: result.error }));
      else await load();
    },
    [load, readScope],
  );
  return useMemo(
    () => ({
      notifications: state.owner === readScope ? state.rows : [],
      unreadCount: state.owner === readScope ? state.unread : 0,
      loading: state.owner !== readScope || state.loading,
      error: state.owner === readScope ? state.error : null,
      markRead,
    }),
    [markRead, readScope, state],
  );
}
