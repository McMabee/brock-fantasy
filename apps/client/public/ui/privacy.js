// - Share the same identifier-free preference contract on every public and authenticated page
(function () {
  'use strict';
  const choiceName = 'bf_consent';
  const age = 180 * 24 * 60 * 60;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  const cookie = (name) => {
    const values = document.cookie
      .split(';')
      .map((item) => item.trim())
      .filter((item) => item.startsWith(name + '='));
    return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
  };
  const choice = () => {
    const value = cookie(choiceName);
    return value === 'v1.preferences' ? true : value === 'v1.necessary' ? false : null;
  };
  function clearOptional() {
    document.cookie = 'bf_theme=; Path=/; Max-Age=0; SameSite=Lax' + secure;
  }
  if (choice() !== true) clearOptional();
  let dialog;
  let opener;
  const notice =
    '<h2>Cookies and your choices</h2><p>We use necessary cookies for sign-in and security. With your permission, we also remember settings such as your theme. We do not use advertising or analytics trackers.</p><div class="cookie-actions"><button type="button" data-bf-cookie-choice="necessary">Necessary only</button><button type="button" data-bf-cookie-choice="preferences">Allow preferences</button><button type="button" data-bf-cookie-settings>Manage preferences</button><a href="/policies/cookie-policy.html">Cookie policy</a></div>';
  function sync() {
    const banners = document.querySelectorAll('[data-bf-cookie-banner][data-bf-cookie-ready]');
    for (const banner of banners) {
      if (!banner.firstElementChild) banner.innerHTML = notice;
      banner.hidden = choice() !== null;
    }
  }
  function save(allow) {
    const bannerFocused = document.activeElement?.closest('[data-bf-cookie-banner]');
    document.cookie =
      choiceName +
      '=v1.' +
      (allow ? 'preferences' : 'necessary') +
      '; Path=/; SameSite=Lax; Max-Age=' +
      age +
      secure;
    if (!allow) clearOptional();
    sync();
    window.dispatchEvent(new CustomEvent('bf:privacy-change', { detail: { preferences: allow } }));
    if (dialog?.open) dialog.close();
    else if (bannerFocused) document.querySelector('#bf-main')?.focus({ preventScroll: true });
  }
  function open(trigger) {
    opener = trigger instanceof HTMLElement ? trigger : document.activeElement;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'cookie-settings';
      dialog.setAttribute('aria-labelledby', 'bf-cookie-title');
      dialog.innerHTML =
        '<form method="dialog"><h2 id="bf-cookie-title">Cookie preferences</h2><p>Necessary cookies keep sign-in, account recovery, security, and these choices working. They are always available when needed.</p><label><input type="checkbox" name="preferences"> Remember my settings, including theme</label><p>Advertising, analytics, and profiling are not used. You can change this choice at any time.</p><div class="cookie-actions"><button type="button" data-bf-cookie-save>Save preferences</button><button type="button" data-bf-cookie-choice="necessary">Necessary only</button><button value="cancel">Cancel</button></div><p><a href="/policies/cookie-policy.html">Read the cookie policy</a></p></form>';
      dialog.addEventListener('close', () => {
        const target =
          opener?.isConnected && !opener.closest('[hidden]')
            ? opener
            : document.querySelector('.cookie-settings-link');
        target?.focus();
      });
      document.body.append(dialog);
    }
    dialog.querySelector('input').checked = choice() === true;
    if (!dialog.open) dialog.showModal();
  }
  document.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest(
            '[data-bf-cookie-choice],[data-bf-cookie-settings],[data-bf-cookie-save]',
          )
        : null;
    if (!button) return;
    event.preventDefault();
    if (button.hasAttribute('data-bf-cookie-settings')) open(button);
    else if (button.hasAttribute('data-bf-cookie-save'))
      save(dialog.querySelector('input').checked);
    else save(button.dataset.bfCookieChoice === 'preferences');
  });
  window.addEventListener('bf:privacy-open', () => open(document.activeElement));
  window.addEventListener('bf:privacy-check', sync);
  function ready() {
    const main = document.querySelector('main');
    if (document.body.hasAttribute('data-bf-cookie-auto') && main) {
      main.id ||= 'bf-main';
      main.tabIndex = -1;
      if (!document.querySelector('.bf-skip')) {
        const skip = document.createElement('a');
        skip.className = 'bf-skip';
        skip.href = '#' + main.id;
        skip.textContent = 'Skip to main content';
        document.body.prepend(skip);
      }
    }
    // - Standalone authentication and policy documents use the same nonblocking notice
    if (
      document.body.hasAttribute('data-bf-cookie-auto') &&
      !document.querySelector('[data-bf-cookie-banner]')
    ) {
      const banner = document.createElement('section');
      banner.className = 'cookie-banner';
      banner.setAttribute('data-bf-cookie-banner', '');
      banner.setAttribute('data-bf-cookie-ready', '');
      banner.setAttribute('aria-label', 'Cookie choices');
      (document.querySelector('main') || document.body).prepend(banner);
    }
    if (
      document.body.hasAttribute('data-bf-cookie-auto') &&
      !document.querySelector('[data-bf-cookie-settings]')
    ) {
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'cookie-settings-link';
      settings.setAttribute('data-bf-cookie-settings', '');
      settings.textContent = 'Cookie settings';
      (document.querySelector('footer') || document.querySelector('main') || document.body).append(
        settings,
      );
    }
    sync();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
