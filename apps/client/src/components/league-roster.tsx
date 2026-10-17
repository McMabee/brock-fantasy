import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Card, EmptyState, SectionTitle, useUiStyles } from './ui';
import { PlayerInsightsPanel } from './player-insights';
import { DraftPlayerPhoto } from './player-photo';
import { RulesLink } from './rules-link';
import { usePlayerInsights } from '@/hooks/use-player-insights';
import type { LeagueRosterEntry } from '@/hooks/use-league';
import { ROSTER_GUIDE, positionLabel, rosterSlotLabel, slotEligibility } from '@/lib/roster-guide';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';

export function LeagueRoster({
  entries,
  poolId,
  editable,
  teamName,
  leagueId,
  betaLeague,
  varsity = false,
}: {
  entries: readonly LeagueRosterEntry[];
  poolId: string | undefined;
  editable: boolean;
  teamName: string;
  leagueId: string;
  betaLeague: boolean;
  varsity?: boolean;
}) {
  const insights = usePlayerInsights(poolId);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  // - Group once so starter slots and bench entries use constant time lookups
  const entriesBySlot = useMemo(() => {
    const grouped = new Map<string, LeagueRosterEntry[]>();
    for (const entry of entries) {
      const group = grouped.get(entry.slotCode) ?? [];
      group.push(entry);
      grouped.set(entry.slotCode, group);
    }
    return grouped;
  }, [entries]);
  const starters = entries.filter((entry) => entry.status === 'starter');
  const bench = entriesBySlot.get('BN') ?? [];
  const starterSlots = ROSTER_GUIDE.filter((slot) => slot.code !== 'BN');
  return (
    <View style={{ gap: 20 }}>
      <SectionTitle
        title={teamName}
        detail={
          betaLeague ? `${starters.length}/7 starters · ${bench.length}/3 bench` : 'Your athletes'
        }
      />
      {betaLeague ? (
        <>
          <Card style={{ gap: 8 }}>
            {varsity ? (
              <Text style={uiStyles.body}>
                Varsity format · two athletes of any position per sport, one any-sport FLEX and
                three shared bench spots
              </Text>
            ) : null}
            <Text style={uiStyles.body}>
              A ten-athlete team has seven starters and three bench spots. Starters earn matchup
              points; bench athletes are reserves. The owner can use Set lineup to move athletes
              into eligible spots.
            </Text>
            <Text style={uiStyles.body}>
              Each athlete locks at scheduled game start and unlocks when that game is marked
              finished. Bench athletes lock too. Unlimited eligible swaps between games affect
              future games only.
            </Text>
            <RulesLink section="roster" label="Roster rules & eligible positions" />
          </Card>
          <SectionTitle title="Starters" detail="These seven spots earn your team points" />
          <Card>
            {starterSlots.map((slot, index) => {
              const athletes = entriesBySlot.get(slot.code) ?? [];
              return (
                <View
                  key={slot.code}
                  style={[
                    styles.starterSlot,
                    index !== starterSlots.length - 1 && uiStyles.listRow,
                  ]}
                >
                  <Text
                    accessibilityRole="header"
                    accessibilityLabel={varsity ? rosterSlotLabel(slot.code, true) : slot.label}
                    style={styles.slotName}
                  >
                    {rosterSlotLabel(slot.code, varsity)}
                  </Text>
                  <Text style={styles.rosterMeta}>
                    Eligible: {slotEligibility(slot.code, varsity)}
                  </Text>
                  {athletes.length ? (
                    athletes.map((entry) => (
                      <RosterAthlete
                        onOpen={setAthleteId}
                        key={entry.id}
                        entry={entry}
                        betaLeague
                      />
                    ))
                  ) : (
                    <Text style={styles.emptySlot}>
                      Empty spot · add an eligible athlete or update your lineup
                    </Text>
                  )}
                </View>
              );
            })}
          </Card>
          <SectionTitle
            title={`${rosterSlotLabel('BN')} · ${bench.length}/3`}
            detail="Reserves · points do not count toward your matchup"
          />
          <Card>
            {bench.length ? (
              bench.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[styles.rosterRow, index === bench.length - 1 && uiStyles.lastRow]}
                >
                  <RosterAthlete onOpen={setAthleteId} entry={entry} betaLeague />
                </View>
              ))
            ) : (
              <Text style={uiStyles.body}>
                Your three bench spots are empty. Any eligible athlete can be a reserve.
              </Text>
            )}
          </Card>
        </>
      ) : entries.length > 0 ? (
        <Card>
          {entries.map((entry, index) => (
            <View
              key={entry.id}
              style={[styles.rosterRow, index === entries.length - 1 && uiStyles.lastRow]}
            >
              <RosterAthlete onOpen={setAthleteId} entry={entry} betaLeague={false} />
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState
          title="Roster is empty"
          body="Athletes appear here as draft picks and transactions commit."
        />
      )}
      {editable ? (
        <View style={styles.inlineActions}>
          <ActionButton
            label="Set lineup"
            href={betaLeague ? `/lineup-multisport/${leagueId}` : `/lineup/${leagueId}`}
          />
          <ActionButton
            label="Free agents, waivers & trades"
            href={`/transactions/${leagueId}`}
            variant="secondary"
          />
          {!betaLeague ? (
            <RulesLink section="roster" label="Roster rules & eligible positions" />
          ) : null}
        </View>
      ) : null}
      <PlayerInsightsPanel
        athleteId={athleteId}
        player={athleteId ? insights.byId.get(athleteId) : undefined}
        loading={insights.loading}
        error={insights.error}
        onClose={() => setAthleteId(null)}
      />
    </View>
  );
}

function RosterAthlete({
  entry,
  betaLeague,
  onOpen,
}: {
  entry: LeagueRosterEntry;
  betaLeague: boolean;
  onOpen: (id: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Insights for ${entry.displayName}`}
      onPress={() => onOpen(entry.athleteId)}
      style={styles.athleteRow}
    >
      <DraftPlayerPhoto player={{ displayName: entry.displayName, bio: entry.bio }} size={52} />
      <View style={styles.rosterCopy}>
        <Text style={styles.rosterName}>{entry.displayName}</Text>
        <Text style={styles.rosterMeta}>
          {entry.programName.replace(/^Brock /u, '')}
          {entry.jerseyNumber !== null ? ` · #${entry.jerseyNumber}` : ''}
        </Text>
        <Text style={styles.rosterMeta}>
          Player position: {betaLeague ? positionLabel(entry.position) : entry.position}
          {!betaLeague ? ` · Assigned to ${rosterSlotLabel(entry.slotCode)} · ${entry.status}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    rosterRow: {
      paddingVertical: 14,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rosterCopy: { flex: 1, minWidth: 0 },
    starterSlot: { paddingVertical: 14, gap: 6 },
    slotName: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '700',
    },
    athleteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, minWidth: 0 },
    emptySlot: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 13,
      lineHeight: 20,
      paddingVertical: 10,
    },
    rosterName: { fontFamily: 'Inter', color: colors.text, fontSize: 16, fontWeight: '700' },
    rosterMeta: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 3,
    },
    inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 15 },
  });
