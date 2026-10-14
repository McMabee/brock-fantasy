// Runs before body paint. Theme preference is a non-sensitive appearance cookie.
document.documentElement.dataset.brockTheme = document.cookie.split('; ').includes('bf_theme=light')
  ? 'light'
  : 'dark';
