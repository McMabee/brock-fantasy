// - Reuse the isolated database harness so local application records remain untouched
process.env.BROCK_TEST_SQL_FILES = '080-rpc-security.test.sql,290-admin-league-explorer.test.sql';
await import('./test-registration-migrations.mjs');
