import { newCommandKey } from '../lib/command-key';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { DraftSetupPanel } from './draft-setup-panel';

import { MatchupSetup } from './matchup-setup';
import { ActionButton, Card, SectionTitle, useUiStyles } from '@/components/ui';
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

export function CommissionerControls({
  leagueId,
  leagueData,
}: {
  leagueId: string;
  leagueData: ReturnType<typeof useLeague>;
}) {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  useRequireUser();
  const router = useRouter();
  const { user } = useSession();
  const [config, setConfig] = useState<DraftConfig | null>(null);
  const [pickDuration, setPickDuration] = useState('');
  const [scheduleStart, setScheduleStart] = useState(
    new Date(Date.now() + 7 * 86_400_000).toISOString(),
  );
  const [cycles, setCycles] = useState('1');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<{
    leagueId: string;
    name: string;
    version: number;
    key: string;
  } | null>(null);
  const [confirmationName, setConfirmationName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deletePending = useRef(false);
  const authorized = Boolean(user && leagueData.league?.commissionerId === user.id);

  const rulesetId = leagueData.league?.rulesetId;
  const savedPickSeconds = leagueData.league?.draftPickSeconds;
  useEffect(() => {
    if (!supabase || !rulesetId) return;
    let active = true;
    const client = supabase;
    const load = async () => {
      const [rulesetResult, slotsResult] = await Promise.all([
        client.from('scoring_rulesets').select('draft_config').eq('id', rulesetId).single(),
        client.from('roster_slot_rules').select('slot_count').eq('ruleset_id', rulesetId),
      ]);
      if (!active) return;
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
      const seconds = savedPickSeconds ?? ruleset.draft_config.pickSeconds;
      const rounds = (slotsResult.data as SlotCountRow[]).reduce(
        (total, slot) => total + slot.slot_count,
        0,
      );
      if (typeof seconds !== 'number' || rounds < 1) {
        setMessage('The approved ruleset has an incomplete draft configuration.');
        return;
      }
      setConfig({ rounds, pickSeconds: seconds });
      setPickDuration(String(seconds));
    };
    void load();
    return () => {
      active = false;
    };
  }, [leagueId, rulesetId, savedPickSeconds]);

  const validPickDuration =
    /^\d+$/.test(pickDuration) && Number(pickDuration) >= 20 && Number(pickDuration) <= 86400;
  const savePickDuration = async () => {
    if (!leagueData.league || !validPickDuration || working) return;
    setWorking(true);
    try {
      const result = await betaCommand('set_league_pick_duration', {
        p_league_id: leagueId,
        p_pick_seconds: Number(pickDuration),
        p_expected_version: leagueData.league.stateVersion,
        p_idempotency_key: newCommandKey(),
      });
      if (result.error) setMessage(result.error);
      else {
        setMessage('Pick timer saved. Autodraft takes over when this time expires.');
        await leagueData.reload();
      }
    } catch {
      setMessage('Unable to save the pick timer. Refresh and try again.');
    } finally {
      setWorking(false);
    }
  };

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
      p_idempotency_key: newCommandKey(),
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
      p_idempotency_key: newCommandKey(),
    });
    setWorking(false);
    if (result.error) setMessage(result.error);
    else await leagueData.reload();
  };

  const generateSchedule = async () => {
    if (!leagueId) return;
    if (!supabase) {
      setMessage('Schedule generation is temporarily unavailable. Please try again shortly.');
      return;
    }
    const parsedCycles = leagueData.teams.length === 8 ? 1 : Number(cycles);
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
      p_idempotency_key: newCommandKey(),
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
      <>
        <Card>
          <Text style={uiStyles.body}>Only this league’s commissioner can run setup commands.</Text>
        </Card>
      </>
    );
  }

  return (
    <View style={{ gap: 18 }}>
      {message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <SectionTitle title="Draft" detail={`${leagueData.teams.length} managers`} />
      <Card style={styles.card}>
        {!leagueData.draftId ? (
          <DraftSetupPanel leagueId={leagueId} onSaved={leagueData.reload} />
        ) : null}
        <Text style={styles.title}>{leagueData.league?.name ?? 'Loading league…'}</Text>
        <Text style={uiStyles.body}>
          {config
            ? `${config.rounds} rounds, ${config.pickSeconds} seconds per pick, snake order`
            : 'Loading approved rules…'}
        </Text>
        {!leagueData.draftId &&
        leagueData.league?.status === 'setup' &&
        leagueData.league.draftMode !== 'scheduled_auto' ? (
          <View style={styles.field}>
            <Text style={uiStyles.label}>Seconds per pick</Text>
            <Text style={uiStyles.body}>
              Set how long each manager has to pick before autodraft takes over. Choose a whole
              number from 20 to 86,400 seconds.
            </Text>
            <TextInput
              accessibilityLabel="Seconds per draft pick"
              inputMode="numeric"
              value={pickDuration}
              onChangeText={setPickDuration}
              editable={!working && !deleting}
              maxLength={5}
              style={uiStyles.input}
            />
            {pickDuration && !validPickDuration ? (
              <Text accessibilityRole="alert" style={uiStyles.body}>
                Enter a whole number from 20 to 86,400 seconds.
              </Text>
            ) : null}
            <ActionButton
              label="Save pick timer"
              onPress={() => void savePickDuration()}
              disabled={
                !config ||
                !validPickDuration ||
                Number(pickDuration) === config.pickSeconds ||
                working ||
                deleting
              }
              variant="secondary"
            />
          </View>
        ) : null}
        {!leagueData.draftId && leagueData.league?.draftMode !== 'scheduled_auto' ? (
          <ActionButton
            label="Start draft"
            onPress={() => void startDraft()}
            disabled={
              !config ||
              !leagueData.league?.draftMode ||
              !leagueData.league?.draftMode ||
              Number(pickDuration) !== config.pickSeconds ||
              leagueData.teams.length < 2 ||
              deleting
            }
            loading={working}
          />
        ) : (
          <View style={styles.actions}>
            {leagueData.draftStatus === 'complete' ? (
              <ActionButton
                label="View draft results"
                href={`/draft-results/${leagueData.draftId}`}
                variant="secondary"
              />
            ) : leagueData.draftStatus ? (
              <ActionButton
                label="Open draft room"
                href={`/draft/${leagueData.draftId}`}
                variant="secondary"
                disabled={deleting}
              />
            ) : null}
            {leagueData.draftStatus === 'active' ? (
              <ActionButton
                label="Pause draft"
                onPress={() => void changeDraftStatus('pause')}
                variant="danger"
                disabled={working || deleting}
              />
            ) : null}
            {leagueData.draftStatus === 'paused' ? (
              <ActionButton
                label="Resume draft"
                onPress={() => void changeDraftStatus('resume')}
                disabled={working || deleting}
              />
            ) : null}
          </View>
        )}
      </Card>

      {leagueData.league?.playerPoolId ? (
        leagueData.draftStatus === 'complete' && !leagueData.matchups.length ? (
          <MatchupSetup
            leagueId={leagueId}
            teams={leagueData.teams}
            entryPeriodAvailable={Boolean(leagueData.league?.firstScoringPeriodId)}
            onCreated={leagueData.reload}
          />
        ) : (
          <Text style={uiStyles.body}>
            {leagueData.matchups.length
              ? 'Your matchup schedule was created automatically after the draft.'
              : 'Matchups will be created automatically when the draft finishes.'}
          </Text>
        )
      ) : leagueData.league?.format === 'head_to_head' ? (
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
                value={leagueData.teams.length === 8 ? '1' : cycles}
                editable={leagueData.teams.length !== 8}
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
          <Card style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
              Delete league
            </Text>
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
                    key: newCommandKey(),
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
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    message: { fontFamily: 'Inter', color: colors.text, fontSize: 12, marginBottom: 10 },
    card: { width: '100%', gap: 14 },
    title: { ...heading, fontSize: 20, color: colors.text },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
    field: { gap: 7 },
    note: { fontFamily: 'Inter', color: colors.muted, fontSize: 10 },
    back: { alignItems: 'flex-end', marginTop: 16 },
  });
