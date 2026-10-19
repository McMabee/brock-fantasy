import { formatFantasyPoints } from '@brock-fantasy/domain';

export function projectedPoints(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? 'Unavailable'
    : `${formatFantasyPoints(value)} pts`;
}
export function gameTime(value: string): string {
  return new Date(value).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
