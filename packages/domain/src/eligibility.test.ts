import { describe, expect, it } from 'vitest';
import { registrationYearAt } from './eligibility';

describe('calendar-year eligibility attestation', () => {
  it('uses the Toronto registration year at the UTC new-year boundary', () => {
    expect(registrationYearAt(new Date('2027-01-01T04:59:59Z'))).toBe(2026);
    expect(registrationYearAt(new Date('2027-01-01T05:00:00Z'))).toBe(2027);
  });
});
