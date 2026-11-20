import {
  createContext,
  use,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useSession } from './session-provider';
import { useActivePoll, useAppActive, useScreenActive } from '@/hooks/use-active-poll';
import { supabase } from '@/lib/supabase';
import { createAvailabilityStore } from '@/lib/athlete-availability';

const AvailabilityContext = createContext<ReturnType<typeof createAvailabilityStore> | null>(null);
export function AthleteAvailabilityProvider({ children }: { children: ReactNode }) {
  const { user, readScope } = useSession();
  const active = useAppActive();
  const store = useMemo(
    () =>
      createAvailabilityStore(async (ids) => {
        const client = supabase;
        if (!client || !user?.id) throw new Error('Sign in to read athlete status');
        // - Bound REST URLs and share each batch across every visible player component
        const chunks: string[][] = [];
        for (let offset = 0; offset < ids.length; offset += 100)
          chunks.push(ids.slice(offset, offset + 100));
        const results = await Promise.all(
          chunks.map(async (chunk) => {
            const result = await client
              .from('athletes')
              .select('id,availability_status,availability_revision,availability_changed_at')
              .in('id', chunk)
              .retry(false)
              .abortSignal(AbortSignal.timeout(8000));
            if (result.error)
              throw [401, 403].includes(result.status)
                ? Object.assign(new Error('Athlete status access denied'), { denied: true })
                : result.error;
            return result.data ?? [];
          }),
        );
        return results.flat();
      }),
    [readScope, user?.id],
  );
  useEffect(() => {
    store.setActive(active && Boolean(user?.id));
  }, [store, active, user?.id]);
  useActivePoll(store.refresh, active && Boolean(user?.id), 10000);
  return <AvailabilityContext value={store}>{children}</AvailabilityContext>;
}

export function useAthleteAvailability(ids: readonly string[] = []) {
  const store = use(AvailabilityContext);
  if (!store) throw new Error('AthleteAvailabilityProvider is required');
  const active = useScreenActive();
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    if (active && key) return store.watch(key.split(','));
  }, [store, active, key]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, refresh: store.refresh };
}
