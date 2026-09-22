import type { ProviderStatSnapshot } from './types';
import { providerStatSnapshotSchema } from './provider';

const metadataColumns = [
  'provider',
  'providerGameId',
  'revision',
  'capturedAt',
  'gameStatus',
  'providerAthleteId',
  'athleteName',
  'teamProviderId',
  'position',
] as const;

const requiredColumns = [
  'provider',
  'providerGameId',
  'capturedAt',
  'gameStatus',
  'providerAthleteId',
  'athleteName',
  'teamProviderId',
] as const;

export const providerCsvColumns = {
  required: requiredColumns,
  optional: ['revision', 'position'] as const,
  statPrefix: 'stats.',
};

export class CsvImportError extends Error {
  override name = 'CsvImportError';
}

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;

  const finishField = () => {
    row.push(field);
    field = '';
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
    row = [];
  };

  const source = input.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== ',' && character !== '\n' && character !== '\r') {
      if (/\s/.test(character)) continue;
      throw new CsvImportError('Unexpected text after a closing quote.');
    }
    if (character === '"') {
      if (field.length > 0)
        throw new CsvImportError('A quoted value must start at the field boundary.');
      inQuotes = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      finishRow();
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new CsvImportError('The CSV ends inside a quoted value.');
  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}

function requireValue(row: Readonly<Record<string, string>>, column: string, rowNumber: number) {
  const value = row[column]?.trim();
  if (!value) throw new CsvImportError(`Row ${rowNumber} is missing ${column}.`);
  return value;
}

export function parseProviderCsv(input: string): ProviderStatSnapshot {
  const rows = parseRows(input);
  const headerRow = rows[0];
  if (!headerRow) throw new CsvImportError('The CSV is empty.');

  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => !header)) throw new CsvImportError('CSV headers cannot be empty.');
  if (new Set(headers).size !== headers.length) {
    throw new CsvImportError('CSV headers must be unique.');
  }

  for (const column of requiredColumns) {
    if (!headers.includes(column)) throw new CsvImportError(`The CSV is missing ${column}.`);
  }
  const statHeaders = headers.filter((header) => header.startsWith(providerCsvColumns.statPrefix));
  if (statHeaders.length === 0) {
    throw new CsvImportError('The CSV needs at least one stats.<key> column.');
  }
  if (statHeaders.some((header) => header.length === providerCsvColumns.statPrefix.length)) {
    throw new CsvImportError('Every statistic column needs a key after stats.');
  }

  const allowedHeaders = new Set<string>([...metadataColumns, ...statHeaders]);
  const unsupportedHeader = headers.find((header) => !allowedHeaders.has(header));
  if (unsupportedHeader) {
    throw new CsvImportError(
      `Unsupported column ${unsupportedHeader}. Statistic columns must start with stats.`,
    );
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) throw new CsvImportError('The CSV has no player rows.');

  const records = dataRows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new CsvImportError(
        `Row ${rowNumber} has ${values.length} values; expected ${headers.length}.`,
      );
    }
    return Object.fromEntries(
      headers.map((header, valueIndex) => [header, values[valueIndex] ?? '']),
    );
  });

  const first = records[0];
  if (!first) throw new CsvImportError('The CSV has no player rows.');
  const provider = requireValue(first, 'provider', 2);
  const providerGameId = requireValue(first, 'providerGameId', 2);
  const capturedAt = requireValue(first, 'capturedAt', 2);
  const gameStatus = requireValue(first, 'gameStatus', 2);
  const revision = first.revision?.trim() || undefined;

  const players = records.map((record, index) => {
    const rowNumber = index + 2;
    for (const [column, expected] of [
      ['provider', provider],
      ['providerGameId', providerGameId],
      ['capturedAt', capturedAt],
      ['gameStatus', gameStatus],
      ['revision', revision ?? ''],
    ] as const) {
      if ((record[column]?.trim() ?? '') !== expected) {
        throw new CsvImportError(`Row ${rowNumber} has inconsistent ${column}.`);
      }
    }

    const stats = Object.fromEntries(
      statHeaders.map((header) => {
        const rawValue = requireValue(record, header, rowNumber);
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) {
          throw new CsvImportError(`Row ${rowNumber} has a non-numeric value for ${header}.`);
        }
        return [header.slice(providerCsvColumns.statPrefix.length), numericValue];
      }),
    );

    const position = record.position?.trim();
    return {
      providerAthleteId: requireValue(record, 'providerAthleteId', rowNumber),
      athleteName: requireValue(record, 'athleteName', rowNumber),
      teamProviderId: requireValue(record, 'teamProviderId', rowNumber),
      ...(position ? { position } : {}),
      stats,
    };
  });

  const candidate = {
    provider,
    providerGameId,
    ...(revision ? { revision } : {}),
    capturedAt,
    gameStatus,
    players,
    raw: {
      format: 'csv',
      headers,
      rows: records,
    },
  };

  const result = providerStatSnapshotSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new CsvImportError(issue?.message ?? 'The CSV could not be converted to a snapshot.');
  }
  return result.data as ProviderStatSnapshot;
}
