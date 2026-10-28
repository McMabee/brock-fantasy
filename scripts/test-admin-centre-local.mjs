// - Run the new contracts alongside the existing security and affected workflow regressions
process.env.BROCK_TEST_SQL_FILES =
  '080-rpc-security.test.sql,190-backlog-forecasts-rankings.test.sql,250-privacy-retention-email.test.sql,280-participant-scans.test.sql,290-admin-league-explorer.test.sql,300-admin-centre.test.sql';
process.env.BROCK_TEST_ADMIN_CENTRE_CONCURRENCY = '1';
await import('./test-registration-migrations.mjs');
