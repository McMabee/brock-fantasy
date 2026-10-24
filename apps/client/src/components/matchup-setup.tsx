import { useState } from 'react';
import { Text } from 'react-native';
import { ActionButton, Card, useUiStyles } from './ui';
import type { FantasyTeam } from '@brock-fantasy/domain';

export function MatchupSetup({
  leagueId,
  teams,
  onCreated,
}: {
  leagueId: string;
  teams: readonly FantasyTeam[];
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
        Your {teams.length}-team round-robin schedule is created when the draft finishes. The
        current period is included when your draft finished before its first scoring game.
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
