import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { approvalHash, scoringRow, sourceApproval } from './lib/brock-approvals.mjs';
import { publishPreview } from './lib/import-publication.mjs';
import { hashBytes, historicalGoalieDefinition, rosterDefinition } from './lib/brock-decisions.mjs';
import { rosterParticipation, suppliedRanking } from './lib/brock-rosters.mjs';
import {
  normalizedPositions,
  parseCsv,
  parseDateAndTime,
  valueWithMeaning,
} from './lib/brock-data.mjs';

const root = process.cwd();
const logicDir = path.join(root, 'logic');
const outputPath = path.resolve(
  root,
  process.env.BROCK_IMPORT_OUTPUT ?? 'dev/tmp/brock-beta-import-preview.json',
);
const publish = process.argv.includes('--publish');
const normalizerVersion = 'brock-import-2026.5';
const decisionsPath = path.resolve(
  root,
  process.env.BROCK_DATA_DECISIONS ?? 'dev/docs/evidence/2026-10-08-beta-decisions.json',
);
let decisions = null;
let decisionsHash = null;
let goalieEvidence = null;
const approvalsPath = path.resolve(
  root,
  process.env.BROCK_DATA_APPROVALS ?? 'dev/docs/evidence/2026-10-08-data-approvals.json',
);
let approvals = null;
let approvalsHash = null;
const evidencePath = path.resolve(
  root,
  process.env.BROCK_OFFICIAL_EVIDENCE ?? 'dev/docs/evidence/2026-10-06-official-data.json',
);
let officialEvidence = null;
let officialEvidenceHash = null;
const suppressionsPath = path.resolve(
  root,
  process.env.BROCK_ROSTER_SUPPRESSIONS ?? 'dev/docs/evidence/2026-10-08-roster-suppressions.json',
);
let suppressions = null;
let suppressionsHash = null;

const seasonId = 'b0000000-0000-4000-8000-000000000002';

const fileKinds = new Map([
  ["Fall.Winter Brock Fantasy Information - Women's Volleyball - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Men's Volleyball - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Women's Basketball - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Men's Basketball - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Roster.csv", 'roster'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Roster.csv", 'roster'],
  ['Fall.Winter Brock Fantasy Information - Goalie stats.csv', 'historical_goalie_stats'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Schedule.csv", 'schedule'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Schedule.csv", 'schedule'],
  ['Fall.Winter Brock Fantasy Information - Basketball - Schedule .csv', 'combined_schedule'],
  ['Fall.Winter Brock Fantasy Information - Volleyball - Schedule.csv', 'combined_schedule'],
  ['Fall.Winter Brock Fantasy Information - League Schedule.csv', 'fantasy_calendar'],
  ['Fall.Winter Brock Fantasy Information - Playoffs.csv', 'playoffs'],
  ['Fall.Winter Brock Fantasy Information - Roster Breakdown.csv', 'roster_rules'],
  ['Fall.Winter Brock Fantasy Information - Scoring System.csv', 'scoring_rules'],
  ['Fall.Winter Brock Fantasy Information - Draft_Waivers_Trade.csv', 'transaction_rules'],
]);

const programForFile = new Map([
  ["Fall.Winter Brock Fantasy Information - Women's Volleyball - Roster.csv", 'womens_volleyball'],
  ["Fall.Winter Brock Fantasy Information - Men's Volleyball - Roster.csv", 'mens_volleyball'],
  ["Fall.Winter Brock Fantasy Information - Women's Basketball - Roster.csv", 'womens_basketball'],
  ["Fall.Winter Brock Fantasy Information - Men's Basketball - Roster.csv", 'mens_basketball'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Roster.csv", 'mens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Roster.csv", 'womens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Men's Hockey - Schedule.csv", 'mens_hockey'],
  ["Fall.Winter Brock Fantasy Information - Women's Hockey - Schedule.csv", 'womens_hockey'],
]);

function inferSport(program) {
  if (program.includes('hockey')) return 'hockey';
  if (program.includes('basketball')) return 'basketball';
  return 'volleyball';
}

function canonicalRow(file, kind, row, issues) {
  const raw = row.raw;
  const program = programForFile.get(file);
  if (kind === 'roster' && program) {
    const sport = inferSport(program);
    const sourceName = (raw['Full name'] ?? raw.Name ?? '').trim();
    const participation = rosterParticipation(program, sourceName, suppressions);
    const name = participation.name;
    if (/^players from last (?:year|season)$/iu.test(name))
      return { type: 'roster_section_marker', label: name };
    const field = (...keys) =>
      valueWithMeaning(keys.map((key) => raw[key]).find((value) => value !== undefined) ?? '');
    const positions = normalizedPositions(sport, raw.Position ?? '');
    if (!name || positions.length === 0)
      issues.push({
        severity: 'error',
        code: 'ROSTER_IDENTITY_OR_POSITION',
        row: row.rowNumber,
        detail: 'A roster row needs a name and normalized position.',
      });
    return {
      type: 'athlete_season_candidate',
      program,
      sport,
      name,
      ...participation,
      positions,
      sourcePosition: raw.Position ?? '',
      jerseyNumber: raw['#']?.trim() || null,
      membershipStatus: 'review_required',
      identityStatus: 'review_required',
      historicalFantasyPoints: field('25-26 FP', '25-26 Fantasy points'),
      previousTeamPoints: field('Points from previous team', '25-26 points', '25/26 stats'),
      gamesPlayed: field('25-26 GP', 'Games Played last year'),
      suppliedSeasonProjection: field('26-27 Proj FP', '26-27 Proj'),
      suppliedProjectedGames: field('26-27 Proj GP'),
      preseasonValue: field('Preseason (3 G)', 'Preseason PPG'),
      previousTeamGames: field('games played', 'Games played'),
      sourceTeam: raw.Team?.trim() || program,
      bio: {
        eligibility: raw.Elig ?? '',
        major: raw.Major ?? raw.Program ?? '',
        hometown: raw.Hometown ?? '',
      },
    };
  }
  if (kind === 'schedule') return normalizeScheduleRow(program, raw, row.rowNumber, issues);
  if (kind === 'combined_schedule')
    return normalizeCombinedSchedule(file, raw, row.rowNumber, issues);
  if (kind === 'scoring_rules') return scoringRow(raw, row.rowNumber, issues);
  return {
    type: kind,
    cells: Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, valueWithMeaning(value)]),
    ),
  };
}

