import type { League } from '@brock-fantasy/domain';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

interface LeagueRow {
  id: string;
  competition_id: string | null;
  pool_id: string | null;
  commissioner_id: string | null;
  ruleset_id: string;
  name: string;
  format: League['format'];
  status: League['status'];
  max_members: number;
  invite_code: string;
  state_version: number;
}

export function useMyLeagues(): readonly League[] {
  const { user } = useSession();
  const [leagues, setLeagues] = useState<readonly League[]>([]);

  useEffect(() => {
    if (!supabase || !user) return;
    void supabase
      .from('leagues')
      .select(
        'id, competition_id, pool_id, commissioner_id, ruleset_id, name, format, status, max_members, invite_code, state_version',
      )
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setLeagues(
          ((data ?? []) as LeagueRow[]).map((row) => ({
            id: row.id,
            competitionId: row.competition_id,
            ...(row.pool_id ? { playerPoolId: row.pool_id } : {}),
            commissionerId: row.commissioner_id ?? '',
            rulesetId: row.ruleset_id,
            name: row.name,
            format: row.format,
            status: row.status,
            maxMembers: row.max_members,
            inviteCode: row.invite_code,
            stateVersion: row.state_version,
          })),
        );
      });
  }, [user]);

  return leagues;
}
