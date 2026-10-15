import type { Competition, DivisionCode, SportCode } from '@brock-fantasy/domain';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

interface CompetitionRow {
  id: string;
  division: DivisionCode;
  name: string;
  season_label: string;
  is_active: boolean;
  ruleset_id: string;
  sports: { code: SportCode } | { code: SportCode }[];
}

export function useCompetitions(enabled = true) {
  const [competitions, setCompetitions] = useState<readonly Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !enabled) {
      setCompetitions([]);
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const client = supabase;
    const load = async () => {
      const result = await client
        .from('competitions')
        .select('id, division, name, season_label, is_active, ruleset_id, sports!inner(code)')
        .eq('is_active', true)
        .order('name');
      if (!active) return;
      if (result.error) throw result.error;
      const data = result.data;
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
      setLoading(false);
    };
    void load().catch(() => {
      if (active) {
        setLoading(false);
        setError('Program information could not load.');
      }
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return { data: competitions, loading, error };
}
