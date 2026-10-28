import type { ParticipationRole, VarsityProgram } from '@brock-fantasy/domain';
export interface ParticipantRequest {
  id: string;
  user_id: string;
  match_id: string;
  display_name: string;
  email: string | null;
  suggested_role: ParticipationRole;
  suggested_programs: VarsityProgram[];
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  responded_at: string | null;
  reviewed_at: string | null;
  requested_by: string | null;
  reviewed_by: string | null;
  response_role: ParticipationRole | null;
  response_programs: VarsityProgram[] | null;
  explanation: string | null;
  review_reason: string | null;
  delivery_status: string | null;
  delivery_failure: string | null;
}
export interface ParticipantRequestPage {
  enabled: boolean;
  items: ParticipantRequest[];
  hasMore: boolean;
  nextCursor: { at: string; id: string } | null;
}
