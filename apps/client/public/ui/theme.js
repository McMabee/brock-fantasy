// - Apply only an explicitly permitted appearance preference before body paint
const choices = document.cookie
  .split(';')
  .map((part) => part.trim())
  .filter((part) => part.startsWith('bf_consent='));
const allowed = choices.length === 1 && choices[0] === 'bf_consent=v1.preferences';
const savedTheme =
  allowed &&
  document.cookie
    .split('; ')
    .find((part) => part.startsWith('bf_theme='))
    ?.slice(9);
document.documentElement.dataset.brockTheme =
  savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme
    : window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
