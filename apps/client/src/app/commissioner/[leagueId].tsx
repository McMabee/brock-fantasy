import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { torontoDateFields, torontoDateTime } from '@brock-fantasy/domain';

import { ActionButton, AppShell, Card, Pill, SectionTitle, useUiStyles } from '@/components/ui';
import { useDraft } from '@/hooks/use-draft';
import { useLeague } from '@/hooks/use-league';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { useSession } from '@/providers/session-provider';
import { heading } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

interface DraftConfig {
  rounds: number;
  pickSeconds: number;
}

interface RulesetRow {
  draft_config: Record<string, unknown>;
}

interface SlotCountRow {
  slot_count: number;
}

export default function CommissionerScreen() {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  const colors = useThemeColors();
  useRequireUser();
  const router = useRouter();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { user } = useSession();
  const leagueData = useLeague(leagueId);
  const draftData = useDraft(leagueData.draftId ?? undefined);
  const [config, setConfig] = useState<DraftConfig | null>(null);
  const [scheduleStart, setScheduleStart] = useState(
    new Date(Date.now() + 7 * 86_400_000).toISOString(),
  );
  const [cycles, setCycles] = useState('2');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<{
    leagueId: string;
    name: string;
    version: number;
    key: string;
  } | null>(null);
  const [confirmationName, setConfirmationName] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [plannedTime, setPlannedTime] = useState('19:00');
  useEffect(() => {
    const scheduled = leagueData.league?.draftScheduledFor;
    if (scheduled) {
      const fields = torontoDateFields(scheduled);
      setPlannedDate(fields.date);
      setPlannedTime(fields.time);
    } else setPlannedDate('');
  }, [leagueData.league?.draftScheduledFor]);
  const saveDraftSchedule = async (clear = false) => {
    if (!leagueId || !leagueData.league) return;
    const scheduled = clear ? null : torontoDateTime(plannedDate, plannedTime);
    if (!clear && !scheduled) {
      setMessage('Choose a valid draft date and time.');
      return;
    }
    setWorking(true);
    const result = await betaCommand('schedule_league_draft', {
      p_league_id: leagueId,
      p_scheduled_for: scheduled,
      p_expected_version: leagueData.league.stateVersion,
      p_idempotency_key: crypto.randomUUID(),
    });
    setWorking(false);
    if (result.error) setMessage(result.error);
    else {
      setMessage(
        clear ? 'Draft schedule cleared.' : 'Draft time saved. Members will receive reminders.',
      );
      await leagueData.reload();
    }
  };
  const [deleting, setDeleting] = useState(false);
  const deletePending = useRef(false);
  const authorized = Boolean(user && leagueData.league?.commissionerId === user.id);

  useEffect(() => {
    if (!supabase || !leagueData.league) return;
    const client = supabase;
    const load = async () => {
      const [rulesetResult, slotsResult] = await Promise.all([
        client
          .from('scoring_rulesets')
          .select('draft_config')
          .eq('id', leagueData.league?.rulesetId ?? '')
          .single(),
        client
          .from('roster_slot_rules')
          .select('slot_count')
          .eq('ruleset_id', leagueData.league?.rulesetId ?? ''),
      ]);
      const error = rulesetResult.error ?? slotsResult.error;
      if (error) {
        setMessage(error.message);
        return;
      }
      if (!rulesetResult.data) {
        setMessage('The approved ruleset could not be loaded.');
        return;
      }
      const ruleset: RulesetRow = rulesetResult.data;
      const seconds = ruleset.draft_config.pickSeconds;
      const rounds = (slotsResult.data as SlotCountRow[]).reduce(
        (total, slot) => total + slot.slot_count,
        0,
      );
      if (typeof seconds !== 'number' || rounds < 1) {
        setMessage('The approved ruleset has an incomplete draft configuration.');
        return;
      }
      setConfig({ rounds, pickSeconds: seconds });
    };
    void load();
  }, [leagueData.league]);

  const startDraft = async () => {
    if (!config || !leagueId) return;
    if (!supabase) {
      setMessage('Draft service is temporarily unavailable. Please try again shortly.');
      return;
    }
    setWorking(true);
    const result = await betaCommand<{ draft_id: string }>('start_draft', {
      p_league_id: leagueId,
      p_rounds: config.rounds,
      p_pick_seconds: config.pickSeconds,
      p_idempotency_key: `start-draft-${Date.now()}`,
    });
    setWorking(false);
    if (result.error) setMessage(result.error);
    else if (result.data) router.push(`/draft/${result.data.draft_id}`);
  };

  const changeDraftStatus = async (action: 'pause' | 'resume') => {
    if (!supabase || !leagueData.draftId) {
      setMessage('Draft controls are temporarily unavailable. Please try again shortly.');
      return;
    }
    setWorking(true);
    const result = await betaCommand('set_draft_status', {
      p_draft_id: leagueData.draftId,
      p_status: action === 'pause' ? 'paused' : 'active',
      p_idempotency_key: `draft-${action}-${Date.now()}`,
    });
    setWorking(false);
    if (result.error) setMessage(result.error);
    else await draftData.reload();
  };

  const generateSchedule = async () => {
    if (!leagueId) return;
    if (!supabase) {
      setMessage('Schedule generation is temporarily unavailable. Please try again shortly.');
      return;
    }
    const parsedCycles = Number(cycles);
    if (
      !Number.isInteger(parsedCycles) ||
      parsedCycles < 1 ||
      Number.isNaN(Date.parse(scheduleStart))
    ) {
      setMessage('Enter a valid ISO start date and cycle count.');
      return;
    }
    setWorking(true);
    const result = await betaCommand('generate_matchup_schedule', {
      p_league_id: leagueId,
      p_starts_at: new Date(scheduleStart).toISOString(),
      p_cycles: parsedCycles,
      p_idempotency_key: `matchups-${Date.now()}`,
    });
    setWorking(false);
    if (result.error) setMessage(result.error);
    else {
      setMessage('Matchup schedule generated.');
      await leagueData.reload();
    }
  };

  const deleteLeague = async () => {
    if (
      !authorized ||
      !leagueId ||
      !deletion ||
      deletion.leagueId !== leagueId ||
      confirmationName.trim() !== deletion.name ||
      deletePending.current ||
      working
    )
      return;
    deletePending.current = true;
    setDeleting(true);
    setMessage(null);
    try {
      const result = await betaCommand<{ league_id: string; deleted: boolean }>('delete_league', {
        p_league_id: leagueId,
        p_confirmation_name: confirmationName.trim(),
        p_expected_version: deletion.version,
        p_idempotency_key: deletion.key,
      });
      if (result.error) setMessage(result.error);
      else if (result.data?.deleted && result.data.league_id === leagueId)
        router.replace('/dashboard');
      else setMessage('The league could not be deleted. Please try again.');
    } catch {
      setMessage('Unable to reach the league service. Please try again.');
    } finally {
      deletePending.current = false;
      setDeleting(false);
    }
  };

  if (!authorized && !leagueData.loading) {
    return (
      <AppShell eyebrow="Restricted" title="Commissioner access required">
        <Card>
          <Text style={uiStyles.body}>Only this league’s commissioner can run setup commands.</Text>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="League authority"
      title="Commissioner controls"
      action={<Pill label="AUDITED COMMANDS" tone="warning" />}
    >
      {message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <SectionTitle title="Draft" detail={`${leagueData.teams.length} managers`} />
      <Card style={styles.card}>
        {!leagueData.draftId ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.title}>Planned draft time</Text>
            <Text style={uiStyles.body}>
              America/Toronto. Reminders use this time; you start the draft manually.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {Platform.OS === 'web' ? (
                <>
                  <label style={{ color: colors.text }}>
                    Draft date{' '}
                    <input
                      aria-label="Draft date"
                      type="date"
                      value={plannedDate}
                      onChange={(e) => setPlannedDate(e.currentTarget.value)}
                      disabled={working}
                    />
                  </label>
                  <label style={{ color: colors.text }}>
                    Draft time{' '}
                    <input
                      aria-label="Draft time"
                      type="time"
                      value={plannedTime}
                      onChange={(e) => setPlannedTime(e.currentTarget.value)}
                      disabled={working}
                    />
                  </label>
                </>
              ) : (
                <>
                  <TextInput
                    accessibilityLabel="Draft date YYYY-MM-DD"
                    style={uiStyles.input}
                    value={plannedDate}
                    onChangeText={setPlannedDate}
                    placeholder="YYYY-MM-DD"
                  />
                  <TextInput
                    accessibilityLabel="Draft time HH:mm"
                    style={uiStyles.input}
                    value={plannedTime}
                    onChangeText={setPlannedTime}
                  />
                </>
              )}
            </View>
            <View style={styles.actions}>
              <ActionButton
                label="Save draft time"
                onPress={() => void saveDraftSchedule()}
                disabled={working || deleting || !plannedDate}
                variant="secondary"
              />
              <ActionButton
                label="Clear draft time"
                onPress={() => void saveDraftSchedule(true)}
                disabled={working || deleting || !leagueData.league?.draftScheduledFor}
                variant="secondary"
              />
            </View>
          </View>
        ) : null}
        <Text style={styles.title}>{leagueData.league?.name ?? 'Loading league…'}</Text>
        <Text style={uiStyles.body}>
          {config
            ? `${config.rounds} rounds · ${config.pickSeconds} seconds per pick · snake order`
            : 'Loading approved rules…'}
        </Text>
        {!leagueData.draftId ? (
          <ActionButton
            label="Start draft"
            onPress={() => void startDraft()}
            disabled={!config || leagueData.teams.length < 2 || deleting}
            loading={working}
          />
        ) : (
          <View style={styles.actions}>
            <ActionButton
              label="Open draft"
              href={`/draft/${leagueData.draftId}`}
              variant="secondary"
              disabled={deleting}
            />
            {draftData.draft?.status === 'active' ? (
              <ActionButton
                label="Pause draft"
                onPress={() => void changeDraftStatus('pause')}
                variant="danger"
                disabled={working || deleting}
              />
            ) : null}
            {draftData.draft?.status === 'paused' ? (
              <ActionButton
                label="Resume draft"
                onPress={() => void changeDraftStatus('resume')}
                disabled={working || deleting}
              />
            ) : null}
          </View>
        )}
      </Card>

      {leagueData.league?.format === 'head_to_head' ? (
        <>
          <SectionTitle title="Matchup schedule" detail="Round-robin periods from approved rules" />
          <Card style={styles.card}>
            <View style={styles.field}>
              <Text style={uiStyles.label}>First period starts (ISO 8601)</Text>
              <TextInput
                accessibilityLabel="First fantasy period start"
                autoCapitalize="none"
                onChangeText={setScheduleStart}
                style={uiStyles.input}
                value={scheduleStart}
              />
            </View>
            <View style={styles.field}>
              <Text style={uiStyles.label}>Round-robin cycles</Text>
              <TextInput
                accessibilityLabel="Round robin cycle count"
                inputMode="numeric"
                onChangeText={setCycles}
                style={uiStyles.input}
                value={cycles}
              />
            </View>
            <ActionButton
              label="Generate schedule"
              onPress={() => void generateSchedule()}
              disabled={leagueData.matchups.length > 0 || !leagueData.draftId || deleting}
              loading={working}
            />
            {leagueData.matchups.length > 0 ? (
              <Text style={styles.note}>
                {leagueData.matchups.length} matchups already scheduled.
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}
      {authorized && leagueData.league ? (
        <>
          <SectionTitle title="Delete league" detail="Commissioner only" />
          <Card style={styles.card}>
            <Text style={uiStyles.body}>
              Permanently delete {leagueData.league.name} and every manager’s fantasy team, draft,
              roster, matchups, and league chat. This cannot be undone.
            </Text>
            {deletion?.leagueId === leagueId ? (
              <>
                <Text accessibilityRole="header" style={styles.title}>
                  Confirm league deletion
                </Text>
                <View style={styles.field}>
                  <Text style={uiStyles.label}>Type “{deletion.name}” to confirm</Text>
                  <TextInput
                    accessibilityLabel="League name to confirm deletion"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!deleting}
                    maxLength={60}
                    onChangeText={setConfirmationName}
                    style={uiStyles.input}
                    value={confirmationName}
                  />
                </View>
                <View style={styles.actions}>
                  <ActionButton
                    label="Cancel deletion"
                    variant="secondary"
                    disabled={deleting}
                    onPress={() => {
                      setDeletion(null);
                      setConfirmationName('');
                    }}
                  />
                  <ActionButton
                    label="Permanently delete league"
                    variant="danger"
                    loading={deleting}
                    disabled={working || confirmationName.trim() !== deletion.name}
                    onPress={() => void deleteLeague()}
                  />
                </View>
              </>
            ) : (
              <ActionButton
                label="Delete league"
                variant="danger"
                disabled={working || leagueData.league.stateVersion === undefined}
                onPress={() => {
                  if (!leagueData.league || leagueData.league.stateVersion === undefined) return;
                  setMessage(null);
                  setConfirmationName('');
                  setDeletion({
                    leagueId: leagueData.league.id,
                    name: leagueData.league.name,
                    version: leagueData.league.stateVersion,
                    key: `delete-league-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  });
                }}
              />
            )}
          </Card>
        </>
      ) : null}
      <View style={styles.back}>
        <ActionButton
          label="Back to league"
          href={leagueId ? `/league/${leagueId}` : '/dashboard'}
          variant="ghost"
          disabled={deleting}
        />
      </View>
    </AppShell>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    message: { fontFamily: 'Inter', color: colors.text, fontSize: 12, marginBottom: 10 },
    card: { maxWidth: 720, gap: 14 },
    title: { ...heading, fontSize: 20, color: colors.text },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
    field: { gap: 7 },
    note: { fontFamily: 'Inter', color: colors.muted, fontSize: 10 },
    back: { alignItems: 'flex-end', marginTop: 16 },
  });
