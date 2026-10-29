import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActivePoll, useScreenActive } from '@/hooks/use-active-poll';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

// - Keep requests scoped to both the signed-in identity and the selected resource
export function useAdminLeagueRead<T>(
  rpc: string,
  args: Record<string, unknown>,
  enabled: boolean,
  interval = 60_000,
  onAccessLost?: () => void,
) {
  const { user, readScope } = useSession();
  const active = useScreenActive();
  const key = JSON.stringify(args);
  const identity = useMemo(
    () => ({ rpc, key, readScope, enabled, userId: user?.id }),
    [rpc, key, readScope, enabled, user?.id],
  );
  const latest = useRef(identity);
  latest.current = identity;
  const accessLost = useRef(onAccessLost);
  accessLost.current = onAccessLost;
  const pending = useRef<{ identity: typeof identity; request: Promise<void> } | null>(null);
  const denied = useRef<typeof identity | null>(null);
  const [state, setState] = useState<{
    identity: typeof identity;
    data: T | null;
    loading: boolean;
    error: string | null;
    updatedAt: string | null;
  }>({ identity, data: null, loading: true, error: null, updatedAt: null });
  const refresh = useCallback((): Promise<void> => {
    const selected = identity;
    if (!selected.enabled || !selected.userId || !supabase || denied.current === selected)
      return Promise.resolve();
    if (pending.current?.identity === selected) return pending.current.request;
    const request = (async () => {
      setState((current) => ({
        identity: selected,
        data: current.identity === selected ? current.data : null,
        updatedAt: current.identity === selected ? current.updatedAt : null,
        loading: true,
        error: null,
      }));
      try {
        const result = await supabase.rpc(
          selected.rpc,
          JSON.parse(selected.key) as Record<string, unknown>,
        );
        if (latest.current !== selected) return;
        if (result.error) {
          if (
            ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(result.error.code) ||
            result.status === 401 ||
            result.status === 403
          ) {
            denied.current = selected;
            accessLost.current?.();
            setState({
              identity: selected,
              data: null,
              updatedAt: null,
              loading: false,
              error: 'Administrator access is no longer available. Sign in and verify MFA again.',
            });
          } else
            setState((current) => ({
              ...current,
              loading: false,
              error:
                result.error.code === 'PGRST202'
                  ? 'Admin data is temporarily unavailable while a service update is completed. Please try again shortly.'
                  : 'Unable to load this view. Please retry.',
            }));
          return;
        }
        setState({
          identity: selected,
          data: result.data as T,
          loading: false,
          error: null,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        if (latest.current === selected)
          setState((current) => ({
            ...current,
            loading: false,
            error: 'Unable to load this view. Please retry.',
          }));
      } finally {
        if (pending.current?.identity === selected) pending.current = null;
      }
    })();
    pending.current = { identity: selected, request };
    return request;
  }, [identity]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useActivePoll(refresh, active && enabled && Boolean(user), interval);
  const current = enabled && Boolean(user) && state.identity === identity;
  return {
    data: current ? state.data : null,
    loading: enabled && (!current || state.loading),
    error: current ? state.error : null,
    updatedAt: current ? state.updatedAt : null,
    refresh,
  };
}
