import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { useSession } from '@/providers/session-provider';

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
  const { user } = useSession();
  const owner = user?.id ?? null;
  const latestOwner = useRef(owner);
  latestOwner.current = owner;
  const [state, setState] = useState<{
    owner: string | null;
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
        setState({ owner, rows: [], unread: 0, loading: false, error: null });
        return;
      }
      try {
        const [result, count] = await Promise.all([
          supabase
            .from('notifications')
            .select('id,kind,title,body,data,read_at,created_at')
            .order('created_at', { ascending: false })
            .limit(100),
          supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .is('read_at', null),
        ]);
        if (latestOwner.current !== owner) return;
        if (result.error || count.error) {
          setState((s) => ({ ...s, loading: false, error: 'Notifications are reconnecting…' }));
          return;
        }
        const next = {
          owner,
          rows: (result.data as NotificationRow[]).map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            body: r.body,
            data: r.data ?? {},
            readAt: r.read_at,
            createdAt: r.created_at,
          })),
          unread: count.count ?? 0,
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
        if (latestOwner.current === owner)
          setState((s) => ({ ...s, loading: false, error: 'Notifications are reconnecting…' }));
      }
    })();
    pending.current = promise;
    void promise.finally(() => {
      if (pending.current === promise) pending.current = null;
    });
    return promise;
  }, [owner]);
  useEffect(() => {
    pending.current = null;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await load();
      if (active) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]);
  const markRead = useCallback(
    async (id: string) => {
      const result = await betaCommand('mark_notification_read', {
        p_notification_id: id,
        p_idempotency_key: 'notification-read-' + id,
      });
      if (result.error) setState((s) => ({ ...s, error: result.error }));
      else await load();
    },
    [load],
  );
  return useMemo(
    () => ({
      notifications: state.owner === owner ? state.rows : [],
      unreadCount: state.owner === owner ? state.unread : 0,
      loading: state.owner !== owner || state.loading,
      error: state.owner === owner ? state.error : null,
      markRead,
    }),
    [markRead, owner, state],
  );
}
