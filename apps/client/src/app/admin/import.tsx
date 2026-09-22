import { parseProviderCsv } from '@brock-fantasy/domain';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, useUiStyles } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAppTheme, useThemedStyles, type ThemeColors } from '@/theme';
import { useRequireAdmin } from '@/hooks/use-route-access';

type ImportFormat = 'json' | 'csv';

export default function AdminImportScreen() {
  useRequireAdmin();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const [format, setFormat] = useState<ImportFormat>('json');
  const [payload, setPayload] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const ingest = async () => {
    setResult(null);
    let parsed: unknown;
    try {
      parsed = format === 'csv' ? parseProviderCsv(payload) : (JSON.parse(payload) as unknown);
    } catch (error) {
      setResult(
        error instanceof Error ? error.message : `The import is not valid ${format.toUpperCase()}.`,
      );
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setResult('The import must be a top-level JSON object.');
      return;
    }
    if (!supabase) {
      setResult('Demo validation passed. Configure Supabase to persist and score this snapshot.');
      return;
    }
    setWorking(true);
    const response = (await supabase.functions.invoke<unknown>('ingest-sports-data', {
      body: parsed as Record<string, unknown>,
    })) as { data: unknown; error: { message: string } | null };
    setWorking(false);
    setResult(response.error ? response.error.message : JSON.stringify(response.data, null, 2));
  };

  return (
    <AppShell
      eyebrow="Administrator import"
      title="Ingest sports data"
      action={<Pill label="IMMUTABLE RAW RECEIPT" tone="warning" />}
    >
      <Card style={styles.card}>
        <SectionTitle
          title="Provider or manual snapshot"
          detail="JSON and CSV use the same replay pipeline"
        />
        <Text style={uiStyles.body}>
          The payload is stored before validation. Known provider/game/athlete mappings and a
          complete approved stat schema are required before points commit.
        </Text>
        <View accessibilityRole="radiogroup" style={styles.formatRow}>
          {(['json', 'csv'] as const).map((item) => (
            <Pressable
              aria-checked={format === item}
              accessibilityRole="radio"
              accessibilityState={{ checked: format === item }}
              key={item}
              onPress={() => {
                setFormat(item);
                setPayload('');
                setResult(null);
              }}
              style={[styles.formatOption, format === item && styles.formatOptionActive]}
            >
              <Text
                style={[styles.formatOptionText, format === item && styles.formatOptionTextActive]}
              >
                {item.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
        {format === 'csv' ? (
          <Text style={styles.hint}>
            One player per row. Use provider, providerGameId, capturedAt, gameStatus,
            providerAthleteId, athleteName, teamProviderId, optional revision/position, and one or
            more stats.&lt;key&gt; columns.
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={`Sports data ${format.toUpperCase()} payload`}
          autoCapitalize="none"
          multiline
          onChangeText={setPayload}
          placeholder={
            format === 'json'
              ? '{"provider":"approved-provider", ...}'
              : 'provider,providerGameId,capturedAt,gameStatus,...,stats.goals'
          }
          placeholderTextColor={colors.muted}
          style={[uiStyles.input, styles.editor]}
          value={payload}
        />
        <View style={styles.actions}>
          <ActionButton label="Back to operations" href="/admin" variant="ghost" />
          <ActionButton
            label={format === 'csv' ? 'Convert, validate & replay' : 'Validate, normalize & replay'}
            onPress={() => void ingest()}
            disabled={!payload.trim()}
            loading={working}
          />
        </View>
      </Card>
      {result ? (
        <Card style={styles.result}>
          <Text selectable style={styles.resultText}>
            {result}
          </Text>
        </Card>
      ) : null}
    </AppShell>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: { maxWidth: 850, gap: 14 },
    formatRow: { flexDirection: 'row', gap: 8 },
    formatOption: {
      borderColor: colors.border,
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 9,
    },
    formatOptionActive: { backgroundColor: colors.brand, borderColor: colors.brand },
    formatOptionText: { color: colors.muted, fontSize: 10, fontWeight: '900' },
    formatOptionTextActive: { color: colors.onBrand },
    hint: { color: colors.muted, fontSize: 11, lineHeight: 17 },
    editor: { minHeight: 280, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 11 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
    result: { maxWidth: 850, marginTop: 12, backgroundColor: colors.canvasSoft },
    resultText: { color: colors.brand, fontFamily: 'monospace', fontSize: 10, lineHeight: 16 },
  });

const useStyles = () => useThemedStyles(createStyles);
