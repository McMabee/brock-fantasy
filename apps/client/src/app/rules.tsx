import { BETA_SEASON, STAT_WEIGHTS, TRADE_DEADLINE } from '@brock-fantasy/domain';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppShell, Card, useUiStyles } from '@/components/ui';
import { RulesLink } from '@/components/rules-link';
import { ROSTER_GUIDE, slotEligibility } from '@/lib/roster-guide';
import { useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { fonts } from '@/theme';

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
  multi_point: 'Multi-point game bonus',
  double_double: 'Double-double bonus',
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
    <AppShell eyebrow={`${BETA_SEASON}, Fantasy rules`} title="How to play Brock Fantasy">
      <Text style={styles.body}>
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
            tabIndex={selected === item.id ? 0 : -1}
            nativeID={`rules-tab-${item.id}`}
            aria-controls="rules-content"
            onPress={() => router.setParams({ section: item.id })}
            style={[styles.tab, selected === item.id && styles.selected]}
          >
            <Text style={styles.body}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <View
        role="tabpanel"
        nativeID="rules-content"
        aria-labelledby={`rules-tab-${selected}`}
        tabIndex={0}
      >
        {selected === 'overview' ? (
          <Card style={styles.article}>
            <RulesHeading title="Your first season" />
            <Paragraph title="1. Join or create a league">
              Private leagues have 4, 6, 8 or 10 managers. Each manager owns one fantasy team. Join
              with an invite code, or create a league and invite your friends. New leagues join the
              newest published season while an eligible regular-season period remains. League
              creation closes before playoffs.
            </Paragraph>
            <Paragraph title="2. Draft ten athletes">
              Take turns choosing athletes. An athlete can belong to only one team in your league,
              but can be drafted independently in other leagues. Fill seven starter spots and three
              bench spots from the combined six-program pool.
            </Paragraph>
            <Paragraph title="3. Choose your starters">
              Open your league’s Roster tab, then Set lineup. Starters earn team points; bench
              athletes are reserves. Save your lineup before each athlete’s next game.
            </Paragraph>
            <Paragraph title="4. Follow your matchup">
              A fantasy period is the scoring window shown by your league, which can cover more than
              one week. In head-to-head leagues, your starters’ points are compared with one
              opponent’s points for that period. The higher score wins; equal scores are a tie.
              Standings use win percentage, then head-to-head results among tied teams, total
              points, and preseason order.
            </Paragraph>
            <Paragraph title="Season calendar">
              The season calendar has eight regular-season periods, followed by semifinal and final
              periods. Period lengths vary and there is a winter break. Your league overview shows
              the matchups created automatically after your draft; a fantasy period is not always a
              calendar week. Eight-manager leagues use the first seven regular periods; other
              supported sizes use eight. Your draft completion time fixes your first playable
              period. Complete it before that period’s first scoring-game lock to participate.
              Missed periods earn no points, and a draft completed after the final cutoff has no
              scoring or playoff entry.
            </Paragraph>
            <Paragraph title="Eight-manager round robin">
              An eight-manager league plays one round-robin cycle: seven rounds, with every team
              facing each of its seven opponents once.
            </Paragraph>
            <RulesLink section="roster" label="See all roster spots and eligible positions" />
          </Card>
        ) : null}
        {selected === 'roster' ? (
          <Card style={styles.article}>
            <RulesHeading title="Seven starters + three bench = ten athletes" />
            <Paragraph title="Varsity participant format">
              When a Brock varsity athlete or coach joins, the entire league adopts the varsity
              format: any two hockey athletes (forward, defence or goalie), any two basketball
              athletes (backcourt or frontcourt), any two volleyball athletes (hitter, libero or
              setter), one any-sport FLEX starter, and three shared bench spots. FLEX is the seventh
              starter. This format remains in place for the league’s season.
            </Paragraph>
            <Paragraph title="Your own varsity program">
              Varsity athletes and coaches cannot draft, add, claim or receive athletes from any
              Brock team they play for or coach. For example, a member of women’s volleyball cannot
              acquire any women’s volleyball athlete. Declare every applicable program at signup; an
              administrator can correct it. If your status changes after drafting, replace
              conflicting athletes before saving your next lineup. They cannot earn points for games
              starting after that change; points already earned remain.
            </Paragraph>
            <RulesHeading title="Standard participant format" />
            <Text style={styles.body}>
              Fill each starter spot with one eligible athlete. Men’s and women’s programs can fill
              the same sport’s spots. A player’s real position determines where they can play in
              your fantasy lineup; their fantasy slot is the place you assign them.
            </Text>
            {ROSTER_GUIDE.map((slot, index) => (
              <View
                key={slot.code}
                style={[styles.ruleRow, index !== ROSTER_GUIDE.length - 1 && ui.listRow]}
              >
                <View style={styles.rowCopy}>
                  <Text
                    accessibilityRole="header"
                    accessibilityLabel={slot.label}
                    {...{ dataSet: { bfFont: 'body' } }}
                    style={styles.paragraphTitle}
                  >
                    <Text accessible={false}>{slot.icon} </Text>
                    {slot.shortLabel}
                  </Text>
                  <Text style={styles.body}>Eligible: {slotEligibility(slot.code)}</Text>
                  <Text style={styles.note}>
                    {slot.count} {slot.count === 1 ? 'spot' : 'spots'},{' '}
                    {slot.code === 'BN' ? 'Reserve' : 'Starter'}
                  </Text>
                </View>
              </View>
            ))}
            <Paragraph title="What the position names mean">
              Hockey forwards include centres and wings. Basketball guards are backcourt players;
              forwards and centres are frontcourt players. Volleyball hitters include outside
              hitters, opposites and middle blockers. Libero and setter share one starter spot.
            </Paragraph>
            <Paragraph title="Flexible positions and reserves">
              If an athlete has more than one eligible position, they can fill either matching slot,
              but only one slot at a time. Any athlete, including a goalie, can fill FLEX or sit on
              your bench. Bench points do not count toward your matchup, and there is no separate
              injured-reserve spot.
            </Paragraph>
            <Text style={styles.body}>
              Example: A women’s hockey goalie can fill Hockey defence or goalie, FLEX, or Bench. A
              men’s volleyball setter can fill Volleyball libero or setter, FLEX, or Bench.
            </Text>
            <RulesLink section="lineup" label="Learn when your lineup locks" />
          </Card>
        ) : null}
        {selected === 'draft' ? (
          <Card style={styles.article}>
            <RulesHeading title="Ten rounds of a snake draft" />
            <Paragraph title="Draft order">
              The starting order is randomized once. Each round reverses that order: in a four-team
              league, round one goes 1 → 2 → 3 → 4 and round two goes 4 → 3 → 2 → 1. Ten rounds give
              each manager ten athletes.
            </Paragraph>
            <Paragraph title="Your turn">
              Each pick defaults to two minutes. Before the draft starts, the commissioner can save
              a different pick timer with a minimum of 20 seconds. In Live draft mode, the
              commissioner starts the draft and can pause or resume it. Its planned time is a
              reminder. When Scheduled automatic draft is enabled, the system starts at the chosen
              time and commits legal picks from each manager’s private rankings, using approved
              defaults when needed. Managers do not need to be online.
            </Paragraph>
            <Paragraph title="Queues and automatic picks">
              Put your preferred athletes in your queue. If your timer expires, the system takes
              your first available legal queued athlete. With no legal queued choice, it uses a
              weighted choice among the top five ranked legal athletes, favouring higher ranks. An
              automatic pick may happen shortly after the timer reaches zero.
            </Paragraph>
            <Paragraph title="Why a player may be unavailable">
              A player may already be drafted, be ineligible, or leave you unable to complete all
              seven starter slots with the remaining player pool. Draft choices must allow a legal
              final roster; bench spots do not remove the need to fill every starter position.
            </Paragraph>
            <Paragraph title="After the final pick">
              The draft room closes. Open your league’s Settings tab and select Draft results to
              view every recorded pick, then review your lineup.
            </Paragraph>
            <RulesLink section="roster" label="Check roster requirements before drafting" />
          </Card>
        ) : null}
        {selected === 'lineup' ? (
          <Card style={styles.article}>
            <RulesHeading title="Set your lineup before games begin" />
            <Paragraph title="Save your assignments">
              Set lineup shows the spots each athlete is eligible to fill. Move athletes between an
              eligible starter spot and the bench, then save all ten assignments. To replace a
              starter on a full roster, select that starter spot on an eligible reserve’s card. The
              two athletes swap places when both are unlocked and eligible for their new spots. Save
              to confirm.
            </Paragraph>
            <Paragraph title="Each game locks its athletes">
              Every athlete, including bench athletes, locks at scheduled game start and unlocks
              when that game is marked finished. Other athletes remain movable. A game uses the
              starting lineup captured when it begins, so later changes cannot earn points
              retroactively.
            </Paragraph>
            <Paragraph title="Unlimited substitutions between games">
              You can substitute eligible athletes without a weekly limit and bring an athlete back
              for a later game. If Athlete A earns 10 points, then you replace A with Athlete B
              before B’s next game, A’s 10 points remain and B’s later starting games also count.
            </Paragraph>
            <Paragraph title="Schedule exceptions and confirmation">
              Cancelled games are excluded from projections. Postponed games unlock affected
              athletes and are excluded until a replacement start is published. Rescheduled games
              belong to the fantasy period containing the new start time. Official schedule changes
              apply immediately and show ⚠ Pending confirmation until an administrator confirms
              them. Admin overrides remain authoritative until cleared. Unplayed postponed games
              capture a fresh lineup at their replacement start. Games with recorded stats or earned
              points retain their historical assignments and game identity.
            </Paragraph>
          </Card>
        ) : null}
        {selected === 'scoring' ? (
          <View style={styles.content}>
            <Card style={styles.article}>
              <RulesHeading title="Real game stats become fantasy points" />
              <Text style={styles.body}>
                Each recorded statistic is multiplied by the value below. Bonuses apply once per
                game when their condition is met. Penalties can make a score negative. Only eligible
                starter games count toward your team; historical totals and projections do not.
                Scoring may be paused while game data is being prepared.
              </Text>
            </Card>
            {SCORING.map((category) => (
              <Card key={category.key} style={styles.article}>
                <RulesHeading title={category.label} />
                {Object.entries(STAT_WEIGHTS[category.key]).map(([stat, points], index, rows) => (
                  <View
                    key={stat}
                    style={[styles.ruleRow, index !== rows.length - 1 && ui.listRow]}
                  >
                    <Text style={[styles.body, styles.rowCopy]}>
                      {STAT_LABELS[stat] ?? stat.replaceAll('_', ' ')}
                    </Text>
                    <Text style={styles.points}>
                      {points > 0 ? '+' : ''}
                      {points} {Math.abs(points) === 1 ? 'point' : 'points'}
                    </Text>
                  </View>
                ))}
              </Card>
            ))}
            <Card style={styles.article}>
              <Paragraph title="Bonus details">
                A hockey multi-point bonus requires at least two goals and assists combined. A
                basketball double-double requires 10 or more in at least two categories: points,
                total rebounds, assists, steals or blocks. Volleyball bonuses depend on the
                athlete’s eligible position. Volleyball errors include attack, service, reception,
                setting, ball-handling and blocking errors.
              </Paragraph>
              <Paragraph title="Goalies and corrections">
                Shutout credit requires full-game solo participation and no goals allowed. Going to
                a shootout does not award shutout credit. Missing required stats leave the game
                score unavailable until completed; missing is not zero. Corrected official stats can
                update previously displayed points.
              </Paragraph>
            </Card>
          </View>
        ) : null}
        {selected === 'transactions' ? (
          <Card style={styles.article}>
            <RulesHeading title="Improve your roster after the draft" />
            <Paragraph title="Free agents">
              A free agent is an eligible athlete who is not owned in your league and is available
              immediately. Add them through Free agents, waivers & trades. If your roster already
              has ten athletes, choose someone to drop. The incoming athlete must fit an available
              legal spot, and a locked athlete cannot be dropped.
            </Paragraph>
            <Paragraph title="Waiver claims">
              Dropped athletes have a 24-hour waiver window. Athletes cannot be acquired or dropped
              during their games, but become movable again after their game is marked finished.
              Submit a claim during the waiver window instead of an immediate add. At settlement,
              lower-ranked teams have priority; creation time breaks equal priority. A claim may
              fail if another manager wins it or your roster can no longer make the requested
              change.
            </Paragraph>
            <Paragraph title="Trades">
              Offer athletes to another manager in the same league. The receiving manager must
              accept, and the trade then goes through a 24-hour review period. Only managers outside
              the trade may veto it: 2 votes in a 4-team league, 3 in a 6-team league, or 4 in an 8-
              or 10-team league. Acceptance does not move athletes immediately. A traded athlete’s
              ongoing game can delay execution, and both resulting rosters must remain legal.
            </Paragraph>
            <Text style={styles.body}>
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
          <Card style={styles.article}>
            <RulesHeading title="Read player stats with confidence" />
            <Paragraph title="Projected FP">
              Projected fantasy points are the supplied estimate for the full season. They help you
              compare players before drafting and do not add points to your team. Next-period
              forecasts use supplied season projected points divided by projected games, multiplied
              by scheduled games in the next fantasy period. Period dates are displayed; before the
              season this means the first upcoming period. Known zero-game periods show 0. Missing
              or invalid inputs show Unavailable, sort last, and are flagged to administrators.
              Forecasts using an unconfirmed schedule are marked pending confirmation.
            </Paragraph>
            <Paragraph title="ADP: average draft position">
              Lower ADP means an athlete is usually picked earlier. The supplied ADP counts as one
              starting observation. Every recorded pick from a completed, unvoided draft in the same
              season pool contributes its overall pick number across all leagues, including
              completed test drafts and automatic picks.
            </Paragraph>
            <Text style={styles.body}>
              Example: A supplied ADP of 20 and completed-draft picks at 10 and 15 give an ADP of
              (20 + 10 + 15) ÷ 3 = 15. With no supplied value, ADP uses recorded completed picks
              alone. Picks from unfinished or voided drafts do not count.
            </Text>
            <Paragraph title="History, height and missing data">
              Season history describes earlier results and never scores your current team. Heights
              are shown when supplied or verified. An em dash (—) means the value is unavailable; a
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
      </View>
    </AppShell>
  );
}

function Paragraph({ title, children }: { title: string; children: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={{ gap: 6 }}>
      <Text
        accessibilityRole="header"
        {...{ dataSet: { bfFont: 'body' } }}
        style={styles.paragraphTitle}
      >
        {title}
      </Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

function RulesHeading({ title }: { title: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Text
      accessibilityRole="header"
      {...{ dataSet: { bfFont: 'body' } }}
      style={styles.sectionHeading}
    >
      {title}
    </Text>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    body: { fontFamily: fonts.body, color: colors.muted, fontSize: 16, lineHeight: 26 },
    paragraphTitle: {
      fontFamily: fonts.body,
      color: colors.text,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: '700',
    },
    sectionHeading: {
      fontFamily: fonts.body,
      color: colors.text,
      fontSize: 22,
      lineHeight: 30,
      fontWeight: '800',
    },
    points: {
      fontFamily: fonts.body,
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      backgroundColor: colors.canvasSoft,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
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
    content: { gap: 20 },
    article: { gap: 20, paddingTop: 28, paddingBottom: 24, paddingHorizontal: 24 },
    ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
    rowCopy: { flex: 1, minWidth: 0 },
    note: {
      color: colors.muted,
      fontFamily: fonts.body,
      fontSize: 16,
      lineHeight: 24,
      marginTop: 6,
    },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  });
