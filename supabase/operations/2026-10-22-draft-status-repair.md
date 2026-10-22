# Draft pause and resume repair

The production error was PostgREST `PGRST203`: two public `set_draft_status` functions shared argument names but accepted `text` and `draft_status` respectively. Direct SQL calls could select a function, while JSON requests could not.

Migration `20261022141537_resolve_draft_status_rpc.sql` retains the public text signature, its invoker security and application-access check. Its private text adapter calls the existing private enum implementation directly. The competing public enum overload is dropped with `RESTRICT`. No league data or client payload changes are included.

## Changed incident scope

Tarik deleted league `4b667af7-3ace-4f14-b292-9074609d4a06` during implementation. Its replacement draft `838fc102-089e-4c13-9500-e2df3aa2ad4f` is also absent. The cleanup precondition failed before any queue deletion. Queue clearing, restoration and recreation of that league are cancelled.

A new league named BFA Team League has a different ID. It must not be substituted into the cancelled cleanup. At the safety check it was in setup, with two members and no draft. Membership may change as managers rejoin.

## Verification

- `pnpm test:draft-status:api:local -- --prove-upgrade` reproduces `PGRST203`, applies the repair locally, and exercises the exported application command route through real local Auth and PostgREST
- The API test covers commissioner/member/outsider/anonymous access, eligibility denial at both the application and database boundaries, full initial timers, saved remaining time, retry idempotency, archived drafts, ADP and queue isolation, deterministic pause/pick lock ordering and overlapping timeout workers
- The API test creates only generated local fixtures, sends no email, removes its Auth and gameplay fixtures, and refuses a hosted provider URL
- `BROCK_TEST_SQL_FILES` can select the affected suites in `scripts/test-registration-migrations.mjs`; schema, RPC security, draft completion, ADP, league settings and draft resume suites passed 246 assertions in disposable databases
- The focused browser test covers reset lookup, resume failure/retry, pause, reconnects, member controls, archived-link redirects, both themes and 320/390/1440 pixel viewports
- Browser layout checks wait for the responsive React render after resizing; the immediate width assertion was racy
- The broader SQL suite has two pre-existing failures in `150-game-lineups-schedules.test.sql`, assertions 48 and 58 about rescheduled-athlete locks; both were reproduced without this migration and are outside the draft repair

For the selected SQL suites in PowerShell:

```powershell
$env:BROCK_TEST_SQL_FILES = '000-schema.test.sql,080-rpc-security.test.sql,090-draft-completion.test.sql,140-league-settings-adp.test.sql,180-backlog-leagues.test.sql,210-draft-resume.test.sql'
pnpm test:registration:local
Remove-Item Env:BROCK_TEST_SQL_FILES
```

## Production evidence and recovery

Private snapshots and the reviewed compensating-migration body are stored under the Git-ignored `logic/import-receipts/draft-status-repair-2026-10-22/deployment/` directory, restricted to the local operator and SYSTEM. The snapshots capture function definitions, ownership and grants, plus league, membership, team, draft, pick, queue, roster, roster-history and matchup rows. Keep these files private because they contain account identifiers and league invite codes.

Before pushing, verify the linked project is `fdovowiihxowzatewxgv` and the dry run lists only this migration. Push with vault updates disabled. Afterward, verify one public text signature, unchanged grants and public eligibility checks, schema-cache refresh, and unchanged captured gameplay rows. A credential-free HTTP probe must receive the expected authorization denial rather than `PGRST203`; it must not resume any live draft.

Production rollout completed on October 22, 2026. Only the endpoint migration was applied, with vault updates disabled. Readback confirmed one public text signature, unchanged grants and retained function definitions other than the private adapter, and the existing public application-access check. All captured gameplay rows across nine leagues and one completed draft were identical before and after. The live HTTP probe returned `401` / `42501`, confirming authorization denial without overload ambiguity. The new BFA league was untouched. No live draft was resumed and no queues were cleared.

Migration failures roll back transactionally. After a successful migration, prefer a new forward repair if validation discovers a problem. The captured compensating SQL restores the old two-overload baseline, including its known resume failure; it is an emergency recovery artifact, not an availability fix. Use it only as a newly reviewed migration, keep migration history consistent, and avoid reverting while a draft is active. No queue restoration applies after the original league was deleted.

## Remaining acceptance and risks

The user will perform signed-in commissioner acceptance in a separate, fully joined test league: start it, pause before the deadline, verify other members see the pause, resume with the saved time and pause again. This is separate from automated local evidence. Tarik controls when his new league starts drafting.

The shared endpoint affects all leagues, so compatibility and authorization are the main risks. The JSON contract and retained function grants are unchanged, the catalog reported no dependencies on the retired wrapper, and the sole internal caller is updated by this migration. Once a real draft starts, preserve new picks and use forward fixes. No additional services, subscriptions or frontend redeployment are required.
