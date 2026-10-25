import { newCommandKey } from '../../lib/command-key';
import { useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import {
  ActionButton,
  AppShell,
  Card,
  ErrorState,
  LoadingState,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { DraftPlayerPhoto } from '@/components/player-photo';
import { useDraftSetup } from '@/hooks/use-draft-setup';
import { useRequireUser } from '@/hooks/use-route-access';
import { useSession } from '@/providers/session-provider';
import { betaCommand } from '@/lib/web-api';

export default function DraftPreferencesScreen() {
  useRequireUser();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { user } = useSession();
  return user && leagueId ? (
    <PreferencesEditor key={`${user.id}:${leagueId}`} leagueId={leagueId} />
  ) : (
    <AppShell title="Private draft rankings">
      <LoadingState />
    </AppShell>
  );
}

function PreferencesEditor({ leagueId }: { leagueId: string }) {
  const ui = useUiStyles();
  const setup = useDraftSetup(leagueId);
  const [ids, setIds] = useState<string[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const pending = useRef<{ payload: string; key: string } | null>(null);
  const data = setup.data;
  useEffect(() => {
    if (!data || dirty.current) return;
    setIds(data.preferences);
    setVersion(data.preferenceVersion);
  }, [data?.preferences, data?.preferenceVersion]);
  const players = useMemo(
    () => new Map((data?.players ?? []).map((player) => [player.id, player])),
    [data?.players],
  );
  const selected = useMemo(() => new Set(ids), [ids]);
  const query = useDeferredValue(search.trim().toLowerCase());
  const available = useMemo(
    () =>
      (data?.players ?? []).filter(
        (player) =>
          !selected.has(player.id) &&
          player.eligibleForMe &&
          `${player.displayName} ${player.program} ${player.positions.join(' ')}`
            .toLowerCase()
            .includes(query),
      ),
    [data?.players, selected, query],
  );
  const conflict = data && version !== null && data.preferenceVersion !== version;
  const editable = Boolean(data?.editable && !saving);
  const change = (next: string[]) => {
    dirty.current = true;
    setIds(next);
  };
  const move = (index: number, target: number) => {
    if (!editable || target < 0 || target >= ids.length || target === index) return;
    const next = [...ids];
    const [id] = next.splice(index, 1);
    next.splice(target, 0, id!);
    change(next);
    setMessage(`${players.get(id!)?.displayName ?? 'Athlete'} moved to preference ${target + 1}.`);
  };
  const reloadSaved = () => {
    if (!data) return;
    dirty.current = false;
    pending.current = null;
    setIds(data.preferences);
    setVersion(data.preferenceVersion);
    setMessage('Loaded the latest saved list.');
  };
  const save = async () => {
    if (!data?.editable || version === null || conflict || inFlight.current) return;
    const payload = { p_league_id: leagueId, p_athlete_ids: ids, p_expected_version: version };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.payload !== fingerprint)
      pending.current = { payload: fingerprint, key: newCommandKey() };
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await betaCommand<{ version: number }>('save_draft_preferences', {
        ...payload,
        p_idempotency_key: pending.current.key,
      });
      if (result.error) {
        setMessage(result.error + ' Your edits are still here.');
        if (result.status === 409) await setup.reload(true);
      } else if (result.data) {
        pending.current = null;
        setVersion(result.data.version);
        setMessage('Private rankings saved. You do not need to be online for the draft.');
        await setup.reload(true);
        dirty.current = false;
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  if (!data)
    return (
      <AppShell title="Private draft rankings">
        {setup.error ? (
          <ErrorState message={setup.error} onRetry={() => void setup.reload()} />
        ) : (
          <LoadingState label="Loading draft preparation" />
        )}
      </AppShell>
    );
  return (
    <AppShell title="Private draft rankings" eyebrow="Scheduled automatic draft">
      <Card>
        <Text style={ui.body}>
          Rank athletes in the order you prefer. At the cutoff, the system follows snake order and
          takes your first available preference that preserves legal rosters for everyone. If your
          list runs out, it uses the best legal athlete in the approved default rankings.
        </Text>
        <Text style={ui.body}>
          Your list is private. Commissioners see preparation status, not your choices. Restricted
          snapshots remain for 30 days after completion or cancellation for disputes, then expire.
        </Text>
        <Text style={ui.body}>
          Cutoff:{' '}
          {data.scheduledFor
            ? new Intl.DateTimeFormat('en-CA', {
                dateStyle: 'full',
                timeStyle: 'short',
                timeZone: 'America/Toronto',
              }).format(new Date(data.scheduledFor)) + ' Toronto time'
            : 'The commissioner has not scheduled an automatic draft.'}
        </Text>
        {!data.editable ? (
          <Text style={ui.body}>
            Editing is closed. The commissioner must select and schedule automatic drafting before
            you can prepare, or reschedule a blocked setup.
          </Text>
        ) : null}
        {data.blockReason ? (
          <Text accessibilityRole="alert" style={ui.body}>
            {data.blockReason}
          </Text>
        ) : null}
        <ActionButton label="Return to league" href={`/league/${leagueId}`} variant="secondary" />
      </Card>
      <SectionTitle title="Your preference order" detail={`${ids.length} ranked`} />
      <Card>
        {!ids.length ? (
          <Text style={ui.body}>
            No personal rankings yet. Approved legal defaults will be used unless you add
            preferences.
          </Text>
        ) : null}
        {ids.map((id, index) => {
          const player = players.get(id);
          return (
            <View key={id} style={{ gap: 12, paddingVertical: 16 }}>
              <Text style={ui.label}>
                {index + 1}.{' '}
                {player?.displayName ?? 'Previously ranked athlete — currently unavailable'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <ActionButton
                  label={`Move ${player?.displayName ?? 'athlete'} up`}
                  onPress={() => move(index, index - 1)}
                  disabled={!editable || index === 0}
                  variant="secondary"
                />
                <ActionButton
                  label={`Move ${player?.displayName ?? 'athlete'} down`}
                  onPress={() => move(index, index + 1)}
                  disabled={!editable || index === ids.length - 1}
                  variant="secondary"
                />
                <ActionButton
                  label={`Remove ${player?.displayName ?? 'athlete'}`}
                  onPress={() => change(ids.filter((value) => value !== id))}
                  disabled={!editable}
                  variant="ghost"
                />
              </View>
            </View>
          );
        })}
        {conflict ? (
          <Text accessibilityRole="alert" style={ui.body}>
            Another save changed your list. Your edits are retained. Reload the saved list or
            explicitly use these edits with the latest revision.
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <ActionButton
            label="Save private rankings"
            loading={saving}
            disabled={!data.editable || version === null || Boolean(conflict)}
            onPress={() => void save()}
          />
          <ActionButton
            label="Reload saved list — replaces edits"
            onPress={reloadSaved}
            disabled={saving}
            variant="secondary"
          />
          {conflict ? (
            <ActionButton
              label="Use my edits with latest revision"
              onPress={() => {
                setVersion(data.preferenceVersion);
                pending.current = null;
              }}
              variant="secondary"
            />
          ) : null}
        </View>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
        ) : null}
        {setup.error ? (
          <Text accessibilityRole="alert" style={ui.body}>
            {setup.error}
          </Text>
        ) : null}
      </Card>
      <SectionTitle title="Add preferences" />
      <TextInput
        style={ui.input}
        accessibilityLabel="Search athletes for private rankings"
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, program, or position"
      />
      {available.map((player) => (
        <Card key={player.id}>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <DraftPlayerPhoto player={player} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={ui.label}>{player.displayName}</Text>
              <Text style={ui.body}>
                {player.program} · {player.positions.join('/')} · Default rank {player.rank}
              </Text>
            </View>
          </View>
          <ActionButton
            label={`Add ${player.displayName} to preferences`}
            variant="secondary"
            disabled={!editable || ids.length >= 500}
            onPress={() => change([...ids, player.id])}
          />
        </Card>
      ))}
      {!available.length ? (
        <Text style={ui.body}>No matching eligible athletes remain in this view.</Text>
      ) : null}
      {Platform.OS === 'web' ? (
        <p className="draft-help">
          Use Tab to reach controls and Enter or Space to activate them. Ranking does not require
          dragging.
        </p>
      ) : null}
    </AppShell>
  );
}
