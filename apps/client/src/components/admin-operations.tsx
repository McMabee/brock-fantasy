import { useMemo, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AdminAccess } from './admin-access';
import { ActionButton, AppShell, Card, EmptyState, LoadingState, Pill, useUiStyles } from './ui';
import { AdminDateInput, AdminPanel, AdminSelect, AdminTable } from './admin-ui';
import { LeagueChoices, LeagueRefresh } from './admin-league-ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { useAdminLeagueRead } from '@/hooks/use-admin-leagues';
import { useThemeColors } from '@/providers/theme-provider';
import { adminDate } from '@/lib/admin-leagues';
import {
  operationLabel,
  operationValue,
  type OperationItem,
  type OperationsPage,
} from '@/lib/admin-operations';

function OfficialSource({ url }: { url: string | null | undefined }) {
  if (!url || !/^https:\/\/gobadgers\.ca\/sports\//u.test(url)) return null;
  return (
    <ActionButton
      label="Open official source"
      variant="secondary"
      onPress={() => void Linking.openURL(url)}
    />
  );
}

export function OperationDetails({
  item,
  section,
  onClose,
}: {
  item: OperationItem | null;
  section: string;
  onClose: () => void;
}) {
  const ui = useUiStyles();
  const [technical, setTechnical] = useState(false);
  return (
    <AdminPanel
      title={
        section === 'audit'
          ? 'Audit event details'
          : section === 'alerts'
            ? 'Ingestion alert details'
            : 'Sync run details'
      }
      open={Boolean(item)}
      onClose={onClose}
    >
      {item ? (
        <>
          <Text style={ui.title}>{item.summary ?? item.provider ?? 'Sync run'}</Text>
          <Text style={ui.body}>{adminDate(item.created_at)}</Text>
          {item.status ? (
            <Pill
              label={operationLabel(item.status)}
              tone={
                ['failed', 'partial', 'unresolved'].includes(item.status) ? 'warning' : 'neutral'
              }
            />
          ) : null}
          {item.actor ? <Text style={ui.body}>By {item.actor}</Text> : null}
          {item.entity_type ? (
            <Text style={ui.body}>
              {operationLabel(item.entity_type)}: {item.entity_name ?? 'Name unavailable'}
            </Text>
          ) : null}
          {section === 'audit' ? (
            <AdminTable
              label="Event changes"
              columns={[
                { label: 'Field', width: 170 },
                { label: 'Before', width: 180 },
                { label: 'After', width: 180 },
              ]}
              rows={[
                ...new Set([
                  ...Object.keys(item.before_state ?? {}),
                  ...Object.keys(item.after_state ?? {}),
                ]),
              ].map((key) => ({
                id: key,
                cells: [
                  operationLabel(key),
                  operationValue(item.before_state?.[key]),
                  operationValue(item.after_state?.[key]),
                ],
              }))}
            />
          ) : null}
          {section === 'audit' &&
          !Object.keys(item.before_state ?? {}).length &&
          !Object.keys(item.after_state ?? {}).length ? (
            <Text style={ui.body}>No structured changes were recorded for this event.</Text>
          ) : null}
          {section === 'runs' ? (
            <>
              {item.competition_name ? (
                <Text style={ui.body}>
                  {item.competition_name} · {item.season_label ?? '—'}
                </Text>
              ) : null}

              <Text style={ui.body}>
                Started: {adminDate(item.started_at ?? null)}
                {'\n'}Finished: {adminDate(item.finished_at ?? null)}
              </Text>
              <Text style={ui.body}>
                Inserted: {item.inserted_count ?? '—'} · Updated: {item.updated_count ?? '—'} ·
                Ignored: {item.ignored_count ?? '—'}
              </Text>
              {(item.sources ?? []).map((source) => (
                <Card key={source.source_id} style={{ gap: 10 }}>
                  <Text style={ui.title}>{operationLabel(source.program)}</Text>
                  <Text style={ui.body}>
                    {operationLabel(source.status)} · {source.changed ?? '—'} changes
                  </Text>
                  <Text style={ui.body}>
                    Started: {adminDate(source.started_at)}
                    {'\n'}Finished: {adminDate(source.finished_at)}
                  </Text>
                  {source.error_code ? (
                    <Text style={ui.body}>{operationLabel(source.error_code)}</Text>
                  ) : null}
                  <OfficialSource url={source.url} />
                </Card>
              ))}
              {!item.sources?.length ? (
                <Text style={ui.body}>
                  Individual source and item details were not recorded for this run.
                </Text>
              ) : null}
              <Text style={ui.body}>{item.alert_count ?? 0} associated ingestion alerts</Text>
              <ActionButton
                label="View ingestion alerts"
                href={{ pathname: '/admin/alerts', params: { q: item.id, status: 'all' } }}
                variant="secondary"
              />
            </>
          ) : null}
          {section === 'alerts' ? (
            <>
              {item.game_name ? <Text style={ui.body}>Game: {item.game_name}</Text> : null}
              {Array.isArray(item.context?.missing_stats) && item.context.missing_stats.length ? (
                <Text style={ui.body}>
                  Missing statistics: {operationValue(item.context.missing_stats)}
                </Text>
              ) : null}

              <Text style={ui.body}>
                {item.program
                  ? operationLabel(item.program)
                  : (item.provider ?? 'Source details unavailable')}
              </Text>
              {item.resolved_at ? (
                <Text style={ui.body}>
                  Resolved {adminDate(item.resolved_at)}
                  {item.resolved_by ? ` by ${item.resolved_by}` : ''}
                </Text>
              ) : (
                <Text style={ui.body}>This alert needs administrator review.</Text>
              )}
              <OfficialSource url={item.source_url} />
              <ActionButton
                label={
                  item.job_kind === 'schedule' ? 'Open schedule reviews' : 'Open provider import'
                }
                href={item.job_kind === 'schedule' ? '/admin/schedules' : '/admin/import'}
                variant="secondary"
              />
              {item.sync_run_id ? (
                <ActionButton
                  label="View associated sync run"
                  href={{
                    pathname: '/admin/syncs',
                    params: { kind: item.job_kind ?? 'player', q: item.sync_run_id, status: 'all' },
                  }}
                  variant="secondary"
                />
              ) : null}
            </>
          ) : null}
          <ActionButton
            label={technical ? 'Hide technical details' : 'Show technical details'}
            variant="ghost"
            onPress={() => setTechnical(!technical)}
          />
          {technical ? (
            <Text selectable style={ui.body}>
              {JSON.stringify(
                {
                  id: item.id,
                  action: item.action,
                  entityType: item.entity_type,
                  entityId: item.entity_id,
                  errorCode: item.error_code,
                  competitionId: item.competition_id,
                  providerSnapshotId: item.provider_snapshot_id,
                  context: item.context,
                },
                null,
                2,
              )}
            </Text>
          ) : null}
        </>
      ) : null}
    </AdminPanel>
  );
}

export function AuditEventList({ events }: { events: readonly OperationItem[] }) {
  const ui = useUiStyles();
  const colors = useThemeColors();
  const [selected, setSelected] = useState<OperationItem | null>(null);
  return (
    <View style={{ gap: 10 }}>
      {events.map((event) => (
        <Pressable
          key={event.id}
          accessibilityRole="button"
          accessibilityLabel={`View ${event.summary}`}
          onPress={() => setSelected(event)}
          style={{
            paddingVertical: 12,
            gap: 5,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={[ui.body, { color: colors.text, fontWeight: '700' }]}>{event.summary}</Text>
          <Text style={ui.body}>
            {event.entity_name ?? operationLabel(event.entity_type ?? 'Record')} · {event.actor}
          </Text>
          <Text style={ui.body}>{adminDate(event.created_at)}</Text>
        </Pressable>
      ))}
      <OperationDetails
        key={selected?.id ?? 'closed'}
        item={events.find((event) => event.id === selected?.id) ?? null}
        section="audit"
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

export function OperationsHistory({ section }: { section: 'runs' | 'alerts' | 'audit' }) {
  const access = useRequireAdmin();
  const params = useLocalSearchParams<Record<string, string>>();
  const router = useRouter();
  const ui = useUiStyles();
  const colors = useThemeColors();
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<OperationItem | null>(null);
  const kind = ['player', 'schedule', 'all'].includes(params.kind ?? '')
    ? params.kind!
    : section === 'runs'
      ? 'player'
      : 'all';
  const status = params.status ?? (section === 'alerts' ? 'unresolved' : 'all');
  const query = params.q ?? '';
  const invalidDates = Boolean(params.from && params.to && params.from > params.to);
  const [draft, setDraft] = useState(query);
  const change = (values: Record<string, string | undefined>) => {
    setSelected(null);
    router.setParams({ beforeAt: undefined, beforeId: undefined, ...values });
  };
  const data = useAdminLeagueRead<OperationsPage>(
    'admin_get_operations',
    {
      p_section: section,
      p_kind: kind,
      p_status: status,
      p_query: query,
      p_category: params.category ?? '',
      p_actor: params.actor ?? '',
      p_entity_type: params.entity ?? '',
      p_from: params.from || null,
      p_to: params.to || null,
      p_before_at: params.beforeAt ?? null,
      p_before_id: params.beforeId ?? null,
    },
    access.allowed && !invalidDates,
  );
  const categories = useMemo(
    () =>
      [
        ...new Set([
          'account',
          'participant',
          'league',
          'rankings',
          'schedule',
          'draft',
          'game',
          'lineup',
          'trade',
          'chat',
          ...(data.data?.categories ?? []),
          ...(data.data?.items
            .map((item) => item.category)
            .filter((value): value is string => Boolean(value)) ?? []),
          params.category ?? '',
        ]),
      ]
        .filter(Boolean)
        .sort(),
    [data.data, params.category],
  );
  if (!access.allowed) return <AdminAccess loading={access.loading} error={access.error} />;
  return (
    <AppShell
      eyebrow="Operations centre"
      title={
        section === 'runs'
          ? 'Sync history'
          : section === 'alerts'
            ? 'Ingestion alerts'
            : 'Audit history'
      }
    >
      <View style={{ gap: 18 }}>
        <ActionButton label="Back to Operations Centre" href="/admin" variant="secondary" />
        {section !== 'audit' ? (
          <LeagueChoices
            label="Data jobs"
            selected={kind}
            choices={[
              ...(section === 'alerts' ? [{ value: 'all', label: 'All data jobs' }] : []),
              { value: 'player', label: 'Player ingestion' },
              { value: 'schedule', label: 'Brock schedules' },
            ]}
            onSelect={(value) => change({ kind: value })}
          />
        ) : null}
        <Card style={{ gap: 12 }}>
          <TextInput
            accessibilityLabel={`Search ${section === 'runs' ? 'sync history' : section === 'alerts' ? 'ingestion alerts' : 'audit history'}`}
            placeholder={
              section === 'audit'
                ? 'Search events, names, or exact record IDs'
                : 'Search source, program, or record ID'
            }
            placeholderTextColor={colors.muted}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => change({ q: draft.trim() })}
            maxLength={320}
            style={ui.input}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <ActionButton label="Search" onPress={() => change({ q: draft.trim() })} />
            <ActionButton label="Filter" variant="secondary" onPress={() => setFilterOpen(true)} />
            {query ? (
              <ActionButton
                label="Clear search"
                variant="ghost"
                onPress={() => {
                  setDraft('');
                  change({ q: '' });
                }}
              />
            ) : null}
          </View>
        </Card>
        <LeagueRefresh {...data} refresh={data.refresh} />
        {data.loading && !data.data ? <LoadingState label="Loading history" /> : null}
        {data.data?.items.length === 0 ? (
          <EmptyState
            title="No records found"
            body="Try another search or filter. Older details may not have been recorded."
          />
        ) : null}
        {section === 'audit' ? (
          <AuditEventList events={data.data?.items ?? []} />
        ) : (
          data.data?.items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`View ${item.summary ?? item.provider}`}
              onPress={() => setSelected(item)}
            >
              <Card style={{ gap: 10 }}>
                <Text style={ui.title}>{item.summary ?? item.provider}</Text>
                <Text style={ui.body}>
                  {adminDate(item.created_at)} ·{' '}
                  {item.program
                    ? operationLabel(item.program)
                    : item.job_kind === 'schedule'
                      ? 'Brock schedules'
                      : 'Player ingestion'}
                </Text>
                <Pill
                  label={operationLabel(item.status ?? 'Unknown')}
                  tone={
                    ['failed', 'partial', 'unresolved'].includes(item.status ?? '')
                      ? 'warning'
                      : 'neutral'
                  }
                />
              </Card>
            </Pressable>
          ))
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {params.beforeAt ? (
            <ActionButton label="First page" variant="secondary" onPress={() => change({})} />
          ) : null}
          {data.data?.hasMore && data.data.nextCursor ? (
            <ActionButton
              label="Next page"
              variant="secondary"
              onPress={() => {
                setSelected(null);
                router.setParams({
                  beforeAt: data.data!.nextCursor!.at,
                  beforeId: data.data!.nextCursor!.id,
                });
              }}
            />
          ) : null}
        </View>
        {section === 'runs' && kind === 'schedule' && data.data?.legacySources?.length ? (
          <Card style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={ui.title}>
              Source health and earlier records
            </Text>
            <Text style={ui.body}>
              Complete run timing and counts were not recorded before run tracking was enabled.
              Earlier information is available in schedule audit events.
            </Text>
            {data.data.legacySources.map((source) => (
              <View key={source.id} style={{ gap: 5 }}>
                <Text style={ui.body}>{operationLabel(source.program)}</Text>
                <Text style={ui.body}>
                  Last successful sync:{' '}
                  {source.last_synced_at ? adminDate(source.last_synced_at) : '—'}
                  {source.needs_review ? ' · Needs review' : ''}
                </Text>
              </View>
            ))}
            <ActionButton
              label="Review earlier schedule audit events"
              href={{
                pathname: '/admin/audit',
                params: { category: 'schedule', q: 'Schedule synced' },
              }}
              variant="secondary"
            />
          </Card>
        ) : null}
        <OperationDetails
          key={selected?.id ?? 'closed'}
          item={data.data?.items.find((item) => item.id === selected?.id) ?? null}
          section={section}
          onClose={() => setSelected(null)}
        />
        <AdminPanel title="History filters" open={filterOpen} onClose={() => setFilterOpen(false)}>
          {section !== 'audit' ? (
            <AdminSelect
              label="Status"
              value={status}
              onChange={(value) => change({ status: value })}
              options={(section === 'alerts'
                ? ['unresolved', 'resolved', 'all']
                : ['all', 'running', 'succeeded', 'failed', 'partial']
              ).map((value) => ({
                value,
                label: value === 'all' ? 'All statuses' : operationLabel(value),
              }))}
            />
          ) : (
            <>
              <AdminSelect
                label="Action category"
                value={params.category ?? ''}
                onChange={(value) => change({ category: value })}
                options={[
                  { value: '', label: 'All categories' },
                  ...categories.map((value) => ({ value, label: operationLabel(value) })),
                ]}
              />
              <Text style={ui.label}>Actor name, account ID, or System</Text>
              <TextInput
                accessibilityLabel="Filter audit actor"
                value={params.actor ?? ''}
                maxLength={120}
                onChangeText={(actor) => change({ actor })}
                style={ui.input}
              />
              <AdminSelect
                label="Affected item type"
                value={params.entity ?? ''}
                options={[
                  { value: '', label: 'All item types' },
                  ...[
                    ...new Set([
                      ...(data.data?.entityTypes ?? ['league', 'profile', 'game']),
                      ...(params.entity ? [params.entity] : []),
                    ]),
                  ]
                    .sort()
                    .map((value) => ({ value, label: operationLabel(value) })),
                ]}
                onChange={(entity) => change({ entity })}
              />
            </>
          )}
          <AdminDateInput
            label="From date"
            value={params.from ?? ''}
            onChange={(from) => change({ from })}
          />
          <AdminDateInput
            label="To date"
            value={params.to ?? ''}
            onChange={(to) => change({ to })}
          />
          {invalidDates ? (
            <Text accessibilityRole="alert" style={ui.body}>
              The From date must be on or before the To date.
            </Text>
          ) : null}
          <ActionButton
            label="Clear filters"
            variant="secondary"
            onPress={() =>
              change({
                status: section === 'alerts' ? 'unresolved' : 'all',
                category: undefined,
                actor: undefined,
                entity: undefined,
                from: undefined,
                to: undefined,
              })
            }
          />
          <ActionButton label="Done" disabled={invalidDates} onPress={() => setFilterOpen(false)} />
        </AdminPanel>
      </View>
    </AppShell>
  );
}
