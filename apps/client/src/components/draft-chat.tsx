import { useThemeColors } from '@/providers/theme-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ActionButton, useUiStyles } from './ui';
import { supabase } from '@/lib/supabase';
import { firstRelated } from '@/lib/relations';
import { VarsityBadge } from './varsity-badge';
import { betaCommand } from '@/lib/web-api';

interface ChatRow {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author:
    | { display_name: string; is_varsity: boolean }
    | readonly { display_name: string; is_varsity: boolean }[]
    | null;
}
export function DraftChat({ leagueId }: { leagueId: string | undefined }) {
  const uiStyles = useUiStyles();
  const colors = useThemeColors();
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const currentLeague = useRef(leagueId);
  currentLeague.current = leagueId;
  const pending = useRef<Promise<void> | null>(null);
  const load = useCallback(async () => {
    if (!supabase || !leagueId) return;
    const result = await supabase
      .from('chat_messages')
      .select(
        'id,author_id,body,created_at,author:profiles!chat_messages_author_id_fkey(display_name,is_varsity)',
      )
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (currentLeague.current !== leagueId) return;
    if (result.error) setError('Chat is reconnecting…');
    else {
      setRows((result.data as ChatRow[]).reverse());
      setError(null);
    }
  }, [leagueId]);
  useEffect(() => {
    setRows([]);
    pending.current = null;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        pending.current ??= load().finally(() => {
          pending.current = null;
        });
        await pending.current;
      } finally {
        if (active) timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]);
  const command = async (name: string, payload: Record<string, unknown>) => {
    const result = await betaCommand(name, payload);
    if (result.error) setError(result.error);
    else await load();
  };
  const send = async () => {
    if (!leagueId || !text.trim() || sending) return;
    setSending(true);
    const result = await betaCommand('post_chat_message', {
      p_league_id: leagueId,
      p_body: text.trim(),
      p_idempotency_key: crypto.randomUUID(),
    });
    if (result.error) setError(result.error);
    else {
      setText('');
      await load();
    }
    setSending(false);
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.text, fontWeight: '800' }}>League chat</Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
      <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 12 }}>
        {rows.map((row) => (
          <View key={row.id} style={{ gap: 4 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {firstRelated(row.author)?.display_name ?? 'League member'}
            </Text>
            <VarsityBadge visible={firstRelated(row.author)?.is_varsity} />
            <Text style={{ color: colors.text }}>{row.body}</Text>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void command('report_chat_message', {
                    p_message_id: row.id,
                    p_reason: 'Reported from draft room.',
                  })
                }
              >
                <Text style={{ color: colors.link }}>Report</Text>
              </Pressable>
              {row.author_id ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    void command('mute_chat_user', {
                      p_league_id: leagueId,
                      p_muted_user_id: row.author_id,
                    })
                  }
                >
                  <Text style={{ color: colors.link }}>Mute</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
        {!rows.length ? <Text style={{ color: colors.muted }}>No messages yet.</Text> : null}
      </ScrollView>
      <TextInput
        style={uiStyles.input}
        accessibilityLabel="League chat message"
        placeholder="Message your league…"
        placeholderTextColor={colors.muted}
        value={text}
        onChangeText={setText}
        maxLength={500}
      />
      <ActionButton
        label="Send message"
        onPress={() => void send()}
        disabled={!text.trim() || !leagueId}
        loading={sending}
      />
    </View>
  );
}
