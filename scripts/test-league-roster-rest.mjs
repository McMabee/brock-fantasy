import { spawn } from 'node:child_process';

// - Restrict REST fixtures to disposable databases created by the migration runner
const child = spawn(process.execPath, ['scripts/test-registration-migrations.mjs'], {
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, BROCK_TEST_REST: '1' },
});
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
