// - Apply saved appearance only when preference storage is allowed
(function () {
  const cookies = globalThis.document.cookie.split(';').map((item) => item.trim());
  if (!cookies.includes('bf_consent=v1.preferences')) return;
  const theme = cookies.find((item) => /^bf_theme=(?:light|dark)$/.test(item));
  if (theme) globalThis.document.documentElement.dataset.theme = theme.slice('bf_theme='.length);
})();
