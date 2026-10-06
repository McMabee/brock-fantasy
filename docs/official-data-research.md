# Official data research and import review

Research date: October 6, 2026. Target season: 2026–27. Status: local candidate preparation; human review and staging activation remain outstanding.

The manual research command `pnpm research:official-data` reads the six public Brock schedule pages, six season-specific roster pages, and six 2025–26 cumulative-statistics pages. It stores raw HTML under ignored `tmp/official-research/` and a report at `tmp/brock-official-research.json`. It does not use an authenticated sports API, install a recurring scraper, write to Supabase, or award points. The retained [official-source evidence](evidence/2026-10-06-official-data.json) records URLs, retrieval times, response hashes, schedule candidates and season-specific bio references. Reruns produce a new review artifact; replacing the retained evidence requires another review.

| Program            | Official 2026–27 roster entries | Official regular-season games | Schedule source                                                                            |
| ------------------ | ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Men's hockey       | 31                              | 28                            | [Brock schedule](https://gobadgers.ca/sports/mens-ice-hockey/schedule/2026-27?grid=true)   |
| Women's hockey     | 27                              | 26                            | [Brock schedule](https://gobadgers.ca/sports/womens-ice-hockey/schedule/2026-27?grid=true) |
| Men's basketball   | 17                              | 22                            | [Brock schedule](https://gobadgers.ca/sports/mens-basketball/schedule/2026-27?grid=true)   |
| Women's basketball | 13                              | 22                            | [Brock schedule](https://gobadgers.ca/sports/womens-basketball/schedule/2026-27?grid=true) |
| Men's volleyball   | 17                              | 20                            | [Brock schedule](https://gobadgers.ca/sports/mens-volleyball/schedule/2026-27?grid=true)   |
| Women's volleyball | 19                              | 20                            | [Brock schedule](https://gobadgers.ca/sports/womens-volleyball/schedule/2026-27?grid=true) |

The full snapshot includes exhibition and postseason listings, including unavailable times. Only unique regular-season matches to supplied CSV date, opponent, program and home/away are proposed by the importer. Games absent from the supplied fantasy calendar are retained in research evidence rather than silently added to scoring periods.

## Schedule reconciliation

`pnpm import:beta-data` now reads all 16 supplied CSVs. The earlier `SCHEDULE_TIME` and 21 `COMBINED_SCHEDULE_TIME` findings are resolved in the local candidate preview. All source cells remain intact; normalized candidates carry the official page URL, page hash, official row number, retrieval time and evidence hash, with `reviewedBy: null`.

- Men's hockey source record 12 uses `Jan8`; this maps to January 8, 2027, 6 p.m. Toronto time, `2027-01-08T23:00:00.000Z`.
- Volleyball source record 2 describes only the men's TMU match on October 30. Record 3 describes women's Ottawa at 1 p.m. and men's TMU at 3:30 p.m. on October 31. Record 4 describes only women's Ottawa on November 1. No phantom second game is created for single-program rows.
- Women's volleyball at Windsor on November 28 is officially listed at **Noon**, `2026-11-28T17:00:00.000Z`; the men's match is 1:30 p.m., `2026-11-28T18:30:00.000Z`.
- Toronto conversion changes from UTC−4 to UTC−5 on November 1, 2026. Invalid dates, missing times, DST gaps and ambiguous repeated times remain unavailable rather than being guessed.

Review every mapping before activation, particularly games near period boundaries. A clean parser report does not approve the calendar or make a schedule current forever.

## Athlete and source-value review

The importer retains every nonempty CSV record, including records after blank separators. Explicit “Players from last year/season” labels become section markers; the athletes below remain preserved as candidates with previous-season membership flagged. Unlabelled sections, including hockey and men's basketball separators, still require roster-owner classification.

