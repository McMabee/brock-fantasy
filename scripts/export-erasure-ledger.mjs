import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serviceRpc } from '../apps/client/src/server/service-email.ts';
import { validateErasureManifest } from './lib/erasure-replay.mjs';

const output = process.argv[2];
if (
  !output ||
  !path.isAbsolute(output) ||
  path
    .resolve(output)
    .toLowerCase()
    .startsWith(process.cwd().toLowerCase() + path.sep)
)
  throw new Error('Choose an absolute private manifest path outside the repository');
const manifest = validateErasureManifest(await serviceRpc('export_erasure_ledger', {}));
await writeFile(output, JSON.stringify(manifest) + '\n', { mode: 0o600 });
console.log(
  `Captured ${manifest.entries.length} deletion references in the private restore manifest`,
);
