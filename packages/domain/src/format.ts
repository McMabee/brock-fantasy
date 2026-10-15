const fantasyPointFormatter = new Intl.NumberFormat('en-CA', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 3,
});

export function formatFantasyPoints(points: number | null | undefined): string {
  return points == null || !Number.isFinite(points)
    ? 'Pending'
    : fantasyPointFormatter.format(points);
}
