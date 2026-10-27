import { execFileSync } from 'node:child_process';
// - Restrict fixtures and migrations to disposable databases created by the existing harness
execFileSync(process.execPath, ['scripts/test-registration-migrations.mjs'], {
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    BROCK_TEST_PARTICIPANT_SCANS: '1',
    BROCK_TEST_SQL_FILES:
      '080-rpc-security.test.sql,160-varsity-participation.test.sql,280-participant-scans.test.sql',
  },
});
