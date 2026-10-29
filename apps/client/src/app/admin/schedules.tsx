import { VARSITY_PROGRAMS, type VarsityProgram } from '@brock-fantasy/domain';
import { AdminDateInput, AdminPanel, AdminToggle, adminMultiline } from '@/components/admin-ui';
import { newCommandKey } from '../../lib/command-key';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { torontoDateFields, torontoDateTime } from '@brock-fantasy/domain';
import {
  ActionButton,
  AppShell,
  Card,
  ErrorState,
  LoadingState,
  Pill,
  SectionTitle,
  useUiStyles,
} from '@/components/ui';
import { AdminAccess } from '@/components/admin-access';
import { PendingConfirmation, gameTime } from '@/components/player-insights';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { betaCommand } from '@/lib/web-api';

interface ReviewGame {
  id: string;
  competition_id: string;
  program: string;
  home: string;
  away: string;
  starts_at: string;
  status: string;
  schedule_kind: string;
  neutral_site: boolean;
  home_is_brock: boolean;
  schedule_confirmed: boolean;
  schedule_override: boolean;
  schedule_revision: number;
  source_url: string | null;
  schedule_change: {
    source?: Record<string, unknown>;
    history_protected?: boolean;
    override_conflict?: boolean;
  };
}
interface ReviewData {
  games: ReviewGame[];
  alerts: { id: string; message: string; display_name: string | null }[];
  sources: {
    id: string;
    competition_id: string;
    program: VarsityProgram;
    last_synced_at: string | null;
    last_error: string | null;
  }[];
}
export default function ScheduleReviewScreen() {
  const access = useRequireAdmin();
  const ui = useUiStyles();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [programs, setPrograms] = useState<VarsityProgram[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const load = useCallback(async () => {
    if (!access.allowed) return;
    const result = await betaCommand<ReviewData>('get_schedule_review', {});
    setError(result.error);
    if (result.data) setData(result.data);
  }, [access.allowed]);
  useEffect(() => {
    void load();
  }, [load]);
  const invalidRange = Boolean(from && to && from > to);
  // - Resolve stable program keys once rather than comparing display labels with filter values
  const programByCompetition = useMemo(
    () => new Map(data?.sources.map((source) => [source.competition_id, source.program]) ?? []),
    [data?.sources],
  );
  const filtered = useMemo(() => {
    const normalize = (value: string) =>
      value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]/gu, '');
    const needle = normalize(search);
    return (data?.games ?? []).filter((game) => {
      const day = torontoDateFields(game.starts_at).date;
      const program = programByCompetition.get(game.competition_id);
      return (
        !invalidRange &&
        (showAll || !game.schedule_confirmed || game.schedule_override) &&
        (!programs.length || (program !== undefined && programs.includes(program))) &&
        (!from || day >= from) &&
        (!to || day <= to) &&
        (!needle ||
          normalize(
            `${game.program} ${program ? VARSITY_PROGRAMS[program] : ''} ${game.home} ${game.away} ${day}`,
          ).includes(needle))
      );
    });
  }, [data, programByCompetition, showAll, programs, from, to, search, invalidRange]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Administrator, MFA required" title="Schedule confirmation and overrides">
      <View style={{ gap: 20 }}>
        <ActionButton label="Back to Operations Centre" href="/admin" variant="secondary" />
        <ActionButton
          label="Refresh schedule reviews"
          onPress={() => void load()}
          variant="secondary"
        />
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!data ? (
          <LoadingState label="Loading schedule review" rows={4} />
        ) : (
          <>
            <SectionTitle title="Official source health" />
            <Card style={{ gap: 14 }}>
              {data.sources.map((source) => (
                <View key={source.id}>
                  <Text style={ui.label}>{source.program.replaceAll('_', ' ')}</Text>
                  <Text style={ui.body}>
                    {source.last_synced_at
                      ? `Last synced ${gameTime(source.last_synced_at)}`
                      : 'Awaiting first scheduled sync'}
                  </Text>
                  {source.last_error ? (
                    <Text accessibilityRole="alert" style={ui.body}>
                      {source.last_error}
                    </Text>
                  ) : null}
                </View>
              ))}
            </Card>
            <SectionTitle
              title="Projection and synchronization alerts"
              detail={`${data.alerts.length} need review`}
            />
            <Card style={{ gap: 12 }}>
              {data.alerts.length ? (
                data.alerts.map((alert) => (
                  <Text key={alert.id} style={ui.body}>
                    {alert.display_name ? `${alert.display_name}: ` : ''}
                    {alert.message}
                  </Text>
                ))
              ) : (
                <Text style={ui.body}>No unresolved projection or schedule alerts</Text>
              )}
            </Card>
            <TextInput
              accessibilityLabel="Find schedule fixture"
              placeholder="Filter by program, opponent or date"
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setPage(0);
              }}
              style={ui.input}
            />
            <ActionButton label="Filter" variant="secondary" onPress={() => setFilterOpen(true)} />
            <AdminPanel
              title="Schedule filters"
              open={filterOpen}
              onClose={() => setFilterOpen(false)}
            >
              <Text style={ui.title}>Programs</Text>
              {Object.entries(VARSITY_PROGRAMS).map(([program, label]) => (
                <AdminToggle
                  key={program}
                  label={label}
                  selected={programs.includes(program as VarsityProgram)}
                  onPress={() => {
                    setPrograms((current) =>
                      current.includes(program as VarsityProgram)
                        ? current.filter((value) => value !== program)
                        : [...current, program as VarsityProgram],
                    );
                    setPage(0);
                  }}
                />
              ))}
              <AdminDateInput
                label="From date"
                value={from}
                onChange={(value) => {
                  setFrom(value);
                  setPage(0);
                }}
              />
              <AdminDateInput
                label="To date"
                value={to}
                onChange={(value) => {
                  setTo(value);
                  setPage(0);
                }}
              />
              {invalidRange ? (
                <Text accessibilityRole="alert" style={ui.body}>
                  The From date must be on or before the To date.
                </Text>
              ) : null}
              <AdminToggle
                label="Needs review"
                selected={!showAll}
                onPress={() => {
                  setShowAll(!showAll);
                  setPage(0);
                }}
              />
              <ActionButton
                label="Clear filters"
                variant="secondary"
                onPress={() => {
                  setPrograms([]);
                  setFrom('');
                  setTo('');
                  setShowAll(false);
                  setPage(0);
                }}
              />
              <ActionButton
                label="Done"
                onPress={() => setFilterOpen(false)}
                disabled={invalidRange}
              />
            </AdminPanel>
            <SectionTitle
              title={showAll ? 'Schedule fixtures' : 'Pending confirmations and pinned overrides'}
              detail={`${filtered.length} matching fixtures, ${data.games.length} total fixtures`}
            />
            <View style={{ gap: 18 }}>
              {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((game) => (
                <ScheduleReview
                  key={`${game.id}:${game.schedule_revision}`}
                  game={game}
                  onSaved={load}
                />
              ))}
            </View>
            {!filtered.length ? (
              <Text style={ui.body}>
                {showAll
                  ? 'No fixtures match your search and filters.'
                  : 'No fixtures match these filters. Turn off Needs review in Filter to include confirmed fixtures.'}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <Text style={ui.body}>
                Page {currentPage + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}
              </Text>
              <ActionButton
                label="Previous fixtures"
                variant="secondary"
                disabled={currentPage === 0}
                onPress={() => setPage(currentPage - 1)}
              />
              <ActionButton
                label="Next fixtures"
                variant="secondary"
                disabled={(currentPage + 1) * 25 >= filtered.length}
                onPress={() => setPage(currentPage + 1)}
              />
            </View>
            {!data.games.some((game) => !game.schedule_confirmed || game.schedule_override) ? (
              <Text style={ui.body}>All schedules are confirmed and no overrides are pinned</Text>
            ) : null}
          </>
        )}
      </View>
    </AppShell>
  );
}
function ScheduleReview({ game, onSaved }: { game: ReviewGame; onSaved: () => Promise<void> }) {
  const ui = useUiStyles();
  const fields = torontoDateFields(game.starts_at);
  const [date, setDate] = useState(fields.date);
  const [time, setTime] = useState(fields.time);
  const [status, setStatus] = useState(game.status);
  const [opponent, setOpponent] = useState(game.home_is_brock ? game.away : game.home);
  const [site, setSite] = useState(
    game.neutral_site ? 'neutral' : game.home_is_brock ? 'home' : 'away',
  );
  const [kind, setKind] = useState(game.schedule_kind ?? 'regular');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (action: 'confirm' | 'override' | 'clear_override') => {
    const startsAt = torontoDateTime(date, time);
    if (reason.trim().length < 8) {
      setMessage('Provide an audit reason of at least eight characters.');
      return;
    }
    if (action === 'override' && !startsAt) {
      setMessage('Enter a valid Toronto date and time.');
      return;
    }
    setWorking(true);
    try {
      const result = await betaCommand('review_game_schedule', {
        p_game_id: game.id,
        p_expected_revision: game.schedule_revision,
        p_action: action,
        p_changes:
          action === 'override'
            ? {
                starts_at: startsAt,
                status,
                opponent,
                home: site !== 'away',
                neutral_site: site === 'neutral',
                schedule_kind: kind,
              }
            : {},
        p_reason: reason.trim(),
        p_idempotency_key: newCommandKey(),
      });
      setMessage(result.error);
      if (!result.error) await onSaved();
    } finally {
      setWorking(false);
    }
  };
  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={ui.title}>
        {game.program}
      </Text>
      <Text style={ui.body}>
        {game.home} vs {game.away}, {gameTime(game.starts_at)}, {game.status}
      </Text>
      {!game.schedule_confirmed ? (
        <PendingConfirmation />
      ) : (
        <Pill label="Confirmed" tone="positive" />
      )}
      {game.schedule_override ? <Pill label="Admin override pinned" tone="info" /> : null}
      {game.schedule_change.history_protected || game.schedule_change.override_conflict ? (
        <Text accessibilityRole="alert" style={ui.body}>
          Source conflicts with protected history or an admin override. Review the official source
          before confirming.
        </Text>
      ) : null}
      {game.source_url ? (
        <Text selectable style={ui.body}>
          Official source: {game.source_url}
        </Text>
      ) : null}
      {game.schedule_change.source ? (
        <Text selectable style={ui.body}>
          Latest source proposal:{' '}
          {typeof game.schedule_change.source.starts_at === 'string'
            ? gameTime(game.schedule_change.source.starts_at)
            : 'Time unavailable'}
          ,{' '}
          {typeof game.schedule_change.source.status === 'string'
            ? game.schedule_change.source.status
            : 'Status unavailable'}
        </Text>
      ) : null}
      <Text style={ui.label}>Override start, Toronto timezone</Text>
      <TextInput
        accessibilityLabel={`Override date for ${game.id}`}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        style={ui.input}
      />
      <TextInput
        accessibilityLabel={`Override time for ${game.id}`}
        value={time}
        onChangeText={setTime}
        placeholder="HH:mm"
        style={ui.input}
      />
      <Text style={ui.label}>Override status</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['scheduled', 'postponed', 'cancelled'].map((value) => (
          <ActionButton
            key={value}
            label={value}
            variant={status === value ? 'primary' : 'secondary'}
            onPress={() => setStatus(value)}
            disabled={working}
          />
        ))}
      </View>
      <Text style={ui.label}>Opponent</Text>
      <TextInput
        accessibilityLabel={`Override opponent for ${game.id}`}
        value={opponent}
        onChangeText={setOpponent}
        maxLength={150}
        style={ui.input}
      />
      <Text style={ui.label}>Brock location</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['home', 'away', 'neutral'].map((value) => (
          <ActionButton
            key={value}
            label={value}
            variant={site === value ? 'primary' : 'secondary'}
            onPress={() => setSite(value)}
            disabled={working}
          />
        ))}
      </View>
      <Text style={ui.label}>Game phase</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['regular', 'playoff', 'exhibition'].map((value) => (
          <ActionButton
            key={value}
            label={value}
            variant={kind === value ? 'primary' : 'secondary'}
            onPress={() => setKind(value)}
            disabled={working}
          />
        ))}
      </View>
      <TextInput
        accessibilityLabel={`Review reason for ${game.id}`}
        value={reason}
        onChangeText={setReason}
        placeholder="Reason and verification evidence"
        maxLength={500}
        multiline
        style={[ui.input, adminMultiline]}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ActionButton
          label="Confirm current schedule"
          onPress={() => void submit('confirm')}
          disabled={working || game.schedule_confirmed}
        />
        <ActionButton
          label="Save pinned override"
          onPress={() => void submit('override')}
          disabled={working}
          variant="secondary"
        />
        {game.schedule_override ? (
          <ActionButton
            label="Clear override, use next official sync"
            onPress={() => void submit('clear_override')}
            disabled={working}
            variant="secondary"
          />
        ) : null}
      </View>
      {message ? (
        <Text accessibilityRole="alert" style={ui.body}>
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
