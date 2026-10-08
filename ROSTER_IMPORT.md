# Player directory and roster publication

Sign in and open `https://beta.brockfantasy.ca/players`. The directory displays
the approved current roster independently of draft rankings. Search by name,
position, program or jersey number, filter any of the six programs, or sort by
the supplied 2026-27 projected fantasy points. Player profiles include supplied
season projections and 2025-26 history. Missing values remain unavailable;
recorded zero and negative values are preserved.

The current `logic/` rosters contain 122 players. The two recorded opt-outs are
excluded from canonical player creation and directory publication, including
when a later CSV omits their `**` marker. Included counts are:

| Program            | Players |
| ------------------ | ------: |
| Men's Hockey       |      31 |
| Women's Hockey     |      27 |
| Men's Basketball   |      17 |
| Women's Basketball |      13 |
| Men's Volleyball   |      14 |
| Women's Volleyball |      18 |
| Total              |     120 |

## Publish a reviewed roster

Keep the six supplied CSVs, their source approvals, data definitions and retained
suppression register available at the paths used by `import:beta-data`. These
protected source files are deliberately excluded from Git and Vercel uploads.
The exact approved source revisions must already exist in hosted `source_imports`
and `source_rows`. The roster-directory migration must also be applied.

Set `BROCK_PUBLISH_PROJECT_REF` to the intended linked Supabase project and
`BROCK_PUBLISH_OPERATOR_PROFILE_ID` to the publishing administrator's profile
UUID. The Supabase CLI handles its credentials; keep them outside command text,
source files and public environment variables.

1. Run `pnpm import:rosters` to generate a protected plan, SQL and receipt under
   `logic/import-receipts/`. Review the included/excluded counts and source hashes.
2. Run `pnpm import:rosters -- --apply` after reviewing the release. The command
   validates the explicit project, active admin record, approvals, stored source
   bytes and normalized rows before writing. All database writes are atomic.
3. Retain the receipt and verify the hosted directory as an ordinary signed-in
   member. Anonymous visitors do not receive the unpublished competition roster.

Publication creates source-qualified athlete UUIDs, program/team records,
visible season memberships and supplied history/projection summaries. It links
each included source row to its athlete and records an audit event. It does not
match athletes by name or jersey, create provider identity mappings, activate
competitions/pools, freeze draft ranks, or enable draft eligibility.

A retry of the same revision retains IDs, summaries and the original audit
event. A changed revision with existing season identities requires a reviewed
crosswalk. Publication refuses to overwrite an altered record or restore a
withdrawn membership automatically. Raw opt-out evidence stays restricted.

## Validation

`pnpm check` covers the application and source-plan regression tests.
`pnpm exec supabase test db` includes roster access and denied-write checks.
With the local Supabase stack running, `pnpm test:rosters:local` rehearses the
actual 120-player release twice in one rollback-only transaction. It verifies
opt-out exclusions, 240 supplied summaries, retry behavior, signed-in access and
anonymous denial. It never reads hosted credentials or resets a database.

The same directory runs at `play.brockfantasy.ca/players` when the app origin,
domain and auth redirect configuration move as described in [the admin guide](ADMIN_PANEL.md).
