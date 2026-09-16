import type { League } from '@brock-fantasy/domain';
import { useEffect, useState } from 'react';

import { demoLeague } from '@/data/demo';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

interface LeagueRow {
  id: string;
  competition_id: string;
  commissioner_id: string | null;
  ruleset_id: string;
  name: string;
  format: League['format'];
  status: League['status'];
  max_members: number;
  invite_code: string;
}

export function useMyLeagues(): readonly League[] {
  const { demoMode, user } = useSession();
  const [leagues, setLeagues] = useState<readonly League[]>(demoMode ? [demoLeague] : []);

  useEffect(() => {
    if (demoMode || !supabase || !user) return;
    void supabase
      .from('leagues')
      .select(
        'id, competition_id, commissioner_id, ruleset_id, name, format, status, max_members, invite_code',
      )
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setLeagues(
          ((data ?? []) as LeagueRow[]).map((row) => ({
            id: row.id,
            competitionId: row.competition_id,
            commissionerId: row.commissioner_id ?? '',
            rulesetId: row.ruleset_id,
            name: row.name,
            format: row.format,
            status: row.status,
            maxMembers: row.max_members,
            inviteCode: row.invite_code,
          })),
        );
      });
  }, [demoMode, user]);

  return leagues;
}
