import {
  BETA_RULE_VERSION,
  BETA_SEASON,
  STAT_WEIGHTS,
  TRADE_DEADLINE,
} from '@brock-fantasy/domain';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppShell, Card, SectionTitle, useUiStyles } from '@/components/ui';
import { RulesLink } from '@/components/rules-link';
import { ROSTER_GUIDE, slotEligibility } from '@/lib/roster-guide';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';

const SECTIONS = [
  { id: 'overview', label: 'Getting started' },
  { id: 'roster', label: 'Roster & positions' },
  { id: 'draft', label: 'Draft' },
  { id: 'lineup', label: 'Lineup & locks' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'transactions', label: 'Waivers & trades' },
  { id: 'stats', label: 'Stats & ADP' },
] as const;
const SCORING = [
  { key: 'skater', label: 'Hockey skaters' },
  { key: 'goalie', label: 'Hockey goalies' },
  { key: 'basketball', label: 'Basketball' },
  { key: 'volleyball', label: 'Volleyball' },
] as const;
const STAT_LABELS: Readonly<Record<string, string>> = {
  multi_point: 'Game with 2+ goals and assists combined',
  double_double: 'Double-double',
  hitter_bonus: 'Hitter with 10+ kills',
  setter_bonus: 'Setter with 40+ assists',
  libero_bonus: 'Libero with 8+ digs',
  foul_out: 'Foul-out penalty',
};

