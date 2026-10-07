import { appendFile } from 'node:fs/promises';
import { runHostedBackup } from './lib/hosted-backup.mjs';

try {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REPOSITORY !== 'McMabee/brock-fantasy' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !process.env.RUNNER_TEMP
  )
    throw new Error('This entry point requires the approved repository main-branch GitHub runner.');
  const receipt = await runHostedBackup({ temporaryRoot: process.env.RUNNER_TEMP });
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Verified encrypted Brock snapshot \`${receipt.snapshotId}\` at ${receipt.completedAt}.\n\nAll three database exports and manifest restored from Google Drive without cache; hashes matched and temporary private files were removed. This does not verify database/application recovery or storage objects.\n`,
    );
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'Hosted backup failed.') + '\n');
  process.exitCode = 1;
}
