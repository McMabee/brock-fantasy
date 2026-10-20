import { BETA_SLOTS, type BetaPosition, type BetaSlot } from '@brock-fantasy/domain';

export const POSITION_LABELS: Readonly<Record<BetaPosition, string>> = {
  F: 'Forward',
  D: 'Defence',
  G: 'Goalie',
  BC: 'Guard / backcourt',
  FC: 'Forward or centre / frontcourt',
  HT: 'Hitter / middle blocker',
  L: 'Libero',
  S: 'Setter',
};

export const ROSTER_GUIDE: readonly {
  code: BetaSlot;
  label: string;
  icon: string;
  shortLabel: string;
  count: number;
}[] = [
  { code: 'HK_F', label: 'Hockey forward', icon: '🏒', shortLabel: 'Forward', count: 1 },
  {
    code: 'HK_DG',
    label: 'Hockey defence or goalie',
    icon: '🏒',
    shortLabel: 'Defence / goalie',
    count: 1,
  },
  { code: 'BB_BC', label: 'Basketball guard', icon: '🏀', shortLabel: 'Guard', count: 1 },
  {
    code: 'BB_FC',
    label: 'Basketball forward or centre',
    icon: '🏀',
    shortLabel: 'Forward / centre',
    count: 1,
  },
  { code: 'VB_HT', label: 'Volleyball hitter', icon: '🏐', shortLabel: 'Hitter', count: 1 },
  {
    code: 'VB_LS',
    label: 'Volleyball libero or setter',
    icon: '🏐',
    shortLabel: 'Libero / setter',
    count: 1,
  },
  { code: 'FLEX', label: 'FLEX, any sport or position', icon: '⭐', shortLabel: 'FLEX', count: 1 },
  { code: 'BN', label: 'Bench', icon: '🪑', shortLabel: 'Bench', count: 3 },
];
const SLOT_LABELS = new Map(
  ROSTER_GUIDE.map((slot) => [slot.code, `${slot.icon} ${slot.shortLabel}`]),
);

export function rosterSlotLabel(code: string, varsity = false): string {
  if (varsity && code.startsWith('HK_'))
    return `🏒 Hockey ${code === 'HK_F' ? 1 : 2}, any position`;
  if (varsity && code.startsWith('BB_'))
    return `🏀 Basketball ${code === 'BB_BC' ? 1 : 2}, any position`;
  if (varsity && code.startsWith('VB_'))
    return `🏐 Volleyball ${code === 'VB_HT' ? 1 : 2}, any position`;
  return SLOT_LABELS.get(code as BetaSlot) ?? code.replaceAll('_', ' ');
}

export function positionLabel(position: string): string {
  return position
    .split(/\s*[/,;]\s*/u)
    .map((code) => POSITION_LABELS[code as BetaPosition] ?? code)
    .join(' / ');
}

export function slotEligibility(code: BetaSlot, varsity = false): string {
  if (varsity && code.startsWith('HK_')) return 'Forward, defence or goalie';
  if (varsity && code.startsWith('BB_')) return 'Backcourt or frontcourt';
  if (varsity && code.startsWith('VB_')) return 'Hitter, libero or setter';
  return code === 'BN' || code === 'FLEX'
    ? 'Any eligible athlete from the six programs'
    : BETA_SLOTS[code].map((position) => POSITION_LABELS[position]).join(' or ');
}
