import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BETA_PLAYER_POOL_ID } from '@brock-fantasy/domain';
import { ActionButton, Card, LoadingState, useUiStyles } from './ui';
import { supabase } from '@/lib/supabase';
import { ROSTER_GUIDE, positionLabel } from '@/lib/roster-guide';
import { programNames } from '@/lib/player-program';
import { useSession } from '@/providers/session-provider';

export interface RankingRow {
  athlete_id: string;
  name: string;
  position: string;
  program: string;
  position_group: string;
  projected_points: number | null;
  position_rank: number | null;
}
interface Rankings {
  publication: { version: number; published_at: string } | null;
  rows: RankingRow[];
}
export function PreseasonRankings() {
  const { user } = useSession();
  const [state, setState] = useState<{
    owner: string;
    data: Rankings | null;
    error: string | null;
  } | null>(null);
  const [group, setGroup] = useState('all'),
    [program, setProgram] = useState('all'),
    [search, setSearch] = useState(''),
    [retry, setRetry] = useState(0);
  const ui = useUiStyles();
  useEffect(() => {
    let active = true;
    if (supabase && user)
      void supabase
        .rpc('get_preseason_rankings', { p_pool_id: BETA_PLAYER_POOL_ID })
        .then((result) => {
          if (active)
            setState({
              owner: user.id,
              data: result.error ? null : (result.data as Rankings),
              error: result.error?.message ?? null,
            });
        });
    return () => {
      active = false;
    };
  }, [user?.id, retry]);
  const rows = state?.owner === user?.id ? (state?.data?.rows ?? []) : [];
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter(
      (row) =>
        (group === 'all' || row.position_group === group) &&
        (program === 'all' || row.program === program) &&
        (!query || row.name.toLocaleLowerCase().includes(query)),
    );
  }, [rows, group, program, search]);
  if (!state || state.owner !== user?.id)
    return <LoadingState label="Loading preseason rankings" />;
  if (state.error)
    return (
      <Card>
        <Text accessibilityRole="alert" style={ui.body}>
          Rankings are unavailable. Please retry.
        </Text>
        <ActionButton
          label="Retry rankings"
          variant="secondary"
          onPress={() => setRetry((value) => value + 1)}
        />
      </Card>
    );
  return (
    <View style={{ gap: 14 }}>
      <Text accessibilityRole="header" style={ui.title}>
        Preseason position rankings
      </Text>
      <Text style={ui.body}>
        Ranked by supplied season projected fantasy points within the six standard starter groups,
        combining men’s and women’s programs.
      </Text>
      {state.data?.publication ? (
        <Text style={ui.body}>
          Reviewed snapshot v{state.data.publication.version},{' '}
          {new Date(state.data.publication.published_at).toLocaleDateString('en-CA', {
            timeZone: 'America/Toronto',
          })}
        </Text>
      ) : (
        <Text style={ui.body}>
          The reviewed preseason ranking snapshot has not been published yet.
        </Text>
      )}
      <TextInput
        accessibilityLabel="Search preseason rankings"
        value={search}
        onChangeText={setSearch}
        placeholder="Search athlete name"
        style={ui.input}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ActionButton
          label="All positions"
          variant={group === 'all' ? 'primary' : 'secondary'}
          onPress={() => setGroup('all')}
        />
        {ROSTER_GUIDE.filter((slot) => !['FLEX', 'BN'].includes(slot.code)).map((slot) => (
          <ActionButton
            key={slot.code}
            label={slot.label}
            variant={group === slot.code ? 'primary' : 'secondary'}
            onPress={() => setGroup(slot.code)}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['all', ...new Set(rows.map((row) => row.program))].map((value) => (
          <ActionButton
            key={value}
            label={value === 'all' ? 'All programs' : (programNames[value] ?? value)}
            variant={program === value ? 'primary' : 'secondary'}
            onPress={() => setProgram(value)}
          />
        ))}
      </View>
      {ROSTER_GUIDE.filter(
        (slot) => !['FLEX', 'BN'].includes(slot.code) && (group === 'all' || slot.code === group),
      ).map((slot) => (
        <Card key={slot.code} style={{ gap: 10 }}>
          <Text style={ui.title}>{slot.label}</Text>
          {visible
            .filter((row) => row.position_group === slot.code)
            .map((row) => (
              <View key={row.athlete_id} style={{ paddingVertical: 10, gap: 4 }}>
                <Text style={ui.label}>
                  {row.position_rank == null ? 'Unranked' : `#${row.position_rank}`},{' '}
                  {row.projected_points == null
                    ? 'Projection unavailable'
                    : `${row.projected_points} projected FP`}
                </Text>
                <ActionButton
                  label={row.name}
                  href={`/players/${row.athlete_id}`}
                  variant="ghost"
                />
                <Text style={ui.body}>
                  {programNames[row.program] ?? row.program}, {positionLabel(row.position)}
                </Text>
              </View>
            ))}
        </Card>
      ))}
    </View>
  );
}
