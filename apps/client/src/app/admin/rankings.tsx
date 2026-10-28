import { useMemo, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  LoadingState,
  useUiStyles,
} from '@/components/ui';
import { AdminAccess } from '@/components/admin-access';
import { AdminSelect, AdminTable, adminMultiline } from '@/components/admin-ui';
import { DraftPlayerPhoto } from '@/components/player-photo';
import { LeagueRefresh } from '@/components/admin-league-ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { useAdminLeagueRead } from '@/hooks/use-admin-leagues';
import { betaCommand } from '@/lib/web-api';
import { newCommandKey } from '@/lib/command-key';
import { ROSTER_GUIDE, positionLabel } from '@/lib/roster-guide';
import { programNames } from '@/lib/player-program';
import { operationLabel } from '@/lib/admin-operations';
import { adminDate } from '@/lib/admin-leagues';
import { pairRankingRows, type AdminRankingRow, type RankingReview } from '@/lib/admin-rankings';

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
            <Text style={[ui.body, { fontWeight: '700', flex: 1 }]}>{row.name}</Text>
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

export default function RankingPublicationScreen() {
  const access = useRequireAdmin();
  const params = useLocalSearchParams<{ season?: string; preview?: string }>();
  const router = useRouter();
  const ui = useUiStyles();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const key = useRef<{ key: string; reason: string; hash: string; pool: string } | null>(null);
  const catalog = useAdminLeagueRead<{ currentSeason: string | null; seasons: string[] }>(
    'admin_get_ranking_seasons',
    {},
    access.allowed,
  );
  const review = useAdminLeagueRead<RankingReview>(
    'admin_get_ranking_review',
    { p_season: params.season ?? null, p_preview: params.preview === '1' },
    access.allowed,
  );
  const grouped = useMemo(() => pairRankingRows(review.data?.rows ?? []), [review.data]);
  const publish = async () => {
    const current = review.data;
    if (!current?.canPublish || !current.preview || !current.input_hash || !current.poolId || busy)
      return;
    key.current ??= {
      key: newCommandKey(),
      reason: reason.trim(),
      hash: current.input_hash,
      pool: current.poolId,
    };
    setBusy(true);
    try {
      const result = await betaCommand<{ version: number }>('admin_publish_preseason_review', {
        p_pool_id: key.current.pool,
        p_expected_hash: key.current.hash,
        p_reason: key.current.reason,
        p_idempotency_key: key.current.key,
      });
      setMessage(result.error ?? `Preseason ranking snapshot v${result.data?.version} published.`);
      if (!result.error) {
        key.current = null;
        setReason('');
        setUncertain(false);
        router.setParams({ preview: undefined });
      } else if (result.status && result.status < 500) {
        key.current = null;
        setUncertain(false);
        if (result.status === 409 || result.code === '40001')
          router.setParams({ preview: undefined });
      } else setUncertain(true);
    } catch {
      setUncertain(true);
      setMessage('Publication outcome unavailable. Retry to retrieve the same result safely.');
    } finally {
      setBusy(false);
    }
  };
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Operations centre" title="Review preseason rankings">
      <View style={{ gap: 20 }}>
        <ActionButton label="Back to Operations Centre" href="/admin" variant="secondary" />
        <Card style={{ gap: 14 }}>
          <AdminSelect
            label="Ranking season"
            value={params.season ?? catalog.data?.currentSeason ?? ''}
            options={
              catalog.data?.seasons.length
                ? catalog.data.seasons.map((season) => ({
                    value: season,
                    label: `${season}${season === catalog.data?.currentSeason ? ' · Current' : ''}`,
                  }))
                : [{ value: '', label: '—' }]
            }
            disabled={busy || uncertain}
            onChange={(season) => {
              key.current = null;
              setReason('');
              setMessage('');
              router.setParams({ season, preview: undefined });
            }}
          />
          <Text style={ui.body}>Season: {review.data?.season ?? '—'}</Text>
          {review.data?.publication ? (
            <Text style={ui.body}>
              Published snapshot v{review.data.publication.version} ·{' '}
              {adminDate(review.data.publication.published_at)}
            </Text>
          ) : (
            <Text style={ui.body}>Published snapshot: —</Text>
          )}
          {review.data?.canPublish ? (
            <ActionButton
              label="Preview preseason rankings"
              disabled={busy || uncertain}
              onPress={() => {
                key.current = null;
                setMessage('');
                if (params.preview === '1') void review.refresh();
                else router.setParams({ preview: '1' });
              }}
            />
          ) : (
            <Text style={ui.body}>Historical rankings are view only.</Text>
          )}
        </Card>
        {catalog.error ? (
          <Text accessibilityRole="alert" style={ui.body}>
            {catalog.error}
          </Text>
        ) : null}
        <LeagueRefresh {...review} refresh={review.refresh} />
        {review.loading && !review.data ? <LoadingState label="Loading ranking season" /> : null}
        {message ? (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
        ) : null}
        {!review.loading && review.data?.rows.length === 0 ? (
          <EmptyState
            title="Rankings unavailable"
            body="— No ranking snapshot is available for this season."
          />
        ) : null}
        {(['Hockey', 'Basketball', 'Volleyball'] as const).map((sport, index) => (
          <View key={sport} style={{ gap: 16 }}>
            <Text accessibilityRole="header" style={ui.title}>
              {sport}
            </Text>
            {ROSTER_GUIDE.slice(index * 2, index * 2 + 2).map((slot) => (
              <Card key={slot.code} style={{ gap: 12 }}>
                <Text accessibilityRole="header" style={ui.title}>
                  {slot.label}
                </Text>
                {grouped.get(slot.code)?.length ? (
                  <AdminTable
                    label={`${sport} ${slot.label} preseason rankings`}
                    columns={[
                      { label: 'Women’s athlete', width: 300 },
                      { label: 'Rank', width: 90 },
                      { label: 'Men’s athlete', width: 300 },
                    ]}
                    rows={grouped.get(slot.code)!.map((pair) => ({
                      id: pair.id,
                      cells: [
                        <RankingAthletes key="women" athletes={pair.women} />,
                        pair.rank == null ? '—' : `#${pair.rank}`,
                        <RankingAthletes key="men" athletes={pair.men} />,
                      ],
                    }))}
                  />
                ) : (
                  <Text style={ui.body}>—</Text>
                )}
              </Card>
            ))}
          </View>
        ))}
        {review.data?.canPublish && review.data.preview && review.data.rows.length ? (
          <Card style={{ gap: 14 }}>
            <Text style={ui.title}>Publish reviewed snapshot</Text>
            <Text style={ui.label}>Review reason</Text>
            <TextInput
              accessibilityLabel="Ranking publication review reason"
              value={reason}
              onChangeText={setReason}
              maxLength={500}
              multiline
              editable={!busy && !uncertain}
              style={[ui.input, adminMultiline]}
            />
            <ActionButton
              label={uncertain ? 'Retry publication confirmation' : 'Publish reviewed snapshot'}
              onPress={() => void publish()}
              disabled={reason.trim().length < 5}
              loading={busy}
            />
          </Card>
        ) : null}
      </View>
    </AppShell>
  );
}
