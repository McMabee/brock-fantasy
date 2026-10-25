import { useState } from 'react';
import { Text } from 'react-native';
import { ActionButton, Card, useUiStyles } from './ui';
import type { FantasyTeam } from '@brock-fantasy/domain';

export function MatchupSetup({
  leagueId,
  teams,
  entryPeriodAvailable = true,
  onCreated,
}: {
  leagueId: string;
  teams: readonly FantasyTeam[];
  entryPeriodAvailable?: boolean;
  onCreated: () => Promise<void>;
}) {
  const ui = useUiStyles();
  const [busy, setBusy] = useState(false);
  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={ui.title}>
        Automatic matchup schedule
      </Text>
      <Text style={ui.body}>
        {entryPeriodAvailable
          ? `Your ${teams.length}-team round-robin schedule is created when the draft finishes. The first playable period is fixed at draft completion, before its first scoring game.`
          : 'Your draft finished after the final regular-season entry cutoff. This league has no scoring periods or playoff entry this season.'}
      </Text>
      <ActionButton label="View matchup schedule" href={`/matchups/${leagueId}`} />
      <ActionButton
        label="Refresh schedule status"
        loading={busy}
        onPress={() => {
          if (busy) return;
          setBusy(true);
          void onCreated().finally(() => setBusy(false));
        }}
      />
    </Card>
  );
}
