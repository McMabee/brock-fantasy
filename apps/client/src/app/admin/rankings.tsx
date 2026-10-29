import { useRef, useState } from 'react';
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
import { AdminSelect, adminMultiline } from '@/components/admin-ui';
import { LeagueRefresh } from '@/components/admin-league-ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { useAdminLeagueRead } from '@/hooks/use-admin-leagues';
import { betaCommand } from '@/lib/web-api';
import { newCommandKey } from '@/lib/command-key';
import { adminDate } from '@/lib/admin-leagues';
import { type RankingReview } from '@/lib/admin-rankings';
import { RankingTables } from '@/components/preseason-ranking-table';

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
          ) : review.data ? (
            <Text style={ui.body}>Historical rankings are view only.</Text>
          ) : null}
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
        <RankingTables rows={review.data?.rows ?? []} />
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
