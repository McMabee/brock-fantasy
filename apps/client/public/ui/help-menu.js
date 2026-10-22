(() => {
  const openMenu = () => document.querySelector('details[data-bf-help][open]');
  document.addEventListener(
    'toggle',
    (event) => {
      const menu = event.target;
      if (menu.matches?.('details[data-bf-help]'))
        menu.querySelector('summary').setAttribute('aria-expanded', String(menu.open));
    },
    true,
  );
  document.addEventListener('pointerdown', (event) => {
    const menu = openMenu();
    if (menu && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    const menu = openMenu();
    if (event.key !== 'Escape' || !menu) return;
    event.preventDefault();
    menu.open = false;
    menu.querySelector('summary').focus();
  });
  document.addEventListener('click', (event) => {
    // - Close before following a link, including client-side navigation
    const menu = event.target.closest?.('[data-bf-help] a')?.closest('details');
    if (menu) menu.open = false;
  });
})();
