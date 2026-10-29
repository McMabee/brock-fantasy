import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Card, useUiStyles } from './ui';
import { AdminTable } from './admin-ui';
import { PressableLink } from './pressable-link';
import { DraftPlayerPhoto } from './player-photo';
import { ROSTER_GUIDE, positionLabel } from '@/lib/roster-guide';
import { programNames, RANKING_SPORTS } from '@/lib/player-program';
import { operationLabel } from '@/lib/admin-operations';
import { pairRankingRows, type AdminRankingRow } from '@/lib/admin-rankings';

function RankingAthletes({ athletes }: { athletes: readonly AdminRankingRow[] }) {
  const ui = useUiStyles();
  if (!athletes.length) return <Text style={ui.body}>—</Text>;
  return (
    <View style={{ gap: 20 }}>
      {athletes.map((row) => (
        <View key={row.athlete_id} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <DraftPlayerPhoto
              player={{ displayName: row.name, bio: row.display_data.bio ?? {} }}
              size={48}
            />
            <PressableLink
              href={`/players/${row.athlete_id}`}
              accessibilityRole="link"
              style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={[ui.body, { fontWeight: '700', textDecorationLine: 'underline' }]}>
                {row.name}
              </Text>
            </PressableLink>
          </View>
          <Text style={ui.body}>
            {row.display_data.program
              ? (programNames[row.display_data.program] ?? row.display_data.program)
              : '—'}{' '}
            · {row.display_data.position ? positionLabel(row.display_data.position) : '—'}
          </Text>
          <Text style={ui.body}>Ranking inputs · {row.display_data.season_label ?? '—'}</Text>
          <Text style={ui.body}>
            Projected FP:{' '}
            {row.projected_points?.toLocaleString('en-CA', { maximumFractionDigits: 2 }) ?? '—'} ·
            Projected games: {row.display_data.games_played ?? '—'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {Object.entries(row.display_data.stats ?? {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([stat, value]) => (
                <Text key={stat} style={ui.body}>
                  {operationLabel(stat)}:{' '}
                  {value.toLocaleString('en-CA', { maximumFractionDigits: 2 })}
                </Text>
              ))}
          </View>
          {row.display_data.supporting_statistics ? (
            <View style={{ gap: 8 }}>
              <Text style={ui.body}>
                Supporting source statistics · {row.display_data.supporting_statistics.season_label}
              </Text>
              <Text style={ui.body}>
                Games: {row.display_data.supporting_statistics.games_played ?? '—'} · Fantasy
                points: {row.display_data.supporting_statistics.fantasy_points ?? '—'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {Object.entries(row.display_data.supporting_statistics.stats)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([stat, value]) => (
                    <Text key={stat} style={ui.body}>
                      {stat.replace(/^[0-9]{2}[-/][0-9]{2} /u, '')}:{' '}
                      {value.toLocaleString('en-CA', { maximumFractionDigits: 2 })}
                    </Text>
                  ))}
              </View>
            </View>
          ) : null}
          {!Object.keys(row.display_data.stats ?? {}).length &&
          !row.display_data.supporting_statistics ? (
            <Text style={ui.body}>Supporting statistics: —</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function RankingTables({
  rows,
  sport = 'all',
  position = 'all',
  query = '',
}: {
  rows: readonly AdminRankingRow[];
  sport?: string;
  position?: string;
  query?: string;
}) {
  const ui = useUiStyles();
  // - Pair the complete snapshot before filtering so searches never renumber athletes
  const paired = useMemo(() => pairRankingRows(rows), [rows]);
  const normalized = query.trim().toLocaleLowerCase();
  return (
    <View style={{ gap: 20 }}>
      {RANKING_SPORTS.filter(
        (item) =>
          (sport === 'all' || item.value === sport) &&
          (position === 'all' || position.startsWith(item.prefix)),
      ).map((item) => (
        <View key={item.value} style={{ gap: 16 }}>
          <Text accessibilityRole="header" style={ui.title}>
            {item.label}
          </Text>
          {ROSTER_GUIDE.filter(
            (slot) =>
              slot.code.startsWith(item.prefix) && (position === 'all' || slot.code === position),
          ).map((slot) => {
            const pairs = (paired.get(slot.code) ?? [])
              .map((pair) => ({
                ...pair,
                women: pair.women.filter((row) =>
                  row.name.toLocaleLowerCase().includes(normalized),
                ),
                men: pair.men.filter((row) => row.name.toLocaleLowerCase().includes(normalized)),
              }))
              .filter((pair) => pair.women.length || pair.men.length);
            return (
              <Card key={slot.code} style={{ gap: 12, minWidth: 0, maxWidth: '100%' }}>
                <Text accessibilityRole="header" style={ui.title}>
                  {slot.label}
                </Text>
                {pairs.length ? (
                  <AdminTable
                    label={`${item.label} ${slot.label} preseason rankings`}
                    columns={[
                      { label: 'Women’s athlete', width: 300 },
                      { label: 'Rank', width: 90 },
                      { label: 'Men’s athlete', width: 300 },
                    ]}
                    rows={pairs.map((pair) => ({
                      id: pair.id,
                      cells: [
                        <RankingAthletes key="women" athletes={pair.women} />,
                        pair.rank == null ? '—' : `#${pair.rank}`,
                        <RankingAthletes key="men" athletes={pair.men} />,
                      ],
                    }))}
                  />
                ) : (
                  <Text style={ui.body}>{normalized ? 'No matching athletes' : '—'}</Text>
                )}
              </Card>
            );
          })}
        </View>
      ))}
    </View>
  );
}
