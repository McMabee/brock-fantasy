import { HELP_LINKS } from '../lib/help-navigation';

export function helpMenuMarkup(): string {
  return `<details class="help-menu help-menu--public" data-bf-help="true">
<summary role="button" aria-label="Help and support" aria-expanded="false" aria-controls="help-menu-options" title="Help and support"><span aria-hidden="true">?</span></summary>
<nav id="help-menu-options" class="help-menu-options" aria-label="Help and support options">${HELP_LINKS.map((link) => `<a href="${link.href}">${link.label}</a>`).join('')}</nav>
</details>`;
}
