import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { ActionButton, Card, SectionTitle, useUiStyles } from './ui';
import { CommissionerControls } from './commissioner-controls';
import type { useLeague } from '@/hooks/use-league';
import { useSession } from '@/providers/session-provider';
import { betaCommand } from '@/lib/web-api';
import { useThemeColors } from '@/providers/theme-provider';
import { RulesLink } from './rules-link';

export function LeagueSettings({ data }: { data: ReturnType<typeof useLeague> }) {
  const styles = useUiStyles();
  const colors = useThemeColors();
  const { user } = useSession();
  const team = data.teams.find((item) => item.id === data.myTeamId);
  const [name, setName] = useState(team?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setName(team?.name ?? ''), [team?.id, team?.name]);
  const save = async () => {
    if (!data.league || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await betaCommand('rename_my_fantasy_team', {
        p_league_id: data.league.id,
        p_name: name.trim(),
        p_idempotency_key: `team-name-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      setMessage(result.error ?? 'Team name saved.');
      if (!result.error) await data.reload();
    } catch {
      setMessage('Unable to save your team name. Try again.');
    } finally {
      setSaving(false);
    }
  };
  if (!data.league) return null;
  return (
    <View style={{ gap: 18 }}>
      <SectionTitle title="Manager settings" />
      <Card style={{ gap: 14 }}>
        {team ? (
          <>
            <Text style={styles.label}>Your team name</Text>
            <TextInput
              accessibilityLabel="Your team name"
              style={styles.input}
              value={name}
              onChangeText={setName}
              maxLength={60}
              placeholderTextColor={colors.muted}
            />
            <ActionButton
              label="Save team name"
              loading={saving}
              disabled={name.trim().length < 3 || name.trim() === team.name}
              onPress={() => void save()}
            />
          </>
        ) : null}
        {message ? (
          <Text accessibilityRole="alert" style={styles.body}>
            {message}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <ActionButton
            label="Manage lineup"
            href={`/${data.league.playerPoolId ? 'lineup-multisport' : 'lineup'}/${data.league.id}`}
            variant="secondary"
          />
          <ActionButton
            label="Free agents, waivers & trades"
            href={`/transactions/${data.league.id}`}
            variant="secondary"
          />
          <ActionButton label="Account settings" href="/account" variant="ghost" />
          <RulesLink label="League rules & how to play" />
        </View>
      </Card>
      <SectionTitle title="Draft" />
      <Card style={{ gap: 14 }}>
        {data.draftStatus === 'complete' && data.draftId ? (
          <ActionButton
            label="View draft results"
            href={`/draft-results/${data.draftId}`}
            variant="secondary"
          />
        ) : (
          <>
            <Text style={styles.body}>
              {data.draftId
                ? 'Draft results will be available when the draft finishes.'
                : 'The commissioner will set up your draft.'}
            </Text>
            {data.draftId &&
            data.draftStatus &&
            ['active', 'paused', 'scheduled'].includes(data.draftStatus) ? (
              <ActionButton
                label="Open draft room"
                href={`/draft/${data.draftId}`}
                variant="secondary"
              />
            ) : null}
          </>
        )}
      </Card>
      {data.league.commissionerId === user?.id ? (
        <>
          <SectionTitle title="Commissioner settings" detail="Only visible to you" />
          <CommissionerControls leagueId={data.league.id} leagueData={data} />
        </>
      ) : null}
    </View>
  );
}