function normalizeScheduleRow(program, raw, rowNumber, issues) {
  const official = reconcileSchedule([program], raw, rowNumber, issues);
  if (official) return official;
  const startsAt = parseDateAndTime(raw.Date ?? '', raw.Time ?? '');
  if (!startsAt)
    issues.push({
      severity: 'error',
      code: 'SCHEDULE_TIME',
      row: rowNumber,
      detail: 'A yearless schedule row could not be converted to an America/Toronto timestamp.',
    });
  return {
    type: 'game_candidate',
    program,
    opponent: raw.Opponent?.trim() ?? '',
    location: raw.Location?.trim() ?? '',
    startsAt,
    status: startsAt ? 'mapped' : 'mapping_required',
  };
}

function normalizeCombinedSchedule(file, raw, rowNumber, issues) {
  const sport = file.includes('Basketball') ? 'basketball' : 'volleyball';
  const division = /\(([WM])\)/iu.exec(raw.Opponent ?? '')?.[1].toUpperCase();
  const requestedPrograms = division
    ? [`${division === 'W' ? 'womens' : 'mens'}_${sport}`]
    : [`mens_${sport}`, `womens_${sport}`];
  const official = reconcileSchedule(requestedPrograms, raw, rowNumber, issues);
  if (official) return official;
  const time = raw.Time?.trim() ?? '';
  const pieces = [...time.matchAll(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*([WM])/giu)];
  const programs = pieces.length
    ? pieces.map((piece) => ({
        program: `${piece[2].toLowerCase() === 'w' ? 'womens' : 'mens'}_${sport}`,
        time: piece[1],
      }))
    : [];
  if (programs.length !== 2) {
    issues.push({
      severity: 'warning',
      code: 'COMBINED_SCHEDULE_TIME',
      row: rowNumber,
      detail: 'Men and women game times need official-schedule reconciliation before activation.',
    });
    return [
      {
        type: 'game_candidate',
        program: `mens_${sport}`,
        opponent: raw.Opponent?.trim() ?? '',
        location: raw.Location?.trim() ?? '',
        startsAt: null,
        status: 'mapping_required',
      },
      {
        type: 'game_candidate',
        program: `womens_${sport}`,
        opponent: raw.Opponent?.trim() ?? '',
        location: raw.Location?.trim() ?? '',
        startsAt: null,
        status: 'mapping_required',
      },
    ];
  }
  return programs.map(({ program, time: listedTime }) => ({
    type: 'game_candidate',
    program,
    opponent: raw.Opponent?.trim() ?? '',
    location: raw.Location?.trim() ?? '',
    startsAt: parseDateAndTime(raw.Date ?? '', listedTime),
    status: 'mapped',
  }));
}

