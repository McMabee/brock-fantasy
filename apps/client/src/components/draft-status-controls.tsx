import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { DraftState } from '@brock-fantasy/domain';

import { ActionButton, Card, useUiStyles } from '@/components/ui';
import { betaCommand } from '@/lib/web-api';

export function DraftStatusControls({
  draftId,
  status,
  isCommissioner,
  connected,
  reload,
}: {
  draftId: string;
  status: DraftState['status'];
  isCommissioner: boolean;
  connected: boolean;
  reload: () => Promise<boolean>;
}) {
  const styles = useUiStyles();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const intent = useRef<{ status: 'active' | 'paused'; key: string } | null>(null);
  const paused = status === 'paused';
  if (!paused && !(isCommissioner && status === 'active')) return null;

  const changeStatus = async () => {
    if (!isCommissioner || !connected || pending.current) return;
    pending.current = true;
    setWorking(true);
    setError(null);
    const nextStatus = paused ? 'active' : 'paused';
    // - Reuse the command key after an interrupted response to prevent duplicate changes
    if (intent.current?.status !== nextStatus)
      intent.current = { status: nextStatus, key: crypto.randomUUID() };
    try {
      const result = await betaCommand('set_draft_status', {
        p_draft_id: draftId,
        p_status: nextStatus,
        p_idempotency_key: intent.current.key,
      });
      if (result.error) setError(result.error);
      else intent.current = null;
      await reload();
    } catch {
      setError('Unable to confirm the draft status. Refresh and try again.');
    } finally {
      pending.current = false;
      setWorking(false);
    }
  };

  return (
    <Card>
      <View style={{ gap: 10 }}>
        {paused ? (
          <>
            <Text accessibilityRole="header" style={styles.label}>
              Draft paused
            </Text>
            <Text style={styles.body}>
              {isCommissioner
                ? 'Resume when everyone is ready. The pick timer starts when you resume.'
                : 'Waiting for the league commissioner to resume the draft.'}
            </Text>
          </>
        ) : null}
        {isCommissioner ? (
          <ActionButton
            label={paused ? 'Resume draft' : 'Pause draft'}
            onPress={() => void changeStatus()}
            loading={working}
            disabled={!connected || working}
            variant={paused ? 'primary' : 'secondary'}
          />
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.body}>
            {error}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
