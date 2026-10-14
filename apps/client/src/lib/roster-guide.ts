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

export const ROSTER_GUIDE: readonly { code: BetaSlot; label: string; count: number }[] = [
  { code: 'HK_F', label: 'Hockey forward', count: 1 },
  { code: 'HK_DG', label: 'Hockey defence or goalie', count: 1 },
  { code: 'BB_BC', label: 'Basketball guard', count: 1 },
  { code: 'BB_FC', label: 'Basketball forward or centre', count: 1 },
  { code: 'VB_HT', label: 'Volleyball hitter', count: 1 },
  { code: 'VB_LS', label: 'Volleyball libero or setter', count: 1 },
  { code: 'BN', label: 'Bench', count: 4 },
];
const SLOT_LABELS = new Map(ROSTER_GUIDE.map((slot) => [slot.code, slot.label]));

export function rosterSlotLabel(code: string): string {
  return SLOT_LABELS.get(code as BetaSlot) ?? code.replaceAll('_', ' ');
}

export function positionLabel(position: string): string {
  return position
    .split(/\s*[/,;]\s*/u)
    .map((code) => POSITION_LABELS[code as BetaPosition] ?? code)
    .join(' / ');
}

export function slotEligibility(code: BetaSlot): string {
  return code === 'BN'
    ? 'Any eligible athlete from the six programs'
    : BETA_SLOTS[code].map((position) => POSITION_LABELS[position]).join(' or ');
}
