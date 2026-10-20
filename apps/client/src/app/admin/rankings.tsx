import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BETA_PLAYER_POOL_ID } from '@brock-fantasy/domain';
import { ActionButton, AppShell, Card, useUiStyles } from '@/components/ui';
import { AdminAccess } from '@/components/admin-access';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { rosterSlotLabel } from '@/lib/roster-guide';

interface Preview {
  input_hash: string;
  rows: {
    athlete_id: string;
    name: string;
    position_group: string;
    position_rank: number | null;
    projected_points: number | null;
  }[];
}
export default function RankingPublicationScreen() {
  const access = useRequireAdmin();
  const [preview, setPreview] = useState<Preview | null>(null),
    [reason, setReason] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const key = useRef('');
  const ui = useUiStyles();
  const load = async () => {
    setBusy(true);
    try {
      const result = await supabase!.rpc('preview_preseason_rankings', {
        p_pool_id: BETA_PLAYER_POOL_ID,
      });
      if (result.error) setMessage(result.error.message);
      else {
        setPreview(result.data as Preview);
        key.current = `ranking-publication-${Date.now()}`;
        setMessage('Review every position group before publishing this snapshot.');
      }
    } catch {
      setMessage('Unable to load ranking inputs. Please retry.');
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const result = await betaCommand<{ version: number }>('publish_preseason_rankings', {
        p_pool_id: BETA_PLAYER_POOL_ID,
        p_expected_hash: preview.input_hash,
        p_reason: reason,
        p_idempotency_key: key.current,
      });
      setMessage(result.error ?? `Preseason ranking snapshot v${result.data?.version} published.`);
      if (!result.error) setPreview(null);
    } catch {
      setMessage('Publication could not be confirmed. Retry to safely retrieve the same result.');
    } finally {
      setBusy(false);
    }
  };
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell title="Publish preseason rankings">
      <View style={{ gap: 20 }}>
        <Card style={{ gap: 12 }}>
          <Text style={ui.body}>
            Review the supplied projection order and publish a fixed version. Completed drafts and
            autopick rankings retain their existing inputs.
          </Text>
          <ActionButton
            label="Preview preseason rankings"
            onPress={() => void load()}
            loading={busy}
          />
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
          {preview ? (
            <>
              <Text style={ui.body}>{preview.rows.length} position entries</Text>
              {preview.rows.map((row) => (
                <Text key={`${row.athlete_id}:${row.position_group}`} style={ui.body}>
                  {rosterSlotLabel(row.position_group)},{' '}
                  {row.position_rank == null ? 'Unranked' : `#${row.position_rank}`}, {row.name},{' '}
                  {row.projected_points ?? 'Unavailable'} FP
                </Text>
              ))}
              <TextInput
                accessibilityLabel="Ranking publication review reason"
                value={reason}
                onChangeText={setReason}
                maxLength={500}
                multiline
                style={ui.input}
              />
              <ActionButton
                label="Publish reviewed snapshot"
                onPress={() => void publish()}
                disabled={reason.trim().length < 5 || busy}
              />
            </>
          ) : null}
        </Card>
        <View style={{ marginTop: 16 }}>
          <ActionButton label="Back to admin" href="/admin" variant="secondary" />
        </View>
      </View>
    </AppShell>
  );
}
