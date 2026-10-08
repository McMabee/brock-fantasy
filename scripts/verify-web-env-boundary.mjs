import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const names = ['SUPABASE_SECRET_KEY', 'AUTH_RATE_LIMIT_HMAC_SECRET'];
const privateValues = names.map((name) => process.env[name]).filter((value) => value?.length >= 16);
async function inspect(directory, browser) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) count += await inspect(file, browser);
    else if (/\.(?:js|json|html|map)$/u.test(entry.name)) {
      const source = await readFile(file, 'utf8');
      if (privateValues.some((value) => source.includes(value))) {
        throw new Error(`A server credential value was embedded in ${file}.`);
      }
      if (browser && names.some((name) => source.includes(name))) {
        throw new Error(`A server-only environment reference reached browser output: ${file}.`);
      }
      count++;
    }
  }
  return count;
}
const browserFiles = await inspect('apps/client/dist/client', true);
const serverFiles = await inspect('apps/client/dist/server', false);
console.log(
  JSON.stringify({
    browserFiles,
    serverFiles,
    serverReferencesAbsentFromBrowser: true,
    suppliedServerValuesNotEmbedded: true,
  }),
);
