import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceGoogleBackupRemote } from './google-backup-config.mjs';

const section = '[brock-backups]\ntype = drive\ntoken = new-private-fixture\n';

test('production reauthorization replaces only the selected remote in any section position', () => {
  const personal = '[personal]\ntype = drive\ntoken = unrelated-fixture\n';
  const other = '[other]\ntype = local\n';
  const old = '[brock-backups]\ntype = drive\ntoken = old-fixture\n';
  for (const existing of [old, old + personal, personal + old + other, personal + old]) {
    const result = replaceGoogleBackupRemote(existing, section, true);
    assert.ok(result.includes(section.trim()));
    assert.ok(!result.includes('old-fixture'));
    if (existing.includes(personal)) assert.ok(result.includes(personal.trim()));
    if (existing.includes(other)) assert.ok(result.includes(other.trim()));
    assert.equal(result.match(/\[brock-backups\]/gu).length, 1);
  }
});

test('existing authentication is protected unless deliberate reauthorization is requested', () => {
  assert.throws(() => replaceGoogleBackupRemote(section, section), /already exists/u);
  assert.throws(
    () => replaceGoogleBackupRemote(section + section, section, true),
    /duplicate sections/u,
  );
});

test('first setup preserves any unrelated configuration while adding the backup remote', () => {
  const existing = '# Private config\n[unrelated]\ntype=local\n';
  assert.ok(replaceGoogleBackupRemote(existing, section).startsWith(existing.trimEnd()));
  assert.equal(replaceGoogleBackupRemote('', section).trim(), section.trim());
});
