import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('preview keeps all sources inactive, maps mixed schedules and versions changed evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'brock-import-test-'));
  try {
    const logic = path.join(directory, 'logic');
    await mkdir(logic);
    const files = new Map();
    for (const division of ["Men's", "Women's"]) {
      for (const sport of ['Hockey', 'Basketball', 'Volleyball']) {
        files.set(
          `${division} ${sport} - Roster.csv`,
          sport === 'Hockey'
            ? '#,Full name,Position,25-26 GP,25-26 FP,26-27 Proj FP\n1,Current,GK,2,-7,0\n,,,,,\n2,Retained,Defence,0,N/A,\n'
            : `#,Name,Position,25-26 GP,25-26 FP\n1,Current,${sport === 'Volleyball' ? 'Libero' : 'Guard'},2,0\n`,
        );
      }
      files.set(
        `${division} Hockey - Schedule.csv`,
        'Opponent,Location,Date,Time\nYork,H - Thorold,Jan8,6 pm\n',
      );
    }
    files.set(
      'Basketball - Schedule .csv',
      'Opponent,Location,Date,Time\nToronto,H - Gym,Oct 31,4PM W 6PM M\n',
    );
    files.set(
      'Volleyball - Schedule.csv',
      'Opponent,Location,Date,Time\nTMU (M),A - Toronto,Oct 30,6:30 PM\nOttawa and TMU,A - Ottawa & Toronto,Oct 31,1PM & 3:30PM\n',
    );
    for (const name of [
      'Goalie stats',
      'League Schedule',
      'Playoffs',
      'Roster Breakdown',
      'Scoring System',
      'Draft_Waivers_Trade',
    ])
      files.set(
        `${name}.csv`,
        name === 'Scoring System'
          ? 'Volleyball(V_b),Hockey Skater(H_s),Basketball(B_b),Hockey Goalie(H_g)\nKills (K) = 2,Goal (G) = 20,Point (P) = 1,Win (W) = 10\n'
          : 'Field,Value\nExample,0\n',
      );
    for (const [name, csv] of files)
      await writeFile(path.join(logic, `Fall.Winter Brock Fantasy Information - ${name}`), csv);
    const game = (program, opponent, date, time, at) => ({
      program,
      opponent,
      date,
      time,
      at,
      conferenceGame: true,
      startsAt: program.includes('hockey')
        ? '2027-01-08T23:00:00.000Z'
        : program === 'mens_basketball'
          ? '2026-10-31T22:00:00.000Z'
          : program === 'womens_basketball'
            ? '2026-10-31T20:00:00.000Z'
            : date.includes('30')
              ? '2026-10-30T22:30:00.000Z'
              : program === 'mens_volleyball'
                ? '2026-10-31T19:30:00.000Z'
                : '2026-10-31T17:00:00.000Z',
      location: 'Official venue',
      sourceUrl: 'https://gobadgers.ca/fixture',
      sourceHash: 'fixture',
      sourceRowNumber: 1,
      retrievedAt: '2026-10-06T00:00:00Z',
    });
    const evidence = {
      season: '2026-27',
      timezone: 'America/Toronto',
      rosters: [],
      games: [
        game('mens_hockey', 'York', 'January 8, 2027', '6 pm', 'Home'),
        game('womens_hockey', 'York', 'January 8, 2027', '6 pm', 'Home'),
        game('mens_basketball', 'Toronto', 'October 31, 2026', '6 pm', 'Home'),
        game('womens_basketball', 'Toronto', 'October 31, 2026', '4 pm', 'Home'),
        game('mens_volleyball', 'TMU', 'October 30, 2026', '6:30 pm', 'Away'),
        game('mens_volleyball', 'TMU', 'October 31, 2026', '3:30 pm', 'Away'),
        game('womens_volleyball', 'Ottawa', 'October 31, 2026', '1 pm', 'Away'),
      ],
    };
    const evidencePath = path.join(directory, 'official.json');
    await writeFile(evidencePath, JSON.stringify(evidence));
    const run = async () => {
      execFileSync(
        process.execPath,
        [path.resolve(import.meta.dirname, '../import-brock-beta-data.mjs')],
        {
          cwd: directory,
          env: {
            ...process.env,
            BROCK_OFFICIAL_EVIDENCE: evidencePath,
            BROCK_IMPORT_OUTPUT: 'preview.json',
            BROCK_DATA_APPROVALS: 'dev/docs/evidence/2026-10-06-data-approvals.json',
            BROCK_DATA_DECISIONS: 'absent-decisions.json',
            BROCK_ROSTER_SUPPRESSIONS: 'suppressions.json',
          },
          stdio: 'pipe',
        },
      );
      return JSON.parse(await readFile(path.join(directory, 'preview.json'), 'utf8'));
    };
    const first = await run();
    assert.equal(first.imports.length, 16);
    assert.equal(first.issues.length, 0);
    assert.equal(first.activation.allowed, false);
    const hockey = first.imports.find((item) => item.source.includes("Men's Hockey - Roster"));
    assert.deepEqual(
      hockey.rows.map((row) => row.sourceRowNumber),
      [2, 4],
    );
    assert.equal(hockey.rows[0].normalized.historicalFantasyPoints.value, -7);
    assert.equal(hockey.rows[0].normalized.suppliedSeasonProjection.value, 0);
    assert.equal(hockey.rows[1].normalized.historicalFantasyPoints.kind, 'not_available');
    assert.ok(hockey.rows.every((row) => !row.normalized.draftEligible));
    const volleyball = first.imports.find((item) => item.source.includes('Volleyball - Schedule'));
    assert.equal(volleyball.rows.length, 3);
    assert.deepEqual(
      volleyball.rows.map((row) => row.normalized.opponent),
      ['TMU', 'TMU', 'Ottawa'],
    );
    assert.ok(volleyball.rows.every((row) => row.normalized.reviewRequired));
    const before = first.imports.find((item) => item.source.includes('Basketball - Schedule'));
    const repeated = await run();
    assert.equal(
      repeated.imports.find((item) => item.source === before.source).revisionHash,
      before.revisionHash,
    );
    evidence.games.find((item) => item.program === 'mens_basketball').startsAt =
      '2026-10-31T23:00:00.000Z';
    evidence.games.find((item) => item.program === 'mens_basketball').time = '7 pm';
    await writeFile(evidencePath, JSON.stringify(evidence));
    const after = (await run()).imports.find((item) => item.source === before.source);
    assert.equal(after.sourceHash, before.sourceHash);
    assert.notEqual(after.revisionHash, before.revisionHash);

    const { createHash } = await import('node:crypto');
    const hash = (content) => createHash('sha256').update(content).digest('hex');
    const approval = {
      approvalId: 'fixture-approval',
      season: '2026-27',
      approvedBy: 'Tarik Merchant',
      confirmedOn: '2026-10-06',
      officialEvidenceHash: hash(await readFile(evidencePath)),
      sources: await Promise.all(
        [...files.keys()].map(async (name) => ({
          source: `logic/Fall.Winter Brock Fantasy Information - ${name}`,
          sourceHash: hash(
            await readFile(path.join(logic, `Fall.Winter Brock Fantasy Information - ${name}`)),
          ),
          scopes: ['beta_data'],
        })),
      ),
    };
    await mkdir(path.join(directory, 'dev/docs/evidence'), { recursive: true });
    await writeFile(
      path.join(directory, 'dev/docs/evidence/2026-10-06-data-approvals.json'),
      JSON.stringify(approval),
    );
    const approved = await run();
    assert.ok(approved.imports.every((item) => item.approval?.approvedBy === 'Tarik Merchant'));
    assert.equal(approved.activation.allowed, false);
    const approvedHockey = approved.imports.find((item) => item.source === hockey.source);
    assert.equal(approvedHockey.rows[0].normalized.membershipStatus, 'source_owner_confirmed');
    assert.equal(
      approvedHockey.rows[1].normalized.membershipStatus,
      'section_classification_required',
    );
    assert.equal(approvedHockey.rows[0].normalized.identityStatus, 'source_owner_confirmed');
    assert.ok(
      approved.imports
        .filter((item) => item.kind.includes('schedule'))
        .flatMap((item) => item.rows)
        .every((row) => row.normalized.mappingEvidence.reviewedBy === 'Tarik Merchant'),
    );
    await writeFile(evidencePath, JSON.stringify({ ...evidence, note: 'changed evidence' }));
    const changedEvidence = await run();
    assert.equal(
      changedEvidence.imports.find((item) => item.source === before.source).approval,
      null,
    );
    assert.ok(changedEvidence.imports.find((item) => item.source === hockey.source).approval);
    await writeFile(
      path.join(logic, "Fall.Winter Brock Fantasy Information - Men's Hockey - Roster.csv"),
      '#,Full name,Position,25-26 GP,25-26 FP\n1,Changed,GK,2,0\n',
    );
    assert.equal(
      (await run()).imports.find((item) => item.source === hockey.source).approval,
      null,
    );
    const optedOutSource = path.join(
      logic,
      "Fall.Winter Brock Fantasy Information - Men's Hockey - Roster.csv",
    );
    await writeFile(
      optedOutSource,
      '#,Full name,Position,26-27 Proj GP,26-27 Proj FP\n1,Changed**,GK,20,999\n',
    );
    const optedOut = (await run()).imports.find((item) => item.source === hockey.source).rows[0];
    assert.equal(optedOut.raw['Full name'], 'Changed**');
    assert.equal(optedOut.normalized.name, 'Changed');
    assert.equal(optedOut.normalized.excludedFromFantasy, true);
    assert.equal(optedOut.normalized.rankingInput.status, 'excluded');
    assert.equal(optedOut.normalized.draftEligible, false);
    assert.deepEqual(optedOut.normalized.identityCandidates, []);
    await writeFile(
      path.join(directory, 'suppressions.json'),
      JSON.stringify({
        revision: 'retained-withdrawal',
        athletes: [{ program: 'mens_hockey', name: 'Changed' }],
      }),
    );
    await writeFile(
      optedOutSource,
      '#,Full name,Position,26-27 Proj GP,26-27 Proj FP\n99,Changed,GK,20,999\n',
    );
    const retained = await run();
    assert.equal(
      retained.imports.find((item) => item.source === hockey.source).rows[0].normalized
        .excludedFromFantasy,
      true,
    );
    assert.ok(retained.rosterSuppressions.sourceHash);
  } finally {
    // mkdtemp returned this exact absolute target inside the OS temporary directory.
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
