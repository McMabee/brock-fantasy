import { useEffect, useRef } from 'react';

export function CookieNotice() {
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    host.current?.setAttribute('data-bf-cookie-ready', '');
    window.dispatchEvent(new Event('bf:privacy-check'));
  }, []);
  return (
    <section
      ref={host}
      className="cookie-banner"
      data-bf-cookie-banner=""
      aria-label="Cookie choices"
      hidden
      suppressHydrationWarning
    />
  );
}

export function CookieSettings() {
  return (
    <button className="cookie-settings-link" type="button" data-bf-cookie-settings>
      Cookie settings
    </button>
  );
}
