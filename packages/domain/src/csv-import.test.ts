import { describe, expect, it } from 'vitest';

import { CsvImportError, parseProviderCsv } from './csv-import';

const header =
  'provider,providerGameId,revision,capturedAt,gameStatus,providerAthleteId,athleteName,teamProviderId,position,stats.goals,stats.assists';

describe('provider CSV import', () => {
  it('converts player rows to the canonical snapshot without discarding the source rows', () => {
    const snapshot = parseProviderCsv(
      `${header}\nfixture,game-1,r1,2026-09-22T12:00:00Z,final,a-1,"Doe, Jane",brock,F,2,1\nfixture,game-1,r1,2026-09-22T12:00:00Z,final,a-2,Smith Alex,brock,D,0,3`,
    );

    expect(snapshot).toMatchObject({
      provider: 'fixture',
      providerGameId: 'game-1',
      revision: 'r1',
      gameStatus: 'final',
      players: [
        { providerAthleteId: 'a-1', athleteName: 'Doe, Jane', stats: { goals: 2, assists: 1 } },
        { providerAthleteId: 'a-2', athleteName: 'Smith Alex', stats: { goals: 0, assists: 3 } },
      ],
      raw: { format: 'csv' },
    });
  });

  it('accepts a BOM, CRLF rows, escaped quotes, and an omitted optional revision', () => {
    const snapshot = parseProviderCsv(
      '\uFEFFprovider,providerGameId,capturedAt,gameStatus,providerAthleteId,athleteName,teamProviderId,stats.points\r\nfixture,game-2,2026-09-22T12:00:00Z,in_progress,a-1,"Jane ""Ace"" Doe",brock,4.5\r\n',
    );

    expect(snapshot.revision).toBeUndefined();
    expect(snapshot.players[0]).toMatchObject({
      athleteName: 'Jane "Ace" Doe',
      stats: { points: 4.5 },
    });
  });

  it('rejects inconsistent game metadata across player rows', () => {
    expect(() =>
      parseProviderCsv(
        `${header}\nfixture,game-1,r1,2026-09-22T12:00:00Z,final,a-1,Jane,brock,F,2,1\nfixture,game-2,r1,2026-09-22T12:00:00Z,final,a-2,Alex,brock,D,0,3`,
      ),
    ).toThrowError(new CsvImportError('Row 3 has inconsistent providerGameId.'));
  });

  it('rejects malformed statistic values and unsupported columns', () => {
    expect(() =>
      parseProviderCsv(
        `${header}\nfixture,game-1,r1,2026-09-22T12:00:00Z,final,a-1,Jane,brock,F,two,1`,
      ),
    ).toThrow('Row 2 has a non-numeric value for stats.goals.');
    expect(() =>
      parseProviderCsv(
        'provider,providerGameId,capturedAt,gameStatus,providerAthleteId,athleteName,teamProviderId,goals\nfixture,game-1,2026-09-22T12:00:00Z,final,a-1,Jane,brock,2',
      ),
    ).toThrow('The CSV needs at least one stats.<key> column.');
  });
});
