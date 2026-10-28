export interface OperationsCursor {
  at: string;
  id: string;
}
export interface ScheduleOutcome {
  source_id: string;
  program: string;
  url: string;
  status: string;
  changed: number;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
}
export interface OperationItem {
  id: string;
  created_at: string;
  status?: string;
  job_kind?: string;
  provider?: string;
  competition_id?: string | null;
  competition_name?: string | null;
  season_label?: string | null;
  game_name?: string | null;
  provider_snapshot_id?: string | null;
  started_at?: string;
  finished_at?: string | null;
  inserted_count?: number;
  updated_count?: number;
  ignored_count?: number;
  sources?: ScheduleOutcome[];
  alert_count?: number;
  summary?: string;
  error_code?: string;
  sync_run_id?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  program?: string | null;
  source_url?: string | null;
  context?: Record<string, unknown>;
  action?: string;
  category?: string;
  actor_id?: string | null;
  actor?: string;
  entity_type?: string;
  entity_id?: string;
  entity_name?: string | null;
  before_state?: Record<string, unknown>;
  after_state?: Record<string, unknown>;
}
export interface OperationsPage {
  categories?: string[];
  entityTypes?: string[];
  legacySources?: {
    id: string;
    program: string;
    url: string;
    last_synced_at: string | null;
    needs_review: boolean;
  }[];
  items: OperationItem[];
  hasMore: boolean;
  nextCursor: OperationsCursor | null;
}
export interface OperationsSummary {
  unresolvedErrors: number;
  syncRows: OperationItem[];
  auditEvents: OperationItem[];
  latestSync: { provider: string; finished_at: string; job_kind: string; status: string } | null;
}
export function operationLabel(value: string): string {
  const words = value === value.toUpperCase() ? value.toLowerCase() : value;
  return words
    .replaceAll('_', ' ')
    .replaceAll('.', ' ')
    .replace(/^./u, (first) => first.toUpperCase());
}
export function operationValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return (
      value
        .map((item: unknown) =>
          typeof item === 'string' ? operationLabel(item) : operationValue(item),
        )
        .join(', ') || '—'
    );
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return typeof value === 'object' ? JSON.stringify(value) : '—';
}
