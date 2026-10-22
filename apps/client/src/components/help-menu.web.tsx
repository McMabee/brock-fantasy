import { Link } from 'expo-router';
import { useId } from 'react';
import { HELP_LINKS } from '@/lib/help-navigation';

export function HelpMenu() {
  const id = useId();
  return (
    <details className="help-menu" data-bf-help="true">
      <summary
        role="button"
        aria-label="Help and support"
        aria-expanded="false"
        aria-controls={id}
        title="Help and support"
      >
        <span aria-hidden="true">?</span>
      </summary>
      <nav id={id} className="help-menu-options" aria-label="Help and support options">
        {HELP_LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
