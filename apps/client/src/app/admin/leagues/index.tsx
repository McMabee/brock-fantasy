import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AdminAccess } from '@/components/admin-access';
import {
  ActionButton,
  AppShell,
  Card,
  EmptyState,
  LoadingState,
  Pill,
  useUiStyles,
} from '@/components/ui';
import { LeagueMultiChoices, LeagueFact, LeagueRefresh } from '@/components/admin-league-ui';
import { useRequireAdmin } from '@/hooks/use-route-access';
import { useAdminLeagueRead } from '@/hooks/use-admin-leagues';
import { adminLeaguePath } from '@/lib/admin-navigation';
import {
  adminDate,
  leagueFilterValues,
  LEAGUE_STATUS_FILTERS,
  LEAGUE_STATUS_LABELS,
  type AdminLeaguePage,
  type AdminLeagueSummary,
} from '@/lib/admin-leagues';
import { useThemeColors } from '@/providers/theme-provider';
import { useSession } from '@/providers/session-provider';

export default function AdminLeagueDirectory() {
  const access = useRequireAdmin();
  const { readScope } = useSession();
  const [deniedScope, setDeniedScope] = useState<object | null>(null);
  const enabled = access.allowed && deniedScope !== readScope;
  const params = useLocalSearchParams<Record<string, string>>();
  const router = useRouter();
  const ui = useUiStyles();
  const colors = useThemeColors();
  const season = params.season ?? 'current';
  const status = params.status ?? 'open';
  const seasons = leagueFilterValues(params.season, 'current');
  const statuses = leagueFilterValues(params.status, 'open');
  const query = typeof params.q === 'string' ? params.q.slice(0, 320) : '';
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const summary = useAdminLeagueRead<AdminLeagueSummary>(
    'admin_get_league_summary',
    {},
    enabled,
    60_000,
    () => setDeniedScope(readScope),
  );
  const page = useAdminLeagueRead<AdminLeaguePage>(
    'admin_list_leagues_filtered',
    {
      p_seasons: seasons,
      p_statuses: statuses,
      p_query: query,
      p_before_at: params.beforeAt ?? null,
      p_before_id: params.beforeId ?? null,
    },
    enabled,
    60_000,
    () => setDeniedScope(readScope),
  );
  const pageNumber = Math.max(1, Math.min(1000000, Number(params.page) || 1));
  const change = (values: Record<string, string>) =>
    router.setParams({ beforeAt: undefined, beforeId: undefined, page: undefined, ...values });
  if (!enabled)
    return (
      <AdminAccess
        loading={access.loading}
        error={
          deniedScope === readScope
            ? 'Administrator access is no longer available. Sign in and verify MFA again.'
            : access.error
        }
      />
    );
  return (
    <AppShell eyebrow="Operations centre" title="League directory">
      <View style={{ gap: 18 }}>
        <ActionButton label="Back to Operations Centre" href="/admin" variant="secondary" />
        <Card style={{ gap: 18 }}>
          {summary.error ? (
            <Text accessibilityRole="alert" style={ui.body}>
              {summary.error}
            </Text>
          ) : null}
          <LeagueMultiChoices
            label="Season"
            selected={seasons}
            onChange={(values) => change({ season: values.join(',') || 'all' })}
            choices={[
              { value: 'current', label: 'Current' },
              { value: 'previous', label: 'Previous' },
              ...(summary.data?.seasons ?? []).map((label) => ({ value: label, label })),
            ]}
          />
          <LeagueMultiChoices
            label="Status"
            selected={statuses}
            onChange={(values) => change({ status: values.join(',') || 'all' })}
            choices={LEAGUE_STATUS_FILTERS.filter((value) => value !== 'all').map((value) => ({
              value,
              label: LEAGUE_STATUS_LABELS[value]!,
            }))}
          />
          <Text style={ui.label}>Find a league, team, or member</Text>
          <TextInput
            accessibilityLabel="Find a league, team, or member"
            placeholder="League name/ID, team, member name, or email"
            placeholderTextColor={colors.muted}
            value={draft}
            maxLength={320}
            onChangeText={setDraft}
            style={ui.input}
            returnKeyType="search"
            onSubmitEditing={() => change({ q: draft.trim() })}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <ActionButton label="Search leagues" onPress={() => change({ q: draft.trim() })} />
            {query ? (
              <ActionButton
                label="Clear search"
                variant="secondary"
                onPress={() => {
                  setDraft('');
                  change({ q: '' });
                }}
              />
            ) : null}
          </View>
        </Card>
        <LeagueRefresh
          {...page}
          summary={
            page.data
              ? `Showing ${page.data.filteredCount} of ${page.data.totalCount} total leagues`
              : undefined
          }
          refresh={async () => {
            await Promise.all([page.refresh(), summary.refresh()]);
          }}
        />
        {page.loading && !page.data ? <LoadingState label="Loading leagues" /> : null}
        {page.data?.items.map((league) => (
          <Card key={league.id} style={{ gap: 15 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <Text accessibilityRole="header" style={[ui.label, { fontSize: 20, flexGrow: 1 }]}>
                {league.name}
              </Text>
              <Pill label={LEAGUE_STATUS_LABELS[league.status]!} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
              <LeagueFact label="Season" value={league.season_label} />
              <LeagueFact label="Commissioner" value={league.commissioner} />
              <LeagueFact label="Members" value={`${league.member_count}/${league.max_members}`} />
              <LeagueFact label="Created" value={adminDate(league.created_at)} />
            </View>
            <ActionButton
              label={`View ${league.name}`}
              variant="secondary"
              href={adminLeaguePath(`/admin/leagues/${league.id}`, {
                ...params,
                season,
                status,
                q: query,
              })}
            />
          </Card>
        ))}
        {page.data?.items.length === 0 ? (
          <EmptyState title="No leagues found" body="Try another season, status, or search." />
        ) : null}
        {page.data ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <Text style={ui.body}>Page {pageNumber}</Text>
            {pageNumber > 1 ? (
              <ActionButton label="First page" variant="secondary" onPress={() => change({})} />
            ) : null}
            {page.data.hasMore && page.data.nextCursor ? (
              <ActionButton
                label="Next page"
                variant="secondary"
                onPress={() =>
                  router.setParams({
                    beforeAt: page.data!.nextCursor!.at,
                    beforeId: page.data!.nextCursor!.id,
                    page: String(pageNumber + 1),
                  })
                }
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </AppShell>
  );
}
