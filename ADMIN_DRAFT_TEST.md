# Administrator live draft test

October 13, 2026: the hosted Brock six-program player pool is active for the
administrator draft test. It contains the 120 published participating players;
both recorded opt-outs remain excluded. Ranking version 1 uses the supplied
2026–27 season fantasy points in descending order, with a retained random seed
for reproducible ties. Scoring is paused for this test.

1. Sign in at [the beta](https://beta.brockfantasy.ca/auth).
2. Open [Create league](https://beta.brockfantasy.ca/leagues/new), enter a test
   name, and choose **4 teams**.
3. Share the displayed invite code with the other three administrators. They
   join at [Join league](https://beta.brockfantasy.ca/leagues/join). All four
   manager seats must be filled before the commissioner can start.
4. Start the draft from the league page. The server randomizes the snake order
   once; each team drafts ten players with 120 seconds per pick. The hosted
   timeout worker checks every 15 seconds, so an expired pick advances on the
   next worker tick.

Hosted readback currently shows three active administrators: Ty, Ethan and
Tarik. A fourth administrator must finish onboarding before this four-manager
test can start. Ty can send an invitation through
[Administrator invitations](https://beta.brockfantasy.ca/admin/accounts).

The registration/draft cutoff is October 24, 2026 at midnight in Toronto.
Application access remains administrator-only. Pool activation does not open
public gameplay or resume scoring.

## Verification and recovery

A rollback-only hosted database rehearsal completed a four-manager, 40-pick
draft and filled every roster with six starters and four bench players. It
verified a timeout autopick, retry idempotency, wrong-manager and stale-version
denial, the 120-player ranking snapshot, and admin/non-admin/anonymous access.
All rehearsal accounts, sessions, leagues and picks were rolled back. Five
allocation regression checks and SQL syntax validation also passed. Cron run
history confirms successful timer execution. The actual multi-browser admin
draft remains the next test.

The rehearsal exposed an allocation defect: a legal proposed pick could be
omitted while the matcher filled slots with unowned alternatives. The applied
fix first matches every existing/proposed owned athlete, then fills remaining
slots. Both database changes are retained in `supabase/migrations/`.

Protected activation artifacts are under
`logic/import-receipts/admin-draft-activation-2026-10-13/`: the approved plan,
ranking seed, activation/rehearsal SQL, verification receipt and guarded
`rollback.sql`. The rollback refuses to alter a pool once a league uses it or
its version changes; review any live test league before recovery. To pause
the timer independently, set the `brock-draft-autopick` cron job inactive.
