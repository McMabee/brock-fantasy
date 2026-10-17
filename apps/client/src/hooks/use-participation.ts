import { useCallback, useEffect, useRef, useState } from 'react';
import { parseParticipation, type Participation } from '@brock-fantasy/domain';
import { useSession } from '@/providers/session-provider';
import { supabase } from '@/lib/supabase';

export function useParticipation() {
  const { user } = useSession();
  const [participation, setParticipation] = useState<
    (Participation & { displayName: string; revision: number }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUser = useRef(user?.id);
  currentUser.current = user?.id;
  const reload = useCallback(async () => {
    if (!supabase || !user?.id) {
      setLoading(false);
      return;
    }
    const id = user.id;
    try {
      const result = await supabase.rpc('get_my_participation');
      if (currentUser.current !== id) return;
      const value = result.data as {
        role?: unknown;
        programs?: unknown;
        displayName?: unknown;
        revision?: unknown;
      } | null;
      const parsed = parseParticipation(value?.role, value?.programs);
      setError(
        result.error || !parsed ? 'Account participation is unavailable. Please retry.' : null,
      );
      if (!result.error && parsed)
        setParticipation({
          ...parsed,
          displayName:
            typeof value?.displayName === 'string' ? value.displayName : 'Account holder',
          revision: typeof value?.revision === 'number' ? value.revision : 0,
        });
    } catch {
      if (currentUser.current === id)
        setError('Account participation is unavailable. Please retry.');
    } finally {
      if (currentUser.current === id) setLoading(false);
    }
  }, [user?.id]);
  useEffect(() => {
    setParticipation(null);
    setError(null);
    setLoading(Boolean(user?.id));
    void reload();
  }, [reload, user?.id]);
  return { participation, error, loading, reload };
}
