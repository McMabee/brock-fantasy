import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, uiStyles } from '@/components/ui';
import { useDraft } from '@/hooks/use-draft';
import { useLeague } from '@/hooks/use-league';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { colors, heading } from '@/theme';
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
  useRequireUser();
  const router = useRouter();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const { demoMode, user } = useSession();
  const leagueData = useLeague(leagueId);
  const draftData = useDraft(leagueData.draftId ?? undefined);
  const [config, setConfig] = useState<DraftConfig | null>(
    demoMode ? { rounds: 4, pickSeconds: 30 } : null,
  );
  const [scheduleStart, setScheduleStart] = useState(
    new Date(Date.now() + 7 * 86_400_000).toISOString(),
  );
  const [cycles, setCycles] = useState('2');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const authorized = demoMode || leagueData.league?.commissionerId === user?.id;

  useEffect(() => {
    if (demoMode || !supabase || !leagueData.league) return;
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
  }, [demoMode, leagueData.league]);

  const startDraft = async () => {
    if (!config || !leagueId) return;
    if (!supabase) {
      router.push('/draft/demo-draft');
      return;
    }
    setWorking(true);
    const result = (await supabase.rpc('start_draft', {
      p_league_id: leagueId,
      p_rounds: config.rounds,
      p_pick_seconds: config.pickSeconds,
      p_idempotency_key: `start-draft-${Date.now()}`,
    })) as { data: { draft_id: string } | null; error: { message: string } | null };
    setWorking(false);
    if (result.error) setMessage(result.error.message);
    else if (result.data) router.push(`/draft/${result.data.draft_id}`);
  };

  const changeDraftStatus = async (action: 'pause' | 'resume') => {
    if (!supabase || !leagueData.draftId) {
      setMessage(`Demo draft ${action}d.`);
      return;
    }
    setWorking(true);
    const result = (await supabase.rpc('set_draft_status', {
      p_draft_id: leagueData.draftId,
      p_action: action,
      p_idempotency_key: `draft-${action}-${Date.now()}`,
    })) as { error: { message: string } | null };
    setWorking(false);
    if (result.error) setMessage(result.error.message);
    else await draftData.reload();
  };

  const generateSchedule = async () => {
    if (!leagueId) return;
    if (!supabase) {
      setMessage('Demo matchup schedule generated.');
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
    const result = (await supabase.rpc('generate_matchup_schedule', {
      p_league_id: leagueId,
      p_starts_at: new Date(scheduleStart).toISOString(),
      p_cycles: parsedCycles,
      p_idempotency_key: `matchups-${Date.now()}`,
    })) as { error: { message: string } | null };
    setWorking(false);
    if (result.error) setMessage(result.error.message);
    else {
      setMessage('Matchup schedule generated.');
      await leagueData.reload();
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
            disabled={!config || leagueData.teams.length < 2}
            loading={working}
          />
        ) : (
          <View style={styles.actions}>
            <ActionButton
              label="Open draft"
              href={`/draft/${leagueData.draftId}`}
              variant="secondary"
            />
            {draftData.draft?.status === 'active' ? (
              <ActionButton
                label="Pause draft"
                onPress={() => void changeDraftStatus('pause')}
                variant="danger"
              />
            ) : null}
            {draftData.draft?.status === 'paused' ? (
              <ActionButton label="Resume draft" onPress={() => void changeDraftStatus('resume')} />
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
              disabled={leagueData.matchups.length > 0 || !leagueData.draftId}
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
      <View style={styles.back}>
        <ActionButton
          label="Back to league"
          href={`/league/${leagueId ?? 'demo-league'}`}
          variant="ghost"
        />
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  message: { color: colors.brand, fontSize: 12, marginBottom: 10 },
  card: { maxWidth: 720, gap: 14 },
  title: { ...heading, fontSize: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  field: { gap: 7 },
  note: { color: colors.muted, fontSize: 10 },
  back: { alignItems: 'flex-end', marginTop: 16 },
});
