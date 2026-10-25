import { newCommandKey } from '../../lib/command-key';
import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { ActionButton, AppShell, Card, useUiStyles } from '@/components/ui';
import { AdminAccess } from '@/components/admin-access';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { betaCommand } from '@/lib/web-api';

interface Batch {
  batch_id: string;
  input_hash: string;
  rows: {
    athlete_id: string;
    athlete_name: string;
    identity_evidence: { historical_player_id: string };
    opponent: string;
    played_at: string;
    complete: boolean;
    missing_stats: string[];
    fantasy_points: number | null;
    source_url: string;
  }[];
}
export default function HistoricalPublicationScreen() {
  const access = useRequireAdmin(),
    ui = useUiStyles(),
    key = useRef('');
  const [input, setInput] = useState(''),
    [batch, setBatch] = useState<Batch | null>(null),
    [reason, setReason] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  const stage = async () => {
    if (busy) return;
    setBusy(true);
    setBatch(null);
    try {
      const records: unknown = JSON.parse(input);
      if (!Array.isArray(records)) throw new Error('Paste the appearance records JSON array');
      const result = await betaCommand<Batch>('stage_historical_game_logs', { p_records: records });
      if (result.error) setMessage(result.error);
      else {
        setBatch(result.data);
        setPage(0);
        key.current = newCommandKey();
        setMessage(
          'Review identities, source box scores, missing statistics and coverage before publishing.',
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to stage this archive');
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!batch || busy) return;
    setBusy(true);
    try {
      const result = await betaCommand<{ published_count: number }>(
        'publish_historical_game_logs',
        {
          p_batch_id: batch.batch_id,
          p_expected_hash: batch.input_hash,
          p_reason: reason,
          p_idempotency_key: key.current,
        },
      );
      setMessage(
        result.error ?? `${result.data?.published_count} historical appearances published.`,
      );
      if (!result.error) setBatch(null);
    } catch {
      setMessage('Publication could not be confirmed. Retry to safely retrieve the same result.');
    } finally {
      setBusy(false);
    }
  };
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell title="Review historical game logs">
      <View style={{ gap: 20 }}>
        <Card style={{ gap: 14 }}>
          <Text style={ui.body}>
            Use the official-source research output. The server validates current participation,
            career identity evidence and archival dates, then calculates points using the current
            rules. This archive is isolated from live scoring.
          </Text>
          <TextInput
            accessibilityLabel="Historical appearance records JSON"
            value={input}
            onChangeText={(value) => {
              setInput(value);
              setBatch(null);
            }}
            multiline
            maxLength={10000000}
            style={[ui.input, { minHeight: 160 }]}
          />
          <ActionButton
            label="Validate and preview historical batch"
            onPress={() => void stage()}
            loading={busy}
            disabled={!input.trim() || busy}
          />
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
          {batch ? (
            <>
              <Text style={ui.title}>
                {batch.rows.length} appearances, {batch.rows.filter((row) => row.complete).length}{' '}
                with complete scoring inputs
              </Text>
              {batch.rows.slice(page * 50, (page + 1) * 50).map((row) => (
                <View
                  key={`${row.athlete_id}:${row.source_url}`}
                  style={{ gap: 4, paddingVertical: 8 }}
                >
                  <Text style={ui.body}>
                    {row.athlete_name}, {row.played_at}, {row.opponent}
                  </Text>
                  <Text style={ui.body}>
                    {row.complete
                      ? `${row.fantasy_points} FP under current rules`
                      : `Incomplete: ${row.missing_stats.join(', ')}`}
                  </Text>
                  <Text selectable style={ui.body}>
                    {row.source_url}
                  </Text>
                </View>
              ))}
              <Text style={ui.body}>
                Page {page + 1} of {Math.ceil(batch.rows.length / 50)}, 50 appearances per page
              </Text>
              <View style={{ gap: 10 }}>
                <ActionButton
                  label="Previous historical appearances"
                  onPress={() => setPage((value) => value - 1)}
                  disabled={page === 0}
                  variant="secondary"
                />
                <ActionButton
                  label="Next historical appearances"
                  onPress={() => setPage((value) => value + 1)}
                  disabled={(page + 1) * 50 >= batch.rows.length}
                  variant="secondary"
                />
              </View>
              <TextInput
                accessibilityLabel="Historical publication review reason"
                value={reason}
                onChangeText={setReason}
                maxLength={500}
                style={ui.input}
              />
              <ActionButton
                label="Publish reviewed historical batch"
                onPress={() => void publish()}
                disabled={reason.trim().length < 5 || busy}
              />
            </>
          ) : null}
        </Card>
        <ActionButton label="Back to admin" href="/admin" variant="secondary" />
      </View>
    </AppShell>
  );
}
