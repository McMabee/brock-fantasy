import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { DraftPlayerPhoto } from '@/components/draft-player-panel';
import { useRequireUser } from '@/hooks/use-route-access';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';

interface Results {
  league: { id: string; name: string };
  picks: readonly {
    id: string;
    athlete_id: string;
    display_name: string;
    bio: Record<string, unknown>;
    program: string;
    overall_pick: number;
    round: number;
    pick_in_round: number;
    team_name: string;
    source: string;
  }[];
}
export default function DraftResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const access = useRequireUser();
  const { user } = useSession();
  const styles = useUiStyles();
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!access.allowed || !supabase || !id) return;
    let cancelled = false;
    void supabase.rpc('get_draft_results', { p_draft_id: id }).then(
      (result) => {
        if (cancelled) return;
        if (result.error) setError(result.error.message);
        else setData(result.data as Results);
      },
      () => {
        if (!cancelled) setError('Draft results could not load.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, access.allowed, user?.id, reload]);
  return (
    <AppShell eyebrow={data?.league.name ?? 'Your league'} title="Draft results">
      {error ? (
        <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />
      ) : !data ? (
        <LoadingState label="Loading draft results" />
      ) : (
        <>
          <ActionButton
            label="Back to league"
            href={`/league/${data.league.id}`}
            variant="secondary"
          />
          <SectionTitle
            title="All draft picks"
            detail={`${data.picks.length} picks · in draft order`}
          />
          {!data.picks.length ? (
            <EmptyState title="No recorded picks" body="No picks were recorded for this draft." />
          ) : (
            <Card>
              {data.picks.map((pick, index) => (
                <View
                  key={pick.id}
                  style={[
                    {
                      flexDirection: 'row',
                      gap: 12,
                      alignItems: 'center',
                      paddingVertical: 14,
                    },
                    styles.listRow,
                    index === data.picks.length - 1 && styles.lastRow,
                  ]}
                >
                  <Text style={styles.label}>#{pick.overall_pick}</Text>
                  <DraftPlayerPhoto player={{ displayName: pick.display_name, bio: pick.bio }} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.body}>
                      {pick.display_name} · {pick.program.replace(/^Brock /u, '')}
                    </Text>
                    <Text style={styles.body}>
                      {pick.team_name} · Round {pick.round}, pick {pick.pick_in_round}
                      {pick.source === 'autopick' ? ' · Autopick' : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}
