import { useAdminLeagueRead } from './use-admin-leagues';
import type { OperationsSummary } from '@/lib/admin-operations';

export function useOperations(enabled = true) {
  const read = useAdminLeagueRead<OperationsSummary>('admin_get_operations_summary', {}, enabled);
  return {
    available: Boolean(read.data),
    latestSync: read.data?.latestSync
      ? {
          provider: read.data.latestSync.provider,
          finishedAt: read.data.latestSync.finished_at,
          jobKind: read.data.latestSync.job_kind,
        }
      : null,
    unresolvedErrors: read.data?.unresolvedErrors ?? 0,
    syncRows: (read.data?.syncRows ?? []).map((row) => ({
      id: row.id,
      provider: row.provider ?? 'Unknown source',
      jobKind: row.job_kind ?? 'player',
      status: row.status ?? 'running',
      finishedAt: row.finished_at ?? null,
      changed: (row.inserted_count ?? 0) + (row.updated_count ?? 0),
    })),
    auditEvents: read.data?.auditEvents ?? [],
    loading: read.loading,
    error: read.error,
  };
}
