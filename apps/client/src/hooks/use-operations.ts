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

export function useOperations(enabled = true): OperationsState {
  const { user } = useSession();
  const [state, setState] = useState<OperationsState>({
    competitionCount: 0,
    unresolvedErrors: 0,
    syncRows: [],
    auditEvents: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!supabase || !user || !enabled) {
      setState({
        competitionCount: 0,
        unresolvedErrors: 0,
        syncRows: [],
        auditEvents: [],
        loading: false,
        error: null,
      });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));
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
      if (cancelled) return;
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
    void load().catch(() => {
      if (!cancelled)
        setState((current) => ({
          ...current,
          loading: false,
          error: 'Unable to load operations data.',
        }));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  return state;
}
