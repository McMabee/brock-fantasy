import { Text, View } from 'react-native';
import type { Competition } from '@brock-fantasy/domain';
import { AdminTable } from './admin-ui';
import { Card, useUiStyles } from './ui';
import { PendingConfirmation } from './player-insights';
import { RANKING_SPORTS } from '@/lib/player-program';
import type { ProgramGame, ProgramGames } from '@/hooks/use-program-games';

const SPORT_ICONS = { hockey: '🏒', basketball: '🏀', volleyball: '🏐' } as const;

export function ProgramGameCell({ games }: { games: ProgramGames | undefined }) {
  const ui = useUiStyles();
  const fixture = (game: ProgramGame, live: boolean) => (
    <View key={game.id} style={{ gap: 8 }}>
      <Text style={ui.label}>
        {live ? 'LIVE · ' : ''}
        {game.neutral || game.home ? 'vs.' : '@'} {game.opponent}
      </Text>
      <Text style={ui.body}>
        {new Date(game.starts_at).toLocaleString('en-CA', {
          timeZone: 'America/Toronto',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })}
      </Text>
      {game.neutral ? <Text style={ui.body}>Neutral site</Text> : null}
      {!game.schedule_confirmed ? <PendingConfirmation /> : null}
    </View>
  );
  return (
    <View style={{ gap: 20 }}>
      {games?.live ? fixture(games.live, true) : null}
      {games?.next ? (
        fixture(games.next, false)
      ) : (
        <Text style={ui.body}>No upcoming game scheduled</Text>
      )}
    </View>
  );
}

export function UpcomingGames({
  competitions,
  games,
}: {
  competitions: readonly Competition[];
  games: Readonly<Record<string, ProgramGames>>;
}) {
  const ui = useUiStyles();
  // - Index programs once so each sport and division uses a constant time lookup
  const byProgram = new Map(competitions.map((item) => [`${item.sport}:${item.division}`, item]));
  return (
    <Card style={{ minWidth: 0, maxWidth: '100%' }}>
      <AdminTable
        centered
        label="Upcoming Brock games"
        columns={[
          { label: 'Women’s', width: 270 },
          { label: 'Sport', width: 140, align: 'center' },
          { label: 'Men’s', width: 270 },
        ]}
        rows={RANKING_SPORTS.map((sport) => {
          const women = byProgram.get(`${sport.value}:womens`),
            men = byProgram.get(`${sport.value}:mens`);
          return {
            id: sport.value,
            cells: [
              <ProgramGameCell key="women" games={women ? games[women.id] : undefined} />,
              <View key="sport" style={{ gap: 8, alignItems: 'center' }}>
                <Text accessible={false} style={{ fontSize: 28 }}>
                  {SPORT_ICONS[sport.value]}
                </Text>
                <Text style={ui.label}>{sport.label}</Text>
              </View>,
              <ProgramGameCell key="men" games={men ? games[men.id] : undefined} />,
            ],
          };
        })}
      />
    </Card>
  );
}
