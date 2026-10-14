# Premium sports UI refresh

The October 14 [beta fixes](BETA_FIXES.md) add league Settings/results, seed-plus-history ADP, updated supplied metrics, and spacing/phone layout corrections. Those changes are locally validated and await hosted publication/deployment.

The fantasy client uses a dark-led Brock design with a complete light theme, locally bundled Inter and Barlow Condensed, a desktop sidebar, and persistent phone navigation. Shared themed style factories also update native screens when the theme changes. The association checkout is outside this change.

The dashboard prioritizes leagues and their next action. Player browsing and the draft room share supplied season metrics. Desktop drafts use three columns at 1280px, two at 1024px, and a tabbed workspace below that. The clock stays visible on web; details open in a drawer or phone sheet. Loading skeletons, reserved portraits with initials, reduced motion, pending actions, and confirmed-pick feedback distinguish each state without changing gameplay rules.

## Player data

- Projected fantasy points and games come from the existing approved `logic` roster imports. Zero, negative, and unavailable values retain their meanings.
- `athlete_season_summaries.supplied_adp` stores the supplied starting ADP, with SQL `NULL` for missing values. The directory, draft and profile use the aggregate of that seed and persisted picks from completed, unvoided beta leagues. Changes to the seed and global aggregate invalidate draft player snapshots.
- Current official roster research found 59 verified heights, 61 unavailable values, and no conflicts with supplied roster heights. The mapping retains official profile IDs, season, retrieval timestamps, URLs, source hashes, and canonical roster mappings. Earlier-season heights are excluded.
- Height publication merges only the height metadata into existing athlete bio records. It preserves IDs, headshots, opt-outs, source mappings, and draft eligibility, updates relevant pool revisions, and records an idempotent audit event.

## Local validation and preview

```powershell
pnpm check
pnpm test:ui
pnpm test:player-metrics:local
pnpm import:heights
```

`test:ui` launches a disposable local preview of the exported application. Manager APIs use controlled fixtures built from the real approved rosters; no hosted account or draft is changed. It checks both themes at 320, 390, 768, 1024, and 1440px, loading/empty/error views on phone and desktop, queue saves, player details, acknowledged picks, expired turns, reconnection, and accessibility. It also checks the real server-rendered entry forms.

Screenshots and the browser/performance report are written to `dev/tmp/ui-refresh/`. The report compares aggregate exported JavaScript against the 2,240,100-byte pre-change baseline; it is not a measurement of hosted Core Web Vitals.

The database rehearsal uses newly created local databases and drops them afterward. It validates all migrations and pgTAP suites, applies/retries the height enrichment to fixture athletes, and checks stable IDs, preserved bio/headshots, NULL ADP, and pool revision updates. Cron schedules are recorded by a test stub; background job execution is outside this rehearsal. Readback is saved in `dev/tmp/height-rehearsal/readback.txt`.

`import:heights` prepares `dev/tmp/height-publication/publication.sql` and a preview receipt. Supply the publishing operator UUID through `BROCK_PUBLISH_OPERATOR_PROFILE_ID` when preparing the actual release transaction. The default UUID is for preview only. This command does not apply SQL.

## Release sequence

1. Review the local screenshots, test evidence, current hosted migration state, and existing release/backup gates.
2. Apply the additive player-metrics migration before deploying client queries that request `supplied_adp`.
3. Prepare the height transaction with the actual authorized operator UUID, apply it to the intended environment, and retain its readback. Confirm player counts, preserved IDs/headshots, and the height coverage.
4. Deploy the reviewed client and rehearse authenticated phone/desktop journeys with real accounts. Native exports prove bundling; real-device interaction remains a separate check.

No hosted migration, data publication, commit, or deployment is performed by the local validation commands.

Fonts are distributed under the bundled SIL Open Font License files in `apps/client/assets/fonts/`. Browser WOFF2 files are local copies of Google Fonts' published font subsets; native font assets use the original TTF files.
