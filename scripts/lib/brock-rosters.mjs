// Opt-out matching only suppresses source candidates; it never assigns or merges
// permanent athlete identities. Raw names remain in restricted import evidence.
export function rosterName(raw) {
  return raw.replaceAll('**', '').trim().replace(/\s+/gu, ' ');
}

export function rosterParticipation(program, rawName, suppressions) {
  const name = rosterName(rawName);
  const recorded = suppressions?.athletes?.find(
    (athlete) =>
      athlete.program === program &&
      rosterName(athlete.name).toLocaleLowerCase('en-CA') === name.toLocaleLowerCase('en-CA'),
  );
  const optedOut = rawName.includes('**') || Boolean(recorded);
  return {
    name,
    participationStatus: optedOut ? 'opted_out' : 'participating',
    participationEvidence: optedOut
      ? {
          basis: rawName.includes('**') ? 'source_name_double_asterisk' : 'retained_opt_out',
          revision: suppressions?.revision ?? null,
        }
      : null,
    excludedFromFantasy: optedOut,
  };
}

export function suppliedRanking(candidate, definition) {
  if (candidate.excludedFromFantasy)
    return { status: 'excluded', points: null, basis: 'athlete_opt_out' };
  if (definition?.status !== 'supplied_season_projections') return definition ?? null;
  const projection = candidate.suppliedSeasonProjection;
  return {
    ...definition,
    status: projection.kind === 'number' ? 'ready' : 'unavailable',
    points: projection.kind === 'number' ? projection.value : null,
    basis: 'supplied_season_projection',
  };
}
