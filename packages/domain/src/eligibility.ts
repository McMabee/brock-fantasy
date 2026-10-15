export const ELIGIBILITY_POLICY_VERSION = 'brock-beta-eligibility-2026-10-06.1';

export function registrationYearAt(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
    }).format(date),
  );
}
