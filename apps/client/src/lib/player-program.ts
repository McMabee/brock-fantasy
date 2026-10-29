export const programNames: Readonly<Record<string, string>> = {
  mens_hockey: "Men's Hockey",
  womens_hockey: "Women's Hockey",
  mens_basketball: "Men's Basketball",
  womens_basketball: "Women's Basketball",
  mens_volleyball: "Men's Volleyball",
  womens_volleyball: "Women's Volleyball",
};

export const RANKING_SPORTS = [
  { label: 'Hockey', value: 'hockey', prefix: 'HK_' },
  { label: 'Basketball', value: 'basketball', prefix: 'BB_' },
  { label: 'Volleyball', value: 'volleyball', prefix: 'VB_' },
] as const;
