// - Rehearse the additive migration and affected security and gameplay contracts in isolated databases
process.env.BROCK_TEST_SQL_FILES =
  '080-rpc-security.test.sql,150-game-lineups-schedules.test.sql,190-backlog-forecasts-rankings.test.sql,250-privacy-retention-email.test.sql,290-admin-league-explorer.test.sql,320-athlete-availability.test.sql';
await import('./test-registration-migrations.mjs');
