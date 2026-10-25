import { newCommandKey } from '../lib/command-key';
import { useCallback, useEffect, useRef, useState } from 'react';
import { betaCommand } from '@/lib/web-api';

export function useDraftQueue(
  draftId: string | undefined,
  serverIds: readonly string[],
  availableIds: ReadonlySet<string>,
  enabled: boolean,
) {
  const [ids, setIds] = useState<readonly string[]>(serverIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desired = useRef(ids);
  const dirty = useRef(false);
  const paused = useRef(false);
  const busy = useRef(false);
  const latestAvailable = useRef(availableIds);
  const enabledRef = useRef(enabled);
  const active = useRef(true);
  const generation = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempt = useRef<{ ids: readonly string[]; key: string } | null>(null);
  latestAvailable.current = availableIds;
  enabledRef.current = enabled;
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const flush = useCallback(async () => {
    if (
      !enabledRef.current ||
      !draftId ||
      busy.current ||
      !dirty.current ||
      paused.current ||
      !active.current
    )
      return;
    busy.current = true;
    setSaving(true);
    const currentGeneration = generation.current;
    attempt.current ??= {
      ids: desired.current.filter((id) => latestAvailable.current.has(id)),
      key: newCommandKey(),
    };
    const sent = attempt.current;
    const result = await betaCommand<{ queue?: string[] }>('set_draft_queue', {
      p_draft_id: draftId,
      p_athlete_ids: sent.ids,
      p_idempotency_key: sent.key,
    }).catch(() => ({ data: null, error: 'Queue save interrupted. Retrying…', status: 503 }));
    if (!active.current || generation.current !== currentGeneration) return;
    busy.current = false;
    setSaving(false);
    if (result.error) {
      setError(result.error);
      if (!result.status || result.status >= 500 || result.status === 429)
        retry.current = setTimeout(() => void flushRef.current(), 2000);
      else {
        attempt.current = null;
        paused.current = true;
      }
      return;
    }
    const changed = desired.current.join(',') !== sent.ids.join(',');
    attempt.current = null;
    desired.current = (changed ? desired.current : (result.data?.queue ?? sent.ids)).filter((id) =>
      latestAvailable.current.has(id),
    );
    dirty.current = changed;
    setIds(desired.current);
    setError(null);
    if (dirty.current) void flushRef.current();
  }, [draftId]);
  flushRef.current = flush;
  useEffect(() => {
    generation.current++;
    active.current = true;
    busy.current = false;
    dirty.current = false;
    paused.current = false;
    attempt.current = null;
    desired.current = [];
    setIds([]);
    setSaving(false);
    setError(null);
    return () => {
      active.current = false;
      generation.current++;
      if (retry.current) clearTimeout(retry.current);
    };
  }, [draftId]);
  useEffect(() => {
    const next = (dirty.current || busy.current ? desired.current : serverIds).filter((id) =>
      availableIds.has(id),
    );
    desired.current = next;
    setIds(next);
    if (enabled) void flushRef.current();
  }, [availableIds, enabled, serverIds]);
  const edit = useCallback((update: (current: readonly string[]) => readonly string[]) => {
    desired.current = update(desired.current);
    dirty.current = true;
    paused.current = false;
    setIds(desired.current);
    void flushRef.current();
  }, []);
  return {
    ids,
    saving,
    error,
    toggle: (id: string) =>
      edit((current) =>
        current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
      ),
    remove: (id: string) => edit((current) => current.filter((v) => v !== id)),
    move: (id: string, step: number) =>
      edit((current) => {
        const next = [...current];
        const from = next.indexOf(id);
        const to = from + step;
        if (from >= 0 && to >= 0 && to < next.length)
          [next[from], next[to]] = [next[to]!, next[from]!];
        return next;
      }),
    retry: () => {
      dirty.current = true;
      paused.current = false;
      void flushRef.current();
    },
  };
}
