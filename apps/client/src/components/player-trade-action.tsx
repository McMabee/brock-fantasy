import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { ActionButton, Card, useUiStyles } from './ui';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { useActionFeedback } from '@/providers/action-feedback-provider';
import { useSession } from '@/providers/session-provider';

interface TradeOption {
  league_id: string;
  league_name: string;
  proposing_team_id: string;
  receiving_team_id: string;
  receiving_team_name: string;
  athlete_name: string;
  offered: { id: string; name: string }[];
}
export function PlayerTradeAction({
  athleteId,
  leagueId,
  onSent,
}: {
  athleteId: string;
  leagueId?: string | undefined;
  onSent?: () => void;
}) {
  const { user } = useSession();
  const [options, setOptions] = useState<TradeOption[]>([]);
  const [open, setOpen] = useState(false);
  const [league, setLeague] = useState('');
  const [offered, setOffered] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const submitting = useRef(false);
  const show = useActionFeedback();
  const ui = useUiStyles();
  useEffect(() => {
    let active = true;
    setOptions([]);
    setLeague('');
    setOffered('');
    setError(null);
    if (supabase && user)
      void supabase
        .rpc('get_player_trade_options', { p_athlete_id: athleteId, p_league_id: leagueId ?? null })
        .then((result) => {
          if (!active) return;
          if (result.error) setError('Trade options are temporarily unavailable.');
          else {
            const rows = (result.data ?? []) as TradeOption[];
            setOptions(rows);
            if (rows.length === 1) setLeague(rows[0]!.league_id);
          }
        });
    return () => {
      active = false;
    };
  }, [athleteId, leagueId, user?.id]);
  const selected = options.find((option) => option.league_id === league);
  const send = async () => {
    if (!selected || !offered || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const signature = `${selected.league_id}:${athleteId}:${offered}`;
    if (pending.current?.signature !== signature)
      pending.current = {
        signature,
        key: `profile-trade-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    try {
      const result = await betaCommand<{ trade_id: string }>('propose_trade', {
        p_proposing_team_id: selected.proposing_team_id,
        p_receiving_team_id: selected.receiving_team_id,
        p_offered_athlete_ids: [offered],
        p_requested_athlete_ids: [athleteId],
        p_expires_at: new Date(Date.now() + 2 * 86400000).toISOString(),
        p_idempotency_key: pending.current.key,
      });
      if (result.error) setError(result.error);
      else {
        pending.current = null;
        setOpen(false);
        onSent?.();
        show({
          title: 'Trade proposal sent',
          body: `${selected.receiving_team_name} can now review your offer.`,
          tone: 'success',
          eventKey: `trade:${result.data?.trade_id}:proposed`,
        });
      }
    } catch {
      setError('Connection interrupted. Retry to check the same proposal.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 6 }}>
      <ActionButton
        label="Trade"
        variant="secondary"
        onPress={() => setOpen(true)}
        disabled={!options.length}
      />
      {!options.length ? (
        <Text style={ui.body}>
          {error ??
            'Trade is available when another team owns this athlete in an active league you play in.'}
        </Text>
      ) : null}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0009',
            padding: 20,
          }}
        >
          <Card style={{ width: '100%', maxWidth: 600, maxHeight: '90%' }}>
            <ScrollView contentContainerStyle={{ gap: 14 }}>
              <Text accessibilityRole="header" style={ui.title}>
                Propose a trade
              </Text>
              {options.length > 1 ? (
                <View style={{ gap: 8 }}>
                  <Text style={ui.label}>Choose your league</Text>
                  {options.map((option) => (
                    <ActionButton
                      key={option.league_id}
                      label={`${league === option.league_id ? '✓ ' : ''}${option.league_name}`}
                      variant="secondary"
                      onPress={() => {
                        setLeague(option.league_id);
                        setOffered('');
                      }}
                      disabled={busy}
                    />
                  ))}
                </View>
              ) : null}
              {selected ? (
                <>
                  <Text style={ui.body}>
                    Request {selected.athlete_name} from {selected.receiving_team_name}
                  </Text>
                  <Text style={ui.label}>You offer</Text>
                  {selected.offered.map((athlete) => (
                    <ActionButton
                      key={athlete.id}
                      label={`${offered === athlete.id ? '✓ ' : ''}${athlete.name}`}
                      variant="secondary"
                      onPress={() => setOffered(athlete.id)}
                      disabled={busy}
                    />
                  ))}
                  <Text style={ui.body}>
                    Acceptance begins a 24-hour review. Game locks and current eligibility are
                    checked before athletes move.
                  </Text>
                </>
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={ui.body}>
                  {error}
                </Text>
              ) : null}
              <ActionButton
                label="Send trade proposal"
                onPress={() => void send()}
                loading={busy}
                disabled={!selected || !offered}
              />
              <ActionButton
                label="Close"
                variant="ghost"
                onPress={() => setOpen(false)}
                disabled={busy}
              />
            </ScrollView>
          </Card>
        </View>
      </Modal>
    </View>
  );
}
