import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton, Card, EmptyState, LoadingState, Pill, useUiStyles } from '@/components/ui';
import { LeagueRefresh } from '@/components/admin-league-ui';
import { useActivePoll, useScreenActive } from '@/hooks/use-active-poll';
import { supabase } from '@/lib/supabase';
import {
  adminDate,
  type AdminLeagueChatPage,
  type AdminLeagueMessage,
  type LeagueCursor,
} from '@/lib/admin-leagues';
import { useSession } from '@/providers/session-provider';

export function AdminLeagueChat({
  leagueId,
  enabled,
  onAccessLost,
}: {
  leagueId: string;
  enabled: boolean;
  onAccessLost: () => void;
}) {
  const ui = useUiStyles();
  const active = useScreenActive();
  const { user, readScope } = useSession();
  const identity = useMemo(
    () => ({ leagueId, enabled, readScope, userId: user?.id }),
    [leagueId, enabled, readScope, user?.id],
  );
  const latest = useRef(identity);
  latest.current = identity;
  const loss = useRef(onAccessLost);
  loss.current = onAccessLost;
  const [state, setState] = useState<{
    identity: typeof identity;
    messages: AdminLeagueMessage[];
    older: LeagueCursor | null;
    hasOlder: boolean;
    loading: boolean;
    error: string | null;
    updatedAt: string | null;
  }>({
    identity,
    messages: [],
    older: null,
    hasOlder: false,
    loading: true,
    error: null,
    updatedAt: null,
  });
  const saved = useRef(state);
  saved.current = state;
  const pending = useRef<{ identity: typeof identity; task: Promise<void> } | null>(null);
  const load = useCallback(
    (mode: 'refresh' | 'older' = 'refresh'): Promise<void> => {
      if (!identity.enabled || !identity.userId || !supabase) return Promise.resolve();
      if (pending.current?.identity === identity) return pending.current.task;
      const task = (async () => {
        const prior = saved.current.identity === identity ? saved.current : null;
        setState({
          identity,
          messages: prior?.messages ?? [],
          older: prior?.older ?? null,
          hasOlder: prior?.hasOlder ?? false,
          updatedAt: prior?.updatedAt ?? null,
          error: null,
          loading: true,
        });
        try {
          const read = async (before: LeagueCursor | null) => {
            const result = await supabase!.rpc('admin_get_league_chat', {
              p_league_id: identity.leagueId,
              p_before_at: before?.at ?? null,
              p_before_id: before?.id ?? null,
            });
            if (result.error) {
              if (
                result.status === 401 ||
                result.status === 403 ||
                result.error.code === '42501' ||
                result.error.code.startsWith('PGRST30')
              ) {
                if (latest.current === identity) loss.current();
                throw new Error('Administrator access is no longer available.');
              }
              throw new Error('Chat is unavailable. Please retry.');
            }
            return result.data as AdminLeagueChatPage;
          };
          let page = await read(mode === 'older' ? (prior?.older ?? null) : null);
          if (latest.current !== identity) return;
          const chunks = [page.items];
          // - Refresh every loaded message and bridge new-message gaps before replacing the snapshot
          const oldest = mode === 'refresh' ? prior?.messages[0] : undefined;
          while (
            oldest &&
            page.hasMore &&
            page.nextCursor &&
            (page.nextCursor.at > oldest.created_at ||
              (page.nextCursor.at === oldest.created_at && page.nextCursor.id > oldest.id))
          ) {
            page = await read(page.nextCursor);
            if (latest.current !== identity) return;
            chunks.push(page.items);
          }
          // - Cursor pages are already ordered so merge and deduplicate in linear time
          const byId = new Map<string, AdminLeagueMessage>();
          for (let index = chunks.length - 1; index >= 0; index--)
            for (const message of chunks[index]!) byId.set(message.id, message);
          if (mode === 'older')
            for (const message of prior?.messages ?? []) byId.set(message.id, message);
          const merged = [...byId.values()];
          setState({
            identity,
            messages: merged,
            older: page.nextCursor,
            hasOlder: page.hasMore,
            loading: false,
            error: null,
            updatedAt: new Date().toISOString(),
          });
        } catch (error) {
          if (latest.current === identity)
            setState((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : 'Chat is unavailable. Please retry.',
            }));
        } finally {
          if (pending.current?.identity === identity) pending.current = null;
        }
      })();
      pending.current = { identity, task };
      return task;
    },
    [identity],
  );
  const refresh = useCallback(() => load(), [load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useActivePoll(refresh, enabled && active, 30_000);
  const current = enabled && user && state.identity === identity;
  if (!current) return enabled ? <LoadingState label="Loading chat" /> : null;
  return (
    <View style={{ gap: 14 }}>
      <LeagueRefresh {...state} refresh={refresh} />
      {state.loading && !state.messages.length ? <LoadingState label="Loading chat" /> : null}
      {state.hasOlder ? (
        <ActionButton
          label="Load older messages"
          variant="secondary"
          loading={state.loading}
          onPress={() => void load('older')}
        />
      ) : null}
      {!state.loading && !state.error && !state.messages.length ? (
        <EmptyState
          title="No retained messages"
          body="League chat messages will appear here when available."
        />
      ) : null}
      {state.messages.map((message) => (
        <Card key={message.id} style={{ gap: 9 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Text style={ui.label}>{message.author}</Text>
            <Text style={ui.body}>{adminDate(message.created_at)}</Text>
            {message.hidden_at ? <Pill label="Hidden by moderation" tone="warning" /> : null}
          </View>
          <Text selectable style={ui.body}>
            {message.body}
          </Text>
          {message.hidden_at ? (
            <Text style={ui.body}>Hidden {adminDate(message.hidden_at)}</Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}
