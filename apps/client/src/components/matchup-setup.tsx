import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton, Card, useUiStyles } from './ui';
import { gameTime } from './player-insights';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import type { FantasyTeam } from '@brock-fantasy/domain';

interface Preview {
  signature: string;
  shortened: boolean;
  can_generate: boolean;
  periods: { number: number; starts_at: string; ends_at: string }[];
  pairings: { period: number; home_team_id: string; away_team_id: string }[];
}
export function MatchupSetup({
  leagueId,
  teams,
  onCreated,
}: {
  leagueId: string;
  teams: readonly FantasyTeam[];
  onCreated: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef('');
  const ui = useUiStyles();
  const names = new Map(teams.map((team) => [team.id, team.name]));
  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await supabase!.rpc('get_matchup_preview', { p_league_id: leagueId });
      if (result.error) setError(result.error.message);
      else {
        setPreview(result.data as Preview);
        key.current = `matchups-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
    } catch {
      setError('Could not load the schedule preview. Please retry.');
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await betaCommand('confirm_matchup_schedule', {
        p_league_id: leagueId,
        p_expected_signature: preview.signature,
        p_idempotency_key: key.current,
      });
      if (result.error) setError(result.error);
      else {
        setPreview(null);
        await onCreated();
      }
    } catch {
      setError('Connection interrupted. Retry the same confirmation to check its result.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={ui.title}>
        Set up matchups
      </Text>
      <Text style={ui.body}>
        Review your league’s round-robin opponents and approved fantasy periods before creating the
        schedule.
      </Text>
      <ActionButton
        label={preview ? 'Reload schedule preview' : 'Preview matchup schedule'}
        onPress={() => void load()}
        loading={busy}
      />
      {error ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {error}
        </Text>
      ) : null}
      {preview ? (
        <>
          <Text style={ui.body}>
            {preview.shortened
              ? 'Shortened season: only full, unstarted eligible periods remain. Previously earned points are preserved.'
              : 'Full regular-season schedule'}
          </Text>
          {preview.periods.map((period) => (
            <View key={period.number} style={{ gap: 6 }}>
              <Text style={ui.label}>
                Period {period.number}, {gameTime(period.starts_at)} – {gameTime(period.ends_at)}
              </Text>
              {preview.pairings
                .filter((pair) => pair.period === period.number)
                .map((pair) => (
                  <Text key={pair.home_team_id} style={ui.body}>
                    {names.get(pair.home_team_id)} vs {names.get(pair.away_team_id)}
                  </Text>
                ))}
            </View>
          ))}
          {!preview.can_generate ? (
            <Text style={ui.body}>No unstarted eligible fantasy periods remain.</Text>
          ) : null}
          <ActionButton
            label="Confirm matchup schedule"
            onPress={() => void confirm()}
            disabled={!preview.can_generate || busy}
          />
        </>
      ) : null}
    </Card>
  );
}