function opponentKey(value) {
  return value
    .toLowerCase()
    .replace(/\([wm]\)/giu, '')
    .replace(/[’']/gu, '')
    .trim();
}

function reconcileSchedule(programs, raw, rowNumber, issues) {
  if (!officialEvidence) return null;
  const localDate = parseDateAndTime(raw.Date ?? '', '12 pm')?.slice(0, 10);
  const opponents = (raw.Opponent ?? '').split(/\s+(?:and|&)\s+/iu).map(opponentKey);
  const at = /^H\b/u.test(raw.Location ?? '')
    ? 'Home'
    : /^A\b/u.test(raw.Location ?? '')
      ? 'Away'
      : null;
  const resolved = [];
  for (const program of programs) {
    const matches = officialEvidence.games.filter(
      (game) =>
        game.program === program &&
        game.conferenceGame &&
        game.startsAt &&
        parseDateAndTime(game.date, '12 pm')?.slice(0, 10) === localDate &&
        opponents.includes(opponentKey(game.opponent)) &&
        (!at || game.at === at),
    );
    if (matches.length !== 1) {
      issues.push({
        severity: 'error',
        code: 'OFFICIAL_SCHEDULE_MAPPING',
        row: rowNumber,
        detail: `${program}: expected one official date/opponent/venue match, found ${matches.length}.`,
      });
      return programs.map((candidateProgram) => ({
        type: 'game_candidate',
        program: candidateProgram,
        opponent: raw.Opponent ?? '',
        location: raw.Location ?? '',
        startsAt: null,
        status: 'mapping_required',
      }));
    }
    const game = matches[0];
    const suppliedTime =
      programs.length === 1 ? parseDateAndTime(raw.Date ?? '', raw.Time ?? '') : null;
    resolved.push({
      type: 'game_candidate',
      program,
      opponent: game.opponent,
      location: game.location,
      startsAt: game.startsAt,
      localDate: game.date,
      localTime: game.time,
      status: 'official_candidate',
      reviewRequired: true,
      suppliedTimestamp: suppliedTime,
      correctionProposed: suppliedTime !== null && suppliedTime !== game.startsAt,
      mappingEvidence: {
        sourceUrl: game.sourceUrl,
        sourceHash: game.sourceHash,
        sourceRowNumber: game.sourceRowNumber,
        retrievedAt: game.retrievedAt,
        evidenceHash: officialEvidenceHash,
        reviewedBy: null,
      },
    });
  }
  return resolved;
}

export async function buildManifest() {
  suppressions = null;
  suppressionsHash = null;
  try {
    const content = await readFile(suppressionsPath, 'utf8');
    suppressions = JSON.parse(content);
    if (!suppressions.revision || !Array.isArray(suppressions.athletes))
      throw new Error('Roster suppressions need a revision and athlete list.');
    suppressionsHash = hashBytes(content);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  decisions = null;
  decisionsHash = null;
  goalieEvidence = null;
  try {
    const content = await readFile(decisionsPath, 'utf8');
    decisions = JSON.parse(content);
    if (!decisions.decisionId || !decisions.confirmedBy || !Array.isArray(decisions.rosterSources))
      throw new Error('Definitions need an operator identity, revision and source bindings.');
    decisionsHash = hashBytes(content);
    // Preserve approved record bytes/hashes while resolving their original local path.
    const recordedPath = decisions.goalieLog.evidencePath;
    const localEvidencePath = recordedPath.startsWith('docs/')
      ? `dev/${recordedPath}`
      : recordedPath;
    const evidenceContent = await readFile(path.resolve(root, localEvidencePath));
    if (hashBytes(evidenceContent) !== decisions.goalieLog.evidenceHash)
      throw new Error('Goalie evidence hash changed; record a reviewed definition revision.');
    goalieEvidence = JSON.parse(evidenceContent.toString());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (decisions) throw new Error('The reviewed goalie evidence file is required.');
  }
  try {
    const content = await readFile(approvalsPath, 'utf8');
    approvals = JSON.parse(content);
    if (!Array.isArray(approvals.sources) || !approvals.approvalId)
      throw new Error('Data approval record must contain an approval ID and source hashes.');
    approvalsHash = approvalHash(content);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    approvals = null;
    approvalsHash = null;
  }
  try {
    const evidenceContent = await readFile(evidencePath, 'utf8');
    officialEvidence = JSON.parse(evidenceContent);
    if (
      officialEvidence.season !== '2026-27' ||
      officialEvidence.timezone !== 'America/Toronto' ||
      !Array.isArray(officialEvidence.games) ||
      !Array.isArray(officialEvidence.rosters)
    )
      throw new Error('Official evidence must contain 2026–27 Toronto schedules and rosters.');
    officialEvidenceHash = createHash('sha256').update(evidenceContent).digest('hex');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    officialEvidence = null;
    officialEvidenceHash = null;
  }
  const imports = [];
  const allIssues = [];
  for (const [file, kind] of fileKinds) {
    const content = await readFile(path.join(logicDir, file), 'utf8');
    const hash = createHash('sha256').update(content).digest('hex');
    const approval = sourceApproval(approvals, `logic/${file}`, hash, officialEvidenceHash, kind);
    const issues = [];
    const rows = [];
    let section = approval ? 'current_season' : 'membership_review_required';
    let previousRecordNumber = 1;
    for (const row of parseCsv(content)) {
      if (
        kind === 'roster' &&
        section !== 'previous_season' &&
        row.rowNumber > previousRecordNumber + 1
      )
        section = 'unlabelled_after_separator';
      previousRecordNumber = row.rowNumber;
      const normalized =
        kind === 'historical_goalie_stats'
          ? (historicalGoalieDefinition(decisions, hash, goalieEvidence, row, issues) ??
            canonicalRow(file, kind, row, issues))
          : canonicalRow(file, kind, row, issues);
      if (normalized.type === 'roster_section_marker') section = 'previous_season';
      for (const [candidateIndex, item] of (Array.isArray(normalized)
        ? normalized
        : [normalized]
      ).entries()) {
        if (item.type === 'athlete_season_candidate') {
          const definition = rosterDefinition(
            decisions,
            `logic/${file}`,
            hash,
            row.rowNumber,
            item.name,
          );
          if (approval && definition?.membership) section = definition.membership;
          item.sourceSection = section;
          item.draftEligible = false;
          if (approval) {
            item.identityStatus = 'source_owner_confirmed';
            item.positionStatus = 'source_owner_confirmed';
            item.membershipStatus =
              section === 'current_season'
                ? 'source_owner_confirmed'
                : section === 'previous_season'
                  ? 'previous_season'
                  : 'section_classification_required';
            item.reviewedBy = approval.approvedBy;
            item.approvalId = approval.approvalId;
          }
          if (definition) {
            item.definitionRevision = definition.decisionId;
            item.historicalAvailabilityReason = definition.historicalReason;
            item.rankingInput = suppliedRanking(item, definition.rankingInput);
            item.calculationExclusions = {
              staffAnnotations: definition.ignoreStaffAnnotations,
              previousTeamValues: definition.ignorePreviousTeamValues,
            };
          }
          if (item.excludedFromFantasy) {
            item.rankingInput = suppliedRanking(item, definition?.rankingInput);
          }
          const nameKey = (name) => name.toLowerCase().replace(/[^a-z]/gu, '');
          // Suggestions only; no permanent identity is assigned by this match.
          item.identityCandidates = (
            item.excludedFromFantasy ? [] : (officialEvidence?.rosters ?? [])
          )
            .filter(
              (athlete) =>
                athlete.program === item.program &&
                athlete.sourceSeasonVerified &&
                nameKey(athlete.name) === nameKey(item.name) &&
                athlete.jerseyNumber === item.jerseyNumber &&
                normalizedPositions(item.sport, athlete.position).some((position) =>
                  item.positions.includes(position),
                ),
            )
            .map((athlete) => ({
              sourcePlayerId: athlete.sourcePlayerId,
              bioUrl: athlete.bioUrl,
              sourceUrl: athlete.sourceUrl,
              sourceHash: athlete.sourceHash,
              reviewedBy: null,
            }));
        }
        if (item.type === 'game_candidate' && approval && item.mappingEvidence) {
          item.status = 'approved_mapping';
          item.reviewRequired = false;
          item.mappingEvidence.reviewedBy = approval.approvedBy;
          item.mappingEvidence.confirmedOn = approval.confirmedOn;
          item.mappingEvidence.approvalId = approval.approvalId;
        }
        rows.push({
          ...row,
          sourceRowNumber: row.rowNumber,
          rowNumber: row.rowNumber * 10 + candidateIndex,
          normalized: { ...item, sourceRowNumber: row.rowNumber },
        });
      }
    }
    imports.push({
      source: `logic/${file}`,
      sourceHash: hash,
      revisionHash: createHash('sha256')
        .update(
          JSON.stringify({
            sourceHash: hash,
            normalizerVersion,
            officialEvidenceHash,
            approvalsHash,
            decisionsHash,
            suppressionsHash,
          }),
        )
        .digest('hex'),
      kind,
      rowCount: rows.length,
      status: 'preview',
      approval,
      issues,
      rows,
    });
    allIssues.push(...issues.map((issue) => ({ file, ...issue })));
  }
  return {
    generatedAt: new Date().toISOString(),
    seasonId,
    season: '2026-27',
    normalizerVersion,
    rosterSuppressions: suppressionsHash
      ? {
          path: path.relative(root, suppressionsPath).replaceAll('\\', '/'),
          sourceHash: suppressionsHash,
          revision: suppressions.revision,
        }
      : null,
    dataDefinitions: decisionsHash
      ? {
          path: path.relative(root, decisionsPath).replaceAll('\\', '/'),
          sourceHash: decisionsHash,
          decisionId: decisions.decisionId,
          confirmedBy: decisions.confirmedBy,
        }
      : null,
    dataApprovals: approvalsHash
      ? {
          path: path.relative(root, approvalsPath).replaceAll('\\', '/'),
          sourceHash: approvalsHash,
          approvalId: approvals.approvalId,
          approvedBy: approvals.approvedBy,
          confirmedOn: approvals.confirmedOn,
        }
      : null,
    officialEvidence: officialEvidenceHash
      ? {
          path: path.relative(root, evidencePath).replaceAll('\\', '/'),
          sourceHash: officialEvidenceHash,
          reviewedBy:
            approvals?.officialEvidenceHash === officialEvidenceHash ? approvals.approvedBy : null,
        }
      : null,
    timezone: 'America/Toronto',
    imports,
    issues: allIssues,
    activation: {
      allowed: false,
      reasons: [
        ...(!imports.every((item) => item.approval)
          ? ['Missing or changed source hashes require an updated source-owner approval record.']
          : []),
        'Approved source records still require permanent database identities and materialization.',
        ...(!decisionsHash
          ? ['Source-value definitions have not been supplied for this revision.']
          : []),
        'No frozen ranking revision or complete draft-allocation rehearsal is present.',
      ],
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifest = await buildManifest();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  let publication = null;
  if (publish) {
    let release = { commit: null, workingTreeDirty: null };
    try {
      release = {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        workingTreeDirty: Boolean(
          execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
        ),
      };
    } catch {
      /* Non-Git environments retain an explicitly unknown release identity. */
    }
    publication = await publishPreview(manifest, {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      projectRef: process.env.BROCK_PUBLISH_PROJECT_REF,
      operatorName: process.env.BROCK_PUBLISH_OPERATOR_NAME,
      operatorProfileId: process.env.BROCK_PUBLISH_OPERATOR_PROFILE_ID,
      receiptPath:
        process.env.BROCK_IMPORT_RECEIPT ??
        path.join(
          'logic',
          'import-receipts',
          `${new Date().toISOString().replaceAll(':', '-')}.json`,
        ),
      release,
    });
  }
  console.log(
    JSON.stringify({
      output: outputPath,
      imports: manifest.imports.length,
      rows: manifest.imports.reduce((total, item) => total + item.rowCount, 0),
      issues: manifest.issues.length,
      published: publish,
      publication: publication
        ? {
            runId: publication.runId,
            status: publication.status,
            verifiedRows: publication.verifiedRows,
            activation: false,
          }
        : null,
    }),
  );
}
