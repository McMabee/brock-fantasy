// Advertising is disabled for the beta. This compatibility export lets older
// native bundles and deep links load safely while clients update.
export function SponsorPlacement(_: { placement: string; competitionId?: string | undefined }) {
  return null;
}
