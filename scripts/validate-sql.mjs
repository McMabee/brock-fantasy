import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'pgsql-parser';

const sqlDirectories = ['supabase/migrations', 'supabase/tests'];
const files = [];

for (const directory of sqlDirectories) {
  for (const name of await readdir(directory)) {
    if (name.endsWith('.sql')) files.push(path.join(directory, name));
  }
}
files.push('supabase/seed.sql');

let failed = false;
for (const file of files.sort()) {
  try {
    await parse(await readFile(file, 'utf8'));
    process.stdout.write(`SQL syntax OK: ${file}\n`);
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`SQL syntax failed: ${file}\n${message}\n`);
  }
}

if (failed) process.exitCode = 1;