Identity suggestions require the same program, verified official season, normalized name, jersey and compatible position. They are suggestions for human review, not permanent athlete identities. In particular, Caleb Hout and Grace Ven Den Hoek need spelling/identity review against the official roster; other unmatched records may be past-season members or role discrepancies. Redshirt `RS` is preserved as a source jersey/eligibility annotation rather than converted to a number or removed.

The updated importer recognizes `25-26 GP`, `25-26 FP`, `26-27 Proj GP`, `26-27 Proj FP`, and basketball/volleyball field variants. It preserves `N/A`, empty, zero, negative and annotated text separately. Previous-team values, preseason values and supplied projections remain separate from current-season scoring. Values such as “Good?” and “23.5 in 1” need the data owner's definition and are not treated as numbers.

The [preview evidence](evidence/2026-10-06-beta-import.json) records file hashes, normalization revision hashes, row counts, unresolved identity suggestions and every proposed game mapping. Database import IDs are null because nothing has been published to Supabase.

A [preliminary pool-capacity report](evidence/2026-10-06-pool-capacity.json) examines the 122 exact identity suggestions. It finds nine basketball front-court candidates for ten required starter slots in a ten-team league. The Grace Ven Den Hoek identity review may resolve that shortfall; it must not be assumed resolved. Four-, six- and eight-team counts meet the necessary per-slot minimums. These are count checks only: they do not approve identities, rankings or a complete draft allocation, and withdrawals can reduce capacity.

## Statistics and scoring definitions

All six Brock 2025–26 cumulative-statistics pages were accessible and saved locally. Their field inventories are in the official-source evidence; use individual tables and game box scores for reviewed scorekeeping. Cumulative totals can include postseason games and cannot reconstruct per-game bonuses or be substituted for the supplied regular-season fantasy totals.

Three additional historical box-score examples were saved with hashes and field inventories for fixture review: [basketball vs Laurier, February 13, 2026](https://gobadgers.ca/sports/mens-basketball/stats/2025-26/laurier/boxscore/6781), [hockey vs Toronto, February 14, 2026](https://gobadgers.ca/sports/mens-ice-hockey/stats/2025-26/toronto/boxscore/6710), and [volleyball vs Western, November 1, 2025](https://gobadgers.ca/sports/mens-volleyball/stats/2025-26/western/boxscore/6889). They are review material, not approved scoring fixtures or current-season imports.

| Sport / role  | Official fields and remaining interpretation                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hockey skater | Goals, assists, PPG, SHG and penalty minutes appear in Brock's tables. The two-point bonus must be evaluated per game, not on a season total.                                                                                                                                                                                               |
| Hockey goalie | Saves, goals allowed, win record and shutouts appear in the tables. Credit a win/shutout to the officially credited goalie, not every goalie on a winning team. Missing official attribution remains unresolved.                                                                                                                            |
| Basketball    | Points, offensive/defensive rebounds, assists, turnovers, steals, blocks and fouls are available. A double-double needs a per-game record; foul-out credit requires game-level evidence and the approved rule definition.                                                                                                                   |
| Volleyball    | `E` is the attack-error field; `SE`, `RE`, `BE` and `BHE` are separate. Official `PTS` is a volleyball statistic, not Brock Fantasy points. The current rule code sums six error categories, including setting errors. Tarik must decide the CSV's intended error scope and treatment of unavailable categories before scoring is approved. |

U SPORTS' [requested landing page](https://en.usports.ca/landing/index) and team-page reads returned access errors (including HTTP 403). No access restriction was bypassed, and no successful U SPORTS data verification is claimed. Brock's accessible official pages supply the current evidence. API access remains unavailable according to the operator's notes.

## Remaining approvals

Tarik must approve source rights, athlete crosswalks/current membership, source-field meanings, rankings and pool sufficiency, scoring interpretations, historical/postseason coverage, and the ten-period calendar. Staging requires deployed schema, AAL2 administrators and retained import/replay evidence. See [the rights register](data-rights-register.md) and [TODO](../TODO.md).
