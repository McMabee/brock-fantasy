import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from './theme-provider';
import { useSession } from './session-provider';
import { useNotifications } from '@/hooks/use-notifications';
import { useResponsiveDimensions } from '@/hooks/use-responsive-dimensions';
import { ViewportPortal } from '@/components/viewport-portal';
import { Platform } from 'react-native';
import { notificationTarget } from '@/lib/notification-target';

export interface ActionFeedback {
  title: string;
  body?: string;
  tone?: 'success' | 'error' | 'info';
  action?: { label: string; onPress: () => void };
  eventKey?: string;
}
interface Toast extends ActionFeedback {
  id: number;
}
const Context = createContext<((message: ActionFeedback) => void) | null>(null);
export function useActionFeedback() {
  const show = use(Context);
  if (!show) throw new Error('ActionFeedbackProvider is required');
  return show;
}
export function ActionFeedbackProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const owner = user?.id ?? null;
  const [state, setState] = useState<{ owner: string | null; rows: Toast[] }>({ owner, rows: [] });
  const sequence = useRef(0);
  const latestOwner = useRef(owner);
  latestOwner.current = owner;
  const shown = useRef<{ owner: string | null; keys: Set<string> }>({ owner, keys: new Set() });
  const show = useCallback(
    (message: ActionFeedback) => {
      if (latestOwner.current !== owner) return;
      if (shown.current.owner !== owner) shown.current = { owner, keys: new Set() };
      if (message.eventKey && shown.current.keys.has(message.eventKey)) return;
      if (message.eventKey) shown.current.keys.add(message.eventKey);
      // - Bound session deduplication memory while retaining recent event identities
      if (shown.current.keys.size > 500)
        shown.current.keys.delete(shown.current.keys.values().next().value!);
      const row = { ...message, id: ++sequence.current };
      setState((current) => ({
        owner,
        rows: [...(current.owner === owner ? current.rows : []), row].slice(-3),
      }));
    },
    [owner],
  );
  const dismiss = useCallback(
    (id: number) =>
      setState((current) => ({ ...current, rows: current.rows.filter((row) => row.id !== id) })),
    [],
  );
  const { width } = useResponsiveDimensions();
  return (
    <Context value={show}>
      {children}
      <NotificationEvents />
      <ViewportPortal>
        <View
          pointerEvents="box-none"
          style={{
            position: Platform.OS === 'web' ? ('fixed' as 'absolute') : 'absolute',
            top: width >= 1024 ? 20 : 88,
            right: 16,
            width: Math.min(390, width - 32),
            gap: 10,
            zIndex: 20000,
          }}
        >
          {state.owner === owner
            ? state.rows.map((row) => <ToastBanner key={row.id} row={row} dismiss={dismiss} />)
            : null}
        </View>
      </ViewportPortal>
    </Context>
  );
}
function ToastBanner({ row, dismiss }: { row: Toast; dismiss: (id: number) => void }) {
  const colors = useThemeColors();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const remaining = useRef(6000);
  useEffect(() => {
    if (row.tone === 'error' || hover || focus) return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss(row.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [dismiss, focus, hover, row.id, row.tone]);
  return (
    <Pressable
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      accessible={false}
      style={{
        borderWidth: 2,
        borderColor: row.tone === 'error' ? colors.danger : colors.border,
        borderRadius: 14,
        padding: 16,
        backgroundColor: colors.canvasSoft,
        gap: 8,
        boxShadow: '0 6px 24px #0003',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          accessibilityRole={row.tone === 'error' ? 'alert' : undefined}
          accessibilityLiveRegion={row.tone === 'error' ? 'assertive' : 'polite'}
          style={{ color: colors.text, fontFamily: 'Inter', fontWeight: '700', flex: 1 }}
        >
          {row.tone === 'success' ? '✓ ' : row.tone === 'error' ? '! ' : '● '}
          {row.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={() => dismiss(row.id)}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: colors.text }}>✕</Text>
        </Pressable>
      </View>
      {row.body ? (
        <Text style={{ color: colors.text, fontFamily: 'Inter', lineHeight: 22 }}>{row.body}</Text>
      ) : null}
      {row.action ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            row.action?.onPress();
            dismiss(row.id);
          }}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text
            style={{
              color: colors.text,
              fontFamily: 'Inter',
              fontWeight: '700',
              textDecorationLine: 'underline',
            }}
          >
            {row.action.label}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
function NotificationEvents() {
  const { user } = useSession();
  const { notifications, loading, error, markRead } = useNotifications();
  const show = useActionFeedback();
  const router = useRouter();
  const seen = useRef<{ owner: string | null; ready: boolean; ids: Set<string> }>({
    owner: null,
    ready: false,
    ids: new Set(),
  });
  useEffect(() => {
    const owner = user?.id ?? null;
    if (seen.current.owner !== owner) seen.current = { owner, ready: false, ids: new Set() };
    if (!owner || loading || error) return;
    const fresh = seen.current.ready
      ? notifications.filter((row) => !seen.current.ids.has(row.id))
      : [];
    seen.current = { owner, ready: true, ids: new Set(notifications.map((row) => row.id)) };
    for (const row of [...fresh].reverse()) {
      if (row.readAt || row.data.obsolete === true || row.kind.startsWith('chat')) continue;
      show({
        title: row.title,
        body: row.body,
        eventKey: row.kind.startsWith('trade_')
          ? `trade:${String(row.data.trade_id)}:${row.kind.slice(6)}`
          : row.id,
        action: {
          label: 'View',
          onPress: () => {
            void markRead(row.id);
            router.push(notificationTarget(row.kind, row.data));
          },
        },
      });
    }
  }, [error, loading, markRead, notifications, router, show, user?.id]);
  return null;
}
