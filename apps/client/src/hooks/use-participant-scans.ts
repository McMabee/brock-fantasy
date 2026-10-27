import { useCallback, useEffect, useRef, useState } from 'react';
import {
  participantRead,
  type Participant,
  type ParticipantScanSnapshot,
} from '@/lib/participant-scans';

export function useParticipantScans(allowed: boolean) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [snapshot, setSnapshot] = useState<ParticipantScanSnapshot | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!allowed) return;
    const current = ++generation.current;
    setRefreshing(true);
    try {
      const [directory, scan] = await Promise.all([
        participantRead<Participant[]>('admin_list_varsity_participants'),
        participantRead<ParticipantScanSnapshot>('admin_get_participant_scan', {
          p_scan_id: scanId,
        }),
      ]);
      if (current !== generation.current) return;
      setParticipants(directory);
      setSnapshot(scan);
      setError(null);
    } catch {
      if (current === generation.current)
        setError('Shared participant data could not be refreshed. Please retry.');
    } finally {
      if (current === generation.current) setRefreshing(false);
    }
  }, [allowed, scanId]);
  useEffect(() => {
    if (!allowed) {
      setParticipants([]);
      setSnapshot(null);
      return;
    }
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void refresh();
    };
    tick();
    const timer = setInterval(tick, 15000);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', tick);
    return () => {
      generation.current++;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', tick);
    };
  }, [allowed, refresh]);
  return { participants, snapshot, scanId, setScanId, error, refreshing, refresh };
}
