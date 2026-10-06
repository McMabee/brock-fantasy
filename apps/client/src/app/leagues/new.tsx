import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BETA_PLAYER_POOL_ID, LEAGUE_SIZES } from '@brock-fantasy/domain';

import { ActionButton, AppShell, Card, Pill, uiStyles } from '@/components/ui';
import { betaCommand } from '@/lib/web-api';
import { colors } from '@/theme';
import { useRequireUser } from '@/hooks/use-route-access';

export default function NewLeagueScreen() {
  useRequireUser();
  const router = useRouter();
  const [name, setName] = useState('');
  const [size, setSize] = useState<(typeof LEAGUE_SIZES)[number]>(8);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const createLeague = async () => {
    if (name.trim().length < 3) {
      setError('Enter a league name of at least three characters.');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await betaCommand<{ league_id: string }>('create_beta_league', {
      p_name: name.trim(),
      p_pool_id: BETA_PLAYER_POOL_ID,
      p_max_members: size,
      p_idempotency_key: `create-${Date.now()}`,
    });
    setLoading(false);
    if (result.error) setError(result.error);
    else if (result.data) router.replace(`/league/${result.data.league_id}`);
  };

  return (
    <AppShell eyebrow="League setup" title="Create your league">
      <Card style={styles.form}>
        <View style={styles.field}>
          <Text style={uiStyles.label}>League name</Text>
          <TextInput
            accessibilityLabel="League name"
            maxLength={60}
            onChangeText={setName}
            placeholder="e.g. Brock Alumni League"
            placeholderTextColor={colors.muted}
            style={uiStyles.input}
            value={name}
          />
        </View>

        <View style={styles.field}>
          <Text style={uiStyles.label}>Season player pool</Text>
          <Text style={styles.poolSummary}>
            One private league across Brock men’s and women’s hockey, basketball, and volleyball.
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={uiStyles.label}>Managers</Text>
          <View style={styles.options}>
            {LEAGUE_SIZES.map((leagueSize) => (
              <Option
                key={leagueSize}
                active={size === leagueSize}
                label={`${leagueSize} teams`}
                onPress={() => setSize(leagueSize)}
              />
            ))}
          </View>
        </View>

        <View style={styles.ruleSummary}>
          <Pill label="HEAD-TO-HEAD · 10 ROUNDS" tone="info" />
          <Text style={styles.ruleText}>
            Each roster has six cross-sport starters and four bench positions. Draft order is
            randomized once, with two-minute snake-draft picks and server-side autopicks.
          </Text>
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <ActionButton label="Cancel" href="/dashboard" variant="ghost" />
          <ActionButton
            label="Create private league"
            onPress={() => void createLeague()}
            loading={loading}
          />
        </View>
      </Card>
    </AppShell>
  );
}

function Option({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[styles.option, active && styles.optionActive]}
    >
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { maxWidth: 840, width: '100%', alignSelf: 'center', gap: 26, padding: 25 },
  field: { gap: 10 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: colors.canvasSoft,
  },
  optionActive: { borderColor: colors.red, backgroundColor: colors.white },
  optionText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  optionTextActive: { color: colors.brand },
  poolSummary: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  ruleSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.canvasSoft,
    padding: 13,
    borderRadius: 10,
  },
  ruleText: { color: colors.muted, fontSize: 11, lineHeight: 17, flex: 1, minWidth: 220 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 },
  error: { color: colors.danger, fontSize: 12 },
});
