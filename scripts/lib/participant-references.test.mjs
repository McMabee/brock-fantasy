import assert from 'node:assert/strict';
import test from 'node:test';
import {
  participantReferencePlan,
  participantReferenceSql,
  referenceFiles,
} from './participant-references.mjs';
const seasonId = 'b0000000-0000-4000-8000-000000000002';
const sources = () =>
  referenceFiles.map(({ file, role }) => ({
    file,
    content:
      role === 'coach'
        ? 'Name,Email,Title\nExample Coach*,coach@example.test,Therapist\n,,\n'
        : 'Name,Position\nExample Player,F\n',
  }));
test('twelve sources retain provenance and keep same names separate until reviewed', () => {
  const plan = participantReferencePlan(sources(), { seasonId });
  assert.equal(plan.payload.references.length, 12);
  assert.equal(plan.duplicates.length, 2);
  assert.ok(
    plan.payload.references
      .filter((r) => r.role === 'coach')
      .every((r) => r.name === 'Example Coach' && r.sources[0].supportingStaff),
  );
  const same = participantReferencePlan(
    sources().map((x) => ({ ...x, content: x.content + '\n' })),
    { seasonId },
  );
  assert.deepEqual(
    same.payload.references.map((r) => r.id),
    plan.payload.references.map((r) => r.id),
  );
  const mappings = [
    { id: '11111111-1111-4111-8111-111111111111', members: plan.duplicates[0].members },
  ];
  const grouped = participantReferencePlan(sources(), { seasonId, mappings });
  assert.equal(grouped.payload.references.find((x) => x.id === mappings[0].id).programs.length, 6);
  assert.equal(grouped.payload.references.length, 7);
  assert.match(participantReferenceSql(plan, mappings[0].id), /publish_participant_references/u);
});
test('historical players and retained opt-outs never enter the reference set', () => {
  const inputs = sources();
  inputs[0].content += 'Excluded Player**,G\nPlayers from last year,\nPrevious Player,F\n';
  const plan = participantReferencePlan(inputs, {
    seasonId,
    suppressions: [{ program: 'mens_basketball', name: 'Example Player' }],
  });
  assert.equal(plan.payload.references.length, 11);
  assert.equal(plan.excluded, 2);
  assert.ok(!plan.payload.references.some((x) => /Excluded|Previous/u.test(x.name)));
});
test('invalid, incomplete and ambiguous imports fail before publication', () => {
  assert.throws(() => participantReferencePlan(sources().slice(1), { seasonId }), /twelve/u);
  const bad = sources();
  bad[1].content += 'Another Coach,invalid,Coach\n';
  assert.throws(() => participantReferencePlan(bad, { seasonId }), /email/u);
  bad[1].content = 'Name,Email,Title\n"Unclosed,foo@example.test,Coach';
  assert.throws(() => participantReferencePlan(bad, { seasonId }), /quote/u);
  bad[1].content = 'Name,Email,Title\nDuplicate,,Coach\nDuplicate,,Coach\n';
  assert.throws(() => participantReferencePlan(bad, { seasonId }), /Duplicate/u);
  assert.throws(
    () =>
      participantReferencePlan(sources(), {
        seasonId,
        mappings: [{ id: '11111111-1111-4111-8111-111111111111', members: ['missing', 'missing'] }],
      }),
    /Unknown/u,
  );
});
