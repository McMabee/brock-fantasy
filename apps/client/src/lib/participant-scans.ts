import type { ParticipationRole, VarsityProgram } from '@brock-fantasy/domain';
import { supabase } from './supabase';

export interface Participant {
  id: string;
  display_name: string;
  email: string;
  role: ParticipationRole;
  programs: VarsityProgram[];
  revision: number;
}
export interface ParticipantReference {
  name: string;
  emails: string[];
  role: Exclude<ParticipationRole, 'none'>;
  programs: VarsityProgram[];
  sources: { file: string; rowNumber: number; title: string | null; supportingStaff: boolean }[];
}
export interface ParticipantMatch {
  id: string;
  user_id: string;
  reference_id: string;
  score: number;
  display_name: string;
  email: string;
  resolved: boolean;
  dismissed: boolean;
  evidence_changed: boolean;
  review_id: string | null;
  review_reason: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  evidence: {
    reference: ParticipantReference;
    accountName: string;
    accountEmail: string;
    reasons: string[];
    scores: Record<string, number>;
  };
}
export interface ParticipantScanRun {
  id: string;
  reference_version_id: string;
  scoring_version: string;
  started_at: string;
  completed_at: string;
  runner_name: string;
  account_count: number;
  result_count: number;
}
export interface ParticipantScanSnapshot {
  enabled: boolean;
  activeReferenceVersionId: string | null;
  history: ParticipantScanRun[];
  run: ParticipantScanRun | null;
  newRegistrations: number;
  matches: ParticipantMatch[];
}
export async function participantRead<T>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!supabase) throw new Error('Supabase is unavailable');
  const result = await supabase.rpc(name, params);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export function groupParticipantMatches(
  matches: ParticipantMatch[],
  minimum: number,
  showResolved: boolean,
  showDismissed: boolean,
) {
  const grouped = new Map<string, [ParticipantMatch, ...ParticipantMatch[]]>();
  for (const match of matches) {
    if (
      match.score < minimum ||
      (match.resolved && !showResolved) ||
      (match.dismissed && !showDismissed)
    )
      continue;
    const rows = grouped.get(match.user_id);
    if (rows) rows.push(match);
    else grouped.set(match.user_id, [match]);
  }
  return [...grouped.values()]
    .map((rows) =>
      rows.sort(
        (a, b) =>
          Number(a.dismissed) - Number(b.dismissed) ||
          b.score - a.score ||
          a.reference_id.localeCompare(b.reference_id),
      ),
    )
    .sort(
      (a, b) =>
        b[0].score - a[0].score ||
        a[0].display_name.localeCompare(b[0].display_name) ||
        a[0].user_id.localeCompare(b[0].user_id),
    );
}

export const participantScanTime = (value: string) =>
  new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Toronto',
  }).format(new Date(value));
