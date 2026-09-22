import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppShell, Card, Pill, SectionTitle, useUiStyles } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAppTheme, useThemedStyles, type ThemeColors } from '@/theme';
import { useRequireAdmin } from '@/hooks/use-route-access';

export default function AdminImportScreen() {
  useRequireAdmin();
  const { colors } = useAppTheme();
  const styles = useStyles();
  const uiStyles = useUiStyles();
  const [payload, setPayload] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const ingest = async () => {
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload) as unknown;
    } catch {
      setResult('The import is not valid JSON.');
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
          title="Provider or manual JSON"
          detail="Both sources use the same replay pipeline"
        />
        <Text style={uiStyles.body}>
          The payload is stored before validation. Known provider/game/athlete mappings and a
          complete approved stat schema are required before points commit.
        </Text>
        <TextInput
          accessibilityLabel="Sports data JSON payload"
          autoCapitalize="none"
          multiline
          onChangeText={setPayload}
          placeholder='{"provider":"approved-provider", ...}'
          placeholderTextColor={colors.muted}
          style={[uiStyles.input, styles.editor]}
          value={payload}
        />
        <View style={styles.actions}>
          <ActionButton label="Back to operations" href="/admin" variant="ghost" />
          <ActionButton
            label="Validate, normalize & replay"
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
    editor: { minHeight: 280, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 11 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 9 },
    result: { maxWidth: 850, marginTop: 12, backgroundColor: colors.canvasSoft },
    resultText: { color: colors.brand, fontFamily: 'monospace', fontSize: 10, lineHeight: 16 },
  });

const useStyles = () => useThemedStyles(createStyles);
