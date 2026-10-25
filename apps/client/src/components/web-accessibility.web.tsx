import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

export function WebAccessibility() {
  const path = usePathname();
  const previous = useRef(path);
  useEffect(() => {
    const navigateTabs = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'tab') return;
      const group = target.closest('[role="tablist"]');
      if (!group) return;
      const tabs = Array.from(group.querySelectorAll<HTMLElement>('[role="tab"]'));
      const index = tabs.indexOf(target);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : event.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft'
                ? (index - 1 + tabs.length) % tabs.length
                : -1;
      const nextTab = tabs[next];
      if (!nextTab) return;
      event.preventDefault();
      nextTab.focus();
      nextTab.click();
    };
    document.addEventListener('keydown', navigateTabs);
    return () => document.removeEventListener('keydown', navigateTabs);
  }, []);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('[data-bf-page]');
    if (!main) return;
    main.id = 'bf-main';
    main.tabIndex = -1;
    main.setAttribute('role', 'main');
    if (previous.current !== path) main.focus({ preventScroll: true });
    previous.current = path;
  }, [path]);
  return (
    <a href="#bf-main" className="bf-skip">
      Skip to main content
    </a>
  );
}