export default function RulesScreen() {
  const ui = useUiStyles();
  const styles = useThemedStyles(createStyles);
  const { section } = useLocalSearchParams<{ section?: string }>();
  const router = useRouter();
  const selected = SECTIONS.some((item) => item.id === section) ? section : 'overview';
  return (
    <AppShell
      eyebrow={`${BETA_SEASON} beta · ${BETA_RULE_VERSION}`}
      title="How to play Brock Fantasy"
    >
      <Text style={ui.body}>
        Build one fantasy team from Brock men’s and women’s hockey, basketball and volleyball. Your
        starters earn fantasy points from their real games.
      </Text>
      <View accessibilityRole="tablist" accessibilityLabel="Rules topics" style={styles.tabs}>
        {SECTIONS.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === item.id }}
            aria-selected={selected === item.id}
            onPress={() => router.setParams({ section: item.id })}
            style={[styles.tab, selected === item.id && styles.selected]}
          >
            <Text style={ui.body}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {selected === 'overview' ? (
        <Card style={styles.content}>
          <SectionTitle title="Your first season" />
          <Paragraph title="1. Join or create a league">
            Private beta leagues have 4, 6, 8 or 10 managers. Each manager owns one fantasy team.
            Join with an invite code, or create a league and invite your friends.
          </Paragraph>
          <Paragraph title="2. Draft ten athletes">
            Take turns choosing athletes. An athlete can belong to only one team in your league, but
            can be drafted independently in other leagues. Fill six starter spots and four bench
            spots from the combined six-program pool.
          </Paragraph>
          <Paragraph title="3. Choose your starters">
            Open your league’s Roster tab, then Set lineup. Starters earn team points; bench
            athletes are reserves. Save your lineup before each athlete’s first game of the fantasy
            period.
          </Paragraph>
          <Paragraph title="4. Follow your matchup">
            A fantasy period is the scoring window shown by your league, which can cover more than
            one week. In head-to-head leagues, your starters’ points are compared with one
            opponent’s points for that period. The higher score wins; equal scores are a tie.
            Standings use win percentage, then head-to-head results among tied teams, total points,
            and preseason order.
          </Paragraph>
          <Paragraph title="Season calendar">
            The beta calendar has eight regular-season periods, followed by semifinal and final
            periods. Period lengths vary and there is a winter break. Your league overview shows the
            matchups actually scheduled by your commissioner; a fantasy period is not always a
            calendar week.
          </Paragraph>
          <RulesLink section="roster" label="See all roster spots and eligible positions" />
        </Card>
      ) : null}
      {selected === 'roster' ? (
        <Card style={styles.content}>
          <SectionTitle title="Six starters + four bench = ten athletes" />
          <Text style={ui.body}>
            Fill each starter spot with one eligible athlete. Men’s and women’s programs can fill
            the same sport’s spots. A player’s real position determines where they can play in your
            fantasy lineup; their fantasy slot is the place you assign them.
          </Text>
          {ROSTER_GUIDE.map((slot, index) => (
            <View
              key={slot.code}
              style={[styles.ruleRow, index !== ROSTER_GUIDE.length - 1 && ui.listRow]}
            >
              <View style={styles.rowCopy}>
                <Text style={ui.label}>
                  {slot.label} · {slot.count} {slot.count === 1 ? 'spot' : 'spots'}
                </Text>
                <Text style={ui.body}>Eligible: {slotEligibility(slot.code)}</Text>
                <Text style={styles.note}>
                  {slot.code} · {slot.code === 'BN' ? 'Reserve' : 'Starter'}
                </Text>
              </View>
            </View>
          ))}
          <Paragraph title="What the position names mean">
            Hockey forwards include centres and wings. Basketball guards are backcourt players;
            forwards and centres are frontcourt players. Volleyball hitters include outside hitters,
            opposites and middle blockers. Libero and setter share one starter spot.
          </Paragraph>
          <Paragraph title="Flexible positions and reserves">
            If an athlete has more than one eligible position, they can fill either matching slot,
            but only one slot at a time. Any eligible athlete can sit on your bench. Bench points do
            not count toward your matchup, and there is no separate injured-reserve spot in the
            beta.
          </Paragraph>
          <Text style={ui.body}>
            Example: a women’s hockey goalie can fill Hockey defence or goalie, or Bench. A men’s
            volleyball setter can fill Volleyball libero or setter, or Bench.
          </Text>
          <RulesLink section="lineup" label="Learn when your lineup locks" />
        </Card>
      ) : null}
      {selected === 'draft' ? (
        <Card style={styles.content}>
          <SectionTitle title="Ten rounds of a snake draft" />
          <Paragraph title="Draft order">
            The starting order is randomized once. Each round reverses that order: in a four-team
            league, round one goes 1 → 2 → 3 → 4 and round two goes 4 → 3 → 2 → 1. Ten rounds give
            each manager ten athletes.
          </Paragraph>
          <Paragraph title="Your turn">
            You have two minutes to pick while the draft is active. The commissioner starts the
            draft and can pause or resume it. A scheduled draft time is a reminder; it does not
            start the draft automatically.
          </Paragraph>
          <Paragraph title="Queues and automatic picks">
            Put your preferred athletes in your queue. If your timer expires, the system takes your
            first available legal queued athlete. With no legal queued choice, it uses a weighted
            choice among the top five ranked legal athletes, favouring higher ranks. An automatic
            pick may happen shortly after the timer reaches zero.
          </Paragraph>
          <Paragraph title="Why a player may be unavailable">
            A player may already be drafted, be ineligible, or leave you unable to complete all six
            starter slots with the remaining player pool. Draft choices must allow a legal final
            roster; bench spots do not remove the need to fill every starter position.
          </Paragraph>
          <Paragraph title="After the final pick">
            The draft room closes. View every recorded pick through Draft results in league Settings
            or on the league overview, then review your lineup.
          </Paragraph>
          <RulesLink section="roster" label="Check roster requirements before drafting" />
        </Card>
      ) : null}
      {selected === 'lineup' ? (
        <Card style={styles.content}>
          <SectionTitle title="Set your lineup before games begin" />
          <Paragraph title="Save your assignments">
            Set lineup shows the spots each athlete is eligible to fill. Move athletes between an
            eligible starter spot and the bench, then save all ten assignments. To replace a starter
            on a full roster, select that starter spot on an eligible reserve’s card. The two
            athletes swap places when both are unlocked and eligible for their new spots. Save to
            confirm.
          </Paragraph>
          <Paragraph title="The first game locks the period">
            Each athlete and their occupied slot lock at that athlete’s first scheduled game of the
            fantasy period. The lock lasts until the period ends. Both starters and bench athletes
            lock, so you cannot promote a benched athlete after seeing their game result.
          </Paragraph>
          <Paragraph title="An example">
            If your hockey forward’s first game is Friday at 7 pm, their assignment locks then for
            the rest of the period, including later games. Another athlete who has not yet reached
            their first game can still be moved if the destination slot is free and unlocked.
          </Paragraph>
          <Paragraph title="Games and points">
            A locked starter earns points from eligible games in that period. Bench athletes do not
            earn matchup points. Use the lock times shown on Set lineup and the period end time to
            plan changes; the athlete’s next game alone does not reset a period lock.
          </Paragraph>
        </Card>
      ) : null}
      {selected === 'scoring' ? (
        <View style={styles.content}>
          <Card style={styles.content}>
            <SectionTitle title="Real game stats become fantasy points" />
            <Text style={ui.body}>
              Each recorded statistic is multiplied by the value below. Bonuses apply once per game
              when their condition is met. Penalties can make a score negative. Only eligible
              starter games count toward your team; historical totals and projections do not. During
              beta testing, scoring may be paused while game data is being prepared.
            </Text>
          </Card>
          {SCORING.map((category) => (
            <Card key={category.key}>
              <SectionTitle title={category.label} />
              {Object.entries(STAT_WEIGHTS[category.key]).map(([stat, points], index, rows) => (
                <View key={stat} style={[styles.ruleRow, index !== rows.length - 1 && ui.listRow]}>
                  <Text style={[ui.body, styles.rowCopy]}>
                    {STAT_LABELS[stat] ?? stat.replaceAll('_', ' ')}
                  </Text>
                  <Text style={ui.label}>
                    {points > 0 ? '+' : ''}
                    {points} FP
                  </Text>
                </View>
              ))}
            </Card>
          ))}
          <Card style={styles.content}>
            <Paragraph title="Bonus details">
              A hockey multi-point bonus requires at least two goals and assists combined. A
              basketball double-double requires 10 or more in at least two categories: points, total
              rebounds, assists, steals or blocks. Volleyball bonuses depend on the athlete’s
              eligible position. Volleyball errors include attack, service, reception, setting,
              ball-handling and blocking errors.
            </Paragraph>
            <Paragraph title="Goalies and corrections">
              Shutout credit requires full-game solo participation and either no goals allowed or
              the qualifying shootout flag. Missing required stats leave the game score unavailable
              until completed; missing is not zero. Corrected official stats can update previously
              displayed points.
            </Paragraph>
          </Card>
        </View>
      ) : null}
      {selected === 'transactions' ? (
        <Card style={styles.content}>
          <SectionTitle title="Improve your roster after the draft" />
          <Paragraph title="Free agents">
            A free agent is an eligible athlete who is not owned in your league and is available
            immediately. Add them through Free agents, waivers & trades. If your roster already has
            ten athletes, choose someone to drop. The incoming athlete must fit an available legal
            spot, and a locked athlete cannot be dropped.
          </Paragraph>
          <Paragraph title="Waiver claims">
            Dropped athletes have a 24-hour waiver window. An unowned athlete whose first game has
            already locked can remain on waivers until the period ends. Submit a claim instead of an
            immediate add. At settlement, lower-ranked teams have priority; creation time breaks
            equal priority. A claim may fail if another manager wins it or your roster can no longer
            make the requested change.
          </Paragraph>
          <Paragraph title="Trades">
            Offer athletes to another manager in the same league. The receiving manager must accept,
            and the trade then goes through a 24-hour review period. Only managers outside the trade
            may veto it: 2 votes in a 4-team league, 3 in a 6-team league, or 4 in an 8- or 10-team
            league. Acceptance does not move athletes immediately. Locked rosters can delay
            execution, and both resulting rosters must remain legal.
          </Paragraph>
          <Text style={ui.body}>
            The {BETA_SEASON} trade deadline is{' '}
            {new Date(TRADE_DEADLINE).toLocaleString('en-CA', {
              timeZone: 'America/Toronto',
              dateStyle: 'long',
              timeStyle: 'short',
            })}{' '}
            (Toronto time).
          </Text>
        </Card>
      ) : null}
      {selected === 'stats' ? (
        <Card style={styles.content}>
          <SectionTitle title="Read player stats with confidence" />
          <Paragraph title="Projected FP">
            Projected fantasy points are the supplied estimate for the full season. They help you
            compare players before drafting and do not add points to your team. Weekly forecasts are
            shown only when available.
          </Paragraph>
          <Paragraph title="ADP: average draft position">
            Lower ADP means an athlete is usually picked earlier. The supplied ADP counts as one
            starting observation. Every recorded pick from a completed, unvoided draft in the same
            season pool contributes its overall pick number across all leagues, including beta test
            drafts and automatic picks.
          </Paragraph>
          <Text style={ui.body}>
            Example: a supplied ADP of 20 and completed-draft picks at 10 and 15 give an ADP of (20
            + 10 + 15) ÷ 3 = 15. With no supplied value, ADP uses recorded completed picks alone.
            Picks from unfinished or voided drafts do not count.
          </Text>
          <Paragraph title="History, height and missing data">
            Season history describes earlier results and never scores your current team. Heights are
            shown when supplied or verified. An em dash (—) means the value is unavailable; a
            recorded zero or negative value is still a real value. The athlete’s profile contains
            their season records and game scoring breakdown.
          </Paragraph>
        </Card>
      ) : null}
      <View style={styles.actions}>
        <ActionButton
          label="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/dashboard'))}
          variant="ghost"
        />
        <ActionButton label="Your leagues" href="/dashboard" variant="secondary" />
        <ActionButton label="Explore players" href="/players" variant="secondary" />
      </View>
    </AppShell>
  );
}

function Paragraph({ title, children }: { title: string; children: string }) {
  const ui = useUiStyles();
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={ui.label}>
        {title}
      </Text>
      <Text style={ui.body}>{children}</Text>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 20 },
    tab: {
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    selected: { borderColor: colors.brand, backgroundColor: colors.canvasSoft },
    content: { gap: 18 },
    ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
    rowCopy: { flex: 1, minWidth: 0 },
    note: { color: colors.muted, fontFamily: 'Inter', fontSize: 12, marginTop: 6 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  });
