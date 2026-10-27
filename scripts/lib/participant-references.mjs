import { createHash } from 'node:crypto';
import { parseCsv } from './brock-data.mjs';

export const referencePrograms = {
  mens_basketball: ['Mens BB', "Men's Basketball"],
  womens_basketball: ['Womens BB', "Women's Basketball"],
  mens_hockey: ['Mens Hockey', "Men's Hockey"],
  womens_hockey: ['Womens Hockey', "Women's Hockey"],
  mens_volleyball: ['Mens VB', "Men's Volleyball"],
  womens_volleyball: ['Womens VB', "Women's Volleyball"],
};
export const referenceFiles = Object.entries(referencePrograms).flatMap(([program, names]) => [
  {
    program,
    role: 'athlete',
    file: `Fall.Winter Brock Fantasy Information - ${names[1]} - Roster.csv`,
  },
  { program, role: 'coach', file: `Untitled spreadsheet - ${names[0]}.csv` },
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const normalize = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replaceAll('*', '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
const stableId = (key) => {
  const h = hash(`participant-reference-v1:${key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export function participantReferencePlan(inputs, { seasonId, mappings = [], suppressions = [] }) {
  if (!uuid.test(seasonId ?? '')) throw new Error('An explicit season UUID is required');
  if (inputs.length !== 12 || new Set(inputs.map((x) => x.file)).size !== 12)
    throw new Error('All twelve reference files are required');
  const excluded = new Set(suppressions.map((x) => `${x.program}:${normalize(x.name)}`));
  const rows = [];
  let excludedRows = 0;
  const sources = [];
  const seen = new Set();
  for (const definition of referenceFiles) {
    const input = inputs.find((x) => x.file === definition.file);
    if (!input) throw new Error(`Missing reference source: ${definition.file}`);
    const headers = input.content
      .replace(/^\uFEFF/u, '')
      .split(/\r?\n/u)[0]
      .split(',')
      .map((x) => x.trim());
    if (
      !(headers.includes('Name') || headers.includes('Full name')) ||
      (definition.role === 'coach' && !['Email', 'Title'].every((x) => headers.includes(x)))
    )
      throw new Error(`Invalid source headers: ${definition.file}`);
    const sourceHash = hash(input.content);
    sources.push({
      file: definition.file,
      sourceHash,
      program: definition.program,
      role: definition.role,
    });
    let historical = false;
    for (const { rowNumber, raw } of parseCsv(input.content.replace(/^\uFEFF/u, ''))) {
      const rawName = (raw.Name ?? raw['Full name'] ?? '').trim();
      if (/^players from last (year|season)$/iu.test(rawName)) {
        historical = true;
        continue;
      }
      if (historical) continue;
      if (!rawName) throw new Error(`Missing reference name: ${definition.file}:${rowNumber}`);
      const name = rawName.replaceAll('*', '').trim().replace(/\s+/gu, ' ');
      if (
        !name ||
        name.length > 120 ||
        [...name].some((character) => character.codePointAt(0) < 32)
      )
        throw new Error(`Invalid reference name: ${definition.file}:${rowNumber}`);
      if (
        definition.role === 'athlete' &&
        (rawName.includes('**') || excluded.has(`${definition.program}:${normalize(name)}`))
      ) {
        excludedRows++;
        continue;
      }
      const email = (raw.Email ?? '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
        throw new Error(`Invalid reference email: ${definition.file}:${rowNumber}`);
      const key = `${definition.role}:${definition.program}:${normalize(name)}`;
      if (seen.has(key)) throw new Error(`Duplicate source identity requires correction: ${key}`);
      seen.add(key);
      rows.push({
        key,
        name,
        emails: email ? [email] : [],
        role: definition.role,
        program: definition.program,
        source: {
          file: definition.file,
          rowNumber,
          sourceHash,
          title: raw.Title?.trim() ?? null,
          supportingStaff: definition.role === 'coach' && rawName.includes('*'),
        },
      });
    }
  }
  const mapped = new Map();
  const ids = new Set();
  for (const mapping of mappings) {
    if (
      !uuid.test(mapping.id ?? '') ||
      !Array.isArray(mapping.members) ||
      mapping.members.length < 2 ||
      ids.has(mapping.id)
    )
      throw new Error('Invalid reviewed identity mapping');
    ids.add(mapping.id);
    for (const key of mapping.members) {
      if (!seen.has(key) || mapped.has(key))
        throw new Error(`Unknown or repeated identity mapping member: ${key}`);
      mapped.set(key, mapping.id);
    }
  }
  const groups = new Map();
  for (const row of rows) {
    const id = mapped.get(row.key) ?? stableId(row.key);
    const current = groups.get(id) ?? [];
    current.push(row);
    groups.set(id, current);
  }
  const references = [...groups]
    .map(([id, members]) => ({
      id,
      name: members[0].name,
      emails: [...new Set(members.flatMap((x) => x.emails))].sort(),
      role: new Set(members.map((x) => x.role)).size > 1 ? 'athlete_coach' : members[0].role,
      programs: [...new Set(members.map((x) => x.program))].sort(),
      sources: members.map((x) => ({ ...x.source, key: x.key })),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const names = new Map();
  for (const row of rows) {
    const group = names.get(normalize(row.name)) ?? [];
    group.push(row.key);
    names.set(normalize(row.name), group);
  }
  const duplicates = [...names]
    .filter(([, keys]) => keys.length > 1)
    .map(([name, members]) => ({
      name,
      members,
      combined:
        members.every((key) => mapped.has(key)) &&
        new Set(members.map((key) => mapped.get(key))).size === 1,
    }));
  const payload = { seasonId, sources, references };
  const document = JSON.stringify(payload);
  return { payload, document, contentHash: hash(document), duplicates, excluded: excludedRows };
}

export function participantReferenceSql(plan, operator) {
  if (!uuid.test(operator ?? ''))
    throw new Error('An explicit administrator profile UUID is required');
  const literal = (s) => `'${s.replaceAll("'", "''")}'`;
  return `begin;\nset local lock_timeout='2s';\nselect beta_private.publish_participant_references(${literal(plan.document)},'${operator}',${literal(plan.contentHash)});\ncommit;\n`;
}
