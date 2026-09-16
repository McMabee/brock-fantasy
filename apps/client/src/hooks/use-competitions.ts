import type { Competition, DivisionCode, SportCode } from '@brock-fantasy/domain';
import { useEffect, useState } from 'react';

import { demoCompetitions } from '@/data/demo';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

interface CompetitionRow {
  id: string;
  division: DivisionCode;
  name: string;
  season_label: string;
  is_active: boolean;
  ruleset_id: string;
  sports: { code: SportCode } | { code: SportCode }[];
}

export function useCompetitions(): readonly Competition[] {
  const { demoMode } = useSession();
  const [competitions, setCompetitions] = useState<readonly Competition[]>(
    demoMode ? demoCompetitions : [],
  );

  useEffect(() => {
    if (demoMode || !supabase) return;
    void supabase
      .from('competitions')
      .select('id, division, name, season_label, is_active, ruleset_id, sports!inner(code)')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        const rows = (data ?? []) as CompetitionRow[];
        setCompetitions(
          rows.map((row) => {
            const sport = Array.isArray(row.sports) ? row.sports[0]?.code : row.sports.code;
            if (!sport) throw new Error(`Competition ${row.id} has no sport.`);
            return {
              id: row.id,
              division: row.division,
              name: row.name,
              seasonLabel: row.season_label,
              isActive: row.is_active,
              rulesetId: row.ruleset_id,
              sport,
            };
          }),
        );
      });
  }, [demoMode]);

  return competitions;
}
