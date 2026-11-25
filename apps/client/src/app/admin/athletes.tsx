import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, TextInput, View } from 'react-native';
import { type AthleteAvailability } from '@brock-fantasy/domain';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  LoadingState,
  useUiStyles,
} from '@/components/ui';
import { AdminAccess } from '@/components/admin-access';
import { adminMultiline, AdminPanel, AdminSelect, AdminTable } from '@/components/admin-ui';
import { AthleteStatus, AvailabilityControls } from '@/components/athlete-availability';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { useSession } from '@/providers/session-provider';
import { useAthleteAvailability } from '@/providers/athlete-availability-provider';
import { supabase } from '@/lib/supabase';
import { betaCommand } from '@/lib/web-api';
import { newCommandKey } from '@/lib/command-key';
import { programNames } from '@/lib/player-program';
import {
  compareAvailability,
  matchesAvailability,
  type AvailabilityFilter,
  type AvailabilityOrder,
} from '@/lib/athlete-availability';

interface AthleteRow {
  id: string;
  display_name: string;
  position: string;
  jersey_number: string | null;
  bio: Record<string, unknown> & { program?: string; sourcePosition?: string };
}
export default function AthleteStatusScreen() {
  const access = useRequireAdmin();
  const { readScope } = useSession();
  const ui = useUiStyles();
  const [data, setData] = useState<{ scope: object; rows: AthleteRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [program, setProgram] = useState('all');
  const [filter, setFilter] = useState<AvailabilityFilter>('all');
  const [order, setOrder] = useState<AvailabilityOrder>('default');
  const [selected, setSelected] = useState<{
    scope: object;
    athlete: AthleteRow;
    revision: number;
    status: AthleteAvailability;
  } | null>(null);
  const [status, setStatus] = useState<AthleteAvailability>('active');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const saveKey = useRef<{ intent: string; key: string } | null>(null);
  const currentScope = useRef(readScope);
  currentScope.current = readScope;
  const rows = data?.scope === readScope ? data.rows : [];
  const availability = useAthleteAvailability(access.allowed ? rows.map((row) => row.id) : []);
  useFocusEffect(
    useCallback(() => {
      if (!access.allowed || !supabase) return;
      let cancelled = false;
      setLoading(true);
      setError(null);
      setSelected(null);
      setReason('');
      setWorking(false);
      setMessage(null);
      saveKey.current = null;
      void supabase
        .from('athletes')
        .select(
          'id,display_name,position,jersey_number,bio,membership:athlete_seasons!inner(directory_visible)',
        )
        .eq('status', 'active')
        .is('fantasy_withdrawn_at', null)
        .eq('membership.directory_visible', true)
        .eq('membership.season_id', 'b0000000-0000-4000-8000-000000000002')
        .order('display_name')
        .then((result) => {
          if (cancelled) return;
          setLoading(false);
          if (result.error) setError('Unable to load athletes. Return to this page to retry.');
          else setData({ scope: readScope, rows: result.data });
        });
      return () => {
        cancelled = true;
      };
    }, [access.allowed, readScope]),
  );
  const searchable = useMemo(
    () =>
      rows.map((athlete) => ({
        athlete,
        search:
          `${athlete.display_name} ${athlete.position} ${athlete.jersey_number ?? ''} ${athlete.bio.sourcePosition ?? ''} ${programNames[athlete.bio.program ?? ''] ?? ''}`.toLocaleLowerCase(
            'en-CA',
          ),
      })),
    [rows],
  );
  const visible = useMemo(
    () =>
      searchable
        .filter(
          ({ athlete, search }) =>
            (program === 'all' || athlete.bio.program === program) &&
            search.includes(query.trim().toLocaleLowerCase('en-CA')) &&
            matchesAvailability(athlete.id, availability.rows, filter),
        )
        .sort(
          (a, b) =>
            compareAvailability(a.athlete.id, b.athlete.id, availability.rows, order) ||
            a.athlete.display_name.localeCompare(b.athlete.display_name, 'en-CA'),
        ),
    [searchable, program, query, filter, order, availability.rows],
  );
  const select = (athlete: AthleteRow) => {
    if (working) return;
    if (selected && (reason.trim() || status !== selected.status)) {
      setMessage('Save or cancel the current edit before selecting another athlete.');
      return;
    }
    const current = availability.rows.get(athlete.id);
    if (!current) {
      setMessage('Wait for the current athlete status or refresh the list.');
      return;
    }
    setSelected({
      scope: readScope,
      athlete,
      revision: current.availability_revision,
      status: current.availability_status,
    });
    setStatus(current.availability_status);
    setReason('');
    setMessage(null);
    saveKey.current = null;
  };
  const save = async () => {
    if (!selected || selected.scope !== readScope || working) return;
    const scope = readScope;
    setWorking(true);
    setMessage(null);
    const intent = JSON.stringify([selected.athlete.id, selected.revision, status, reason.trim()]);
    if (saveKey.current?.intent !== intent) saveKey.current = { intent, key: newCommandKey() };
    try {
      const result = await betaCommand<{ revision: number; notificationCount: number }>(
        'admin_set_athlete_availability',
        {
          p_athlete_id: selected.athlete.id,
          p_availability_status: status,
          p_expected_revision: selected.revision,
          p_reason: reason.trim(),
          p_idempotency_key: saveKey.current.key,
        },
      );
      if (currentScope.current !== scope) return;
      if (result.error) {
        if (result.code === 'PT409' || result.status === 409) {
          await availability.refresh();
          if (currentScope.current !== scope) return;
          setSelected(null);
          saveKey.current = null;
          setMessage(
            'Athlete status changed while you were editing. Select the athlete again and review the latest status before saving.',
          );
        } else setMessage(result.error);
      } else {
        setReason('');
        setSelected(null);
        saveKey.current = null;
        const count = result.data?.notificationCount ?? 0;
        setMessage(`Status saved. Created ${count} league notification${count === 1 ? '' : 's'}.`);
        await availability.refresh();
      }
    } catch {
      if (currentScope.current === scope)
        setMessage('Unable to confirm the save. Retry to safely retrieve its result.');
    } finally {
      if (currentScope.current === scope) setWorking(false);
    }
  };
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell eyebrow="Athlete administration" title="Athlete status" workspace>
      <View style={{ gap: 18 }}>
        <ActionButton label="Back to Operations Centre" href="/admin" variant="secondary" />
        <Card style={{ gap: 14 }}>
          <Text style={ui.body}>
            Manage advisory availability across all leagues. Managers handle replacements through
            their usual lineup and transaction tools.
          </Text>
          <TextInput
            accessibilityLabel="Search athletes"
            placeholder="Search name, program, position, or jersey number"
            value={query}
            onChangeText={setQuery}
            style={ui.input}
          />
          <AdminSelect
            label="Program"
            value={program}
            onChange={setProgram}
            options={[
              { value: 'all', label: 'All programs' },
              ...Object.entries(programNames).map(([value, label]) => ({ value, label })),
            ]}
          />
          <AvailabilityControls
            filter={filter}
            order={order}
            onFilter={setFilter}
            onOrder={setOrder}
          />
          <ActionButton
            label="Refresh statuses"
            variant="secondary"
            onPress={() => void availability.refresh()}
          />
          {loading ? (
            <LoadingState label="Loading athletes" />
          ) : error ? (
            <Text accessibilityRole="alert" style={ui.body}>
              {error}
            </Text>
          ) : !visible.length ? (
            <EmptyState title="No matching athletes" body="Try another name, program, or status." />
          ) : (
            <AdminTable
              label="Athlete status directory"
              columns={[
                { label: 'Athlete', width: 230 },
                { label: 'Program', width: 210 },
                { label: 'Position', width: 100 },
                { label: 'Status', width: 140 },
                { label: 'Action', width: 130 },
              ]}
              rows={visible.map(({ athlete }) => ({
                id: athlete.id,
                cells: [
                  <Text key="name" style={ui.body}>
                    {athlete.display_name}
                    {athlete.jersey_number ? ` · #${athlete.jersey_number}` : ''}
                  </Text>,
                  <Text key="program" style={ui.body}>
                    {programNames[athlete.bio.program ?? ''] ?? 'Brock athlete'}
                  </Text>,
                  <Text key="position" style={ui.body}>
                    {athlete.position}
                  </Text>,
                  <AthleteStatus key="status" athleteId={athlete.id} />,
                  <ActionButton
                    key="edit"
                    label={`Edit ${athlete.display_name}`}
                    variant="secondary"
                    disabled={working}
                    onPress={() => select(athlete)}
                  />,
                ],
              }))}
            />
          )}
        </Card>
        {selected && selected.scope === readScope ? (
          <AdminPanel
            title={selected.athlete.display_name}
            open
            onClose={() => {
              if (!working) {
                setSelected(null);
                setReason('');
                setMessage(null);
                saveKey.current = null;
              }
            }}
          >
            <AthleteStatus athleteId={selected.athlete.id} />
            <AdminSelect
              label="New status"
              value={status}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'injured', label: 'Injured' },
              ]}
              disabled={working}
              onChange={(value) => setStatus(value as AthleteAvailability)}
            />
            <Text style={ui.label}>Private audit reason (8–500 characters)</Text>
            <TextInput
              accessibilityLabel="Private audit reason"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={500}
              editable={!working}
              style={[ui.input, adminMultiline, { minHeight: 112 }]}
            />
            <Text style={ui.body}>
              Saving a changed status sends an in-app notification to current roster owners in each
              affected ongoing league. Your audit reason stays private to administrators.
            </Text>
            {availability.rows.get(selected.athlete.id)?.availability_revision !==
            selected.revision ? (
              <Text accessibilityRole="alert" style={ui.body}>
                The current status changed since you opened this editor. Cancel and select the
                athlete again to review it.
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              <ActionButton
                label="Save status"
                onPress={() => void save()}
                loading={working}
                disabled={
                  reason.trim().length < 8 ||
                  status === selected.status ||
                  availability.rows.get(selected.athlete.id)?.availability_revision !==
                    selected.revision
                }
              />
              <ActionButton
                label="Cancel edit"
                variant="secondary"
                disabled={working}
                onPress={() => {
                  setSelected(null);
                  setReason('');
                  setMessage(null);
                  saveKey.current = null;
                }}
              />
            </View>
            {message ? (
              <Text accessibilityRole="alert" style={ui.body}>
                {message}
              </Text>
            ) : null}
          </AdminPanel>
        ) : null}
        {message && !selected ? (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {message}
          </Text>
        ) : null}
      </View>
    </AppShell>
  );
}
