import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

export interface SyncHealthRow {
  id: string;
  provider: string;
  status: string;
  finishedAt: string | null;
  changed: number;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

interface OperationsState {
  competitionCount: number;
  unresolvedErrors: number;
  syncRows: readonly SyncHealthRow[];
  auditEvents: readonly AuditEvent[];
  loading: boolean;
  error: string | null;
}

const demoState: OperationsState = {
  competitionCount: 6,
  unresolvedErrors: 3,
  loading: false,
  error: null,
  syncRows: [
    {
      id: 'hockey-men',
      provider: "Men's Hockey · fixture",
      status: 'succeeded',
      finishedAt: new Date(Date.now() - 18_000).toISOString(),
      changed: 14,
    },
    {
      id: 'hockey-women',
      provider: "Women's Hockey · fixture",
      status: 'succeeded',
      finishedAt: new Date(Date.now() - 42_000).toISOString(),
      changed: 11,
    },
    {
      id: 'basketball',
      provider: 'Basketball · fixture',
      status: 'partial',
      finishedAt: new Date(Date.now() - 480_000).toISOString(),
      changed: 4,
    },
  ],
  auditEvents: [
    {
      id: '1',
      action: 'scoring.game_replayed',
      entityType: 'game',
      entityId: 'MH-2026-009',
      createdAt: new Date().toISOString(),
    },
    {
      id: '2',
      action: 'provider.athlete_mapped',
      entityType: 'athlete',
      entityId: '19842',
      createdAt: new Date(Date.now() - 780_000).toISOString(),
    },
  ],
};

interface SyncRow {
  id: string;
  provider: string;
  status: string;
  finished_at: string | null;
  inserted_count: number;
  updated_count: number;
}

interface AuditRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

export function useOperations(): OperationsState {
  const { demoMode, user } = useSession();
  const [state, setState] = useState<OperationsState>(
    demoMode
      ? demoState
      : {
          competitionCount: 0,
          unresolvedErrors: 0,
          syncRows: [],
          auditEvents: [],
          loading: true,
          error: null,
        },
  );

  useEffect(() => {
    if (demoMode || !supabase || !user) return;
    const client = supabase;
    const load = async () => {
      const [competitions, errors, syncs, audit] = await Promise.all([
        client.from('competitions').select('id', { count: 'exact', head: true }),
        client
          .from('sync_errors')
          .select('id', { count: 'exact', head: true })
          .is('resolved_at', null),
        client
          .from('sync_runs')
          .select('id, provider, status, finished_at, inserted_count, updated_count')
          .order('started_at', { ascending: false })
          .limit(12),
        client
          .from('audit_log')
          .select('id, action, entity_type, entity_id, created_at')
          .order('created_at', { ascending: false })
          .limit(12),
      ]);
      const error = competitions.error ?? errors.error ?? syncs.error ?? audit.error;
      if (error) {
        setState((current) => ({ ...current, loading: false, error: error.message }));
        return;
      }
      setState({
        competitionCount: competitions.count ?? 0,
        unresolvedErrors: errors.count ?? 0,
        syncRows: (syncs.data as SyncRow[]).map((row) => ({
          id: row.id,
          provider: row.provider,
          status: row.status,
          finishedAt: row.finished_at,
          changed: row.inserted_count + row.updated_count,
        })),
        auditEvents: (audit.data as AuditRow[]).map((row) => ({
          id: String(row.id),
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          createdAt: row.created_at,
        })),
        loading: false,
        error: null,
      });
    };
    void load();
  }, [demoMode, user]);

  return state;
}
