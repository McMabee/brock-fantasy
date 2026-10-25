export const PREFERENCE_MAX_AGE = 180 * 24 * 60 * 60;

export function allowsPreferenceStorage(cookies: string): boolean {
  const choices = cookies
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('bf_consent='));
  return choices.length === 1 && choices[0] === 'bf_consent=v1.preferences';
}
