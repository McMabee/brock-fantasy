import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { ActionButton, Card, LoadingState, useUiStyles } from './ui';
import { AdminSelect } from './admin-ui';
import { RankingTables } from './preseason-ranking-table';
import { RANKING_SPORTS } from '@/lib/player-program';
import { supabase } from '@/lib/supabase';
import { ROSTER_GUIDE } from '@/lib/roster-guide';
import type { AdminRankingRow } from '@/lib/admin-rankings';
import { useSession } from '@/providers/session-provider';

interface PublishedRankings {
  season: string | null;
  publication: { version: number; published_at: string } | null;
  rows: AdminRankingRow[];
}
export function PreseasonRankings() {
  const { user, readScope } = useSession();
  const [season, setSeason] = useState('');
  const [state, setState] = useState<{
    scope: typeof readScope;
    selected: string;
    seasons: string[];
    data: PublishedRankings | null;
    error: boolean;
  } | null>(null);
  const [position, setPosition] = useState('all');
  const [sport, setSport] = useState('all');
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  const ui = useUiStyles();
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!supabase || !user) return;
      const catalog = await supabase.rpc('get_published_preseason_ranking_seasons');
      if (catalog.error) throw catalog.error;
      const seasons = (catalog.data as { seasons: string[] }).seasons;
      const result = await supabase.rpc('get_published_preseason_rankings', {
        p_season: season || null,
      });
      if (result.error) throw result.error;
      if (active)
        setState({
          scope: readScope,
          selected: season,
          seasons,
          data: result.data as PublishedRankings,
          error: false,
        });
    };
    void load().catch(() => {
      if (active)
        setState({ scope: readScope, selected: season, seasons: [], data: null, error: true });
    });
    return () => {
      active = false;
    };
  }, [user?.id, readScope, season, retry]);
  if (!state || state.scope !== readScope || state.selected !== season)
    return <LoadingState label="Loading preseason rankings" />;
  if (state.error)
    return (
      <Card style={{ gap: 14 }}>
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
  const prefix = RANKING_SPORTS.find((item) => item.value === sport)?.prefix;
  return (
    <View style={{ gap: 18 }}>
      <Text accessibilityRole="header" style={ui.title}>
        Preseason position rankings
      </Text>
      <Text style={ui.body}>
        Published season projections, with women’s and men’s athletes ranked alongside each other
        within each position group.
      </Text>
      {state.data?.publication ? (
        <Text style={ui.body}>
          Published snapshot v{state.data.publication.version} ·{' '}
          {new Date(state.data.publication.published_at).toLocaleDateString('en-CA', {
            timeZone: 'America/Toronto',
          })}
        </Text>
      ) : (
        <Text style={ui.body}>No preseason ranking snapshot has been published yet.</Text>
      )}
      <AdminSelect
        label="Ranking season"
        value={state.data?.season ?? ''}
        options={state.seasons.map((value) => ({ value, label: value }))}
        disabled={!state.seasons.length}
        onChange={setSeason}
      />
      <TextInput
        accessibilityLabel="Search preseason rankings"
        value={search}
        onChangeText={setSearch}
        placeholder="Search athlete name"
        style={ui.input}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <AdminSelect
            label="Sport"
            value={sport}
            options={[{ value: 'all', label: 'All sports' }, ...RANKING_SPORTS]}
            onChange={(value) => {
              setSport(value);
              const next = RANKING_SPORTS.find((item) => item.value === value);
              if (next && position !== 'all' && !position.startsWith(next.prefix))
                setPosition('all');
            }}
          />
        </View>
        <View style={{ flex: 1, minWidth: 200 }}>
          <AdminSelect
            label="Position"
            value={position}
            options={[
              { value: 'all', label: 'All positions' },
              ...ROSTER_GUIDE.filter(
                (slot) =>
                  !['FLEX', 'BN'].includes(slot.code) && (!prefix || slot.code.startsWith(prefix)),
              ).map((slot) => ({ value: slot.code, label: slot.label })),
            ]}
            onChange={setPosition}
          />
        </View>
      </View>
      <RankingTables
        rows={state.data?.rows ?? []}
        sport={sport}
        position={position}
        query={search}
      />
    </View>
  );
}
