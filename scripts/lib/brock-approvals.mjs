import { createHash } from 'node:crypto';

// An approval applies to the exact source bytes recorded by the operator.
// Changing a source or the official schedule evidence requires a new record.
export function sourceApproval(document, source, sourceHash, officialEvidenceHash, kind) {
  const entry = document?.sources?.find(
    (item) => item.source === source && item.sourceHash === sourceHash,
  );
  if (!entry || document.season !== '2026-27' || !document.approvedBy || !document.confirmedOn)
    return null;
  if (
    ['schedule', 'combined_schedule'].includes(kind) &&
    document.officialEvidenceHash !== officialEvidenceHash
  )
    return null;
  return {
    approvalId: document.approvalId,
    approvedBy: document.approvedBy,
    confirmedOn: document.confirmedOn,
    confirmationBasis: document.confirmationBasis,
    rightsReference: document.rightsReference,
    sourceHash,
    scopes: entry.scopes,
  };
}

const categories = {
  V_b: { sport: 'volleyball', role: 'volleyball' },
  H_s: { sport: 'hockey', role: 'skater' },
  B_b: { sport: 'basketball', role: 'basketball' },
  H_g: { sport: 'hockey', role: 'goalie' },
};

export function scoringRow(raw, rowNumber, issues) {
  const coefficients = [];
  for (const [heading, cell] of Object.entries(raw)) {
    if (!cell.trim()) continue;
    const symbol = /\((\w+)\)\s*$/u.exec(heading)?.[1];
    const category = categories[symbol];
    const match = /^(.+?)\s*=\s*(-?\d+(?:\.\d+)?)(\/min)?\s*$/u.exec(cell.trim());
    if (!category || !match) {
      issues.push({
        severity: 'error',
        code: 'SCORING_COEFFICIENT',
        row: rowNumber,
        detail: `Cannot interpret scoring header/value: ${heading}: ${cell}`,
      });
      continue;
    }
    coefficients.push({
      ...category,
      categorySymbol: symbol,
      sourceHeading: heading,
      sourceValue: cell,
      label: match[1].trim(),
      coefficient: Number(match[2]),
      unit: match[3] ? 'per_minute' : 'per_stat_or_bonus',
      // V_b/H_s/B_b/H_g are preserved verbatim. No numeric multiplier
      // is inferred from a symbolic header.
      categoryMultiplier: null,
    });
  }
  return { type: 'scoring_rules', coefficients };
}

export function approvalHash(content) {
  return createHash('sha256').update(content).digest('hex');
}
