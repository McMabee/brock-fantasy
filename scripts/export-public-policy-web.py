"""Render tracked policy sources for both Brock Fantasy websites"""

import argparse
from html import escape
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs/policies"
parser = MarkdownIt("commonmark", {"html": False}).enable("table")
parser.renderer.rules["table_open"] = lambda *_: '<div class="policy-table" role="region" tabindex="0" aria-label="Policy table"><table>\n'
parser.renderer.rules["table_close"] = lambda *_: '</table></div>\n'


def render(source):
    markdown = source.read_text(encoding="utf-8")
    if any(marker in markdown for marker in ("\ufffd", "[insert", "Tarik", "Unapproved policy draft")):
        raise RuntimeError(f"Unresolved public copy in {source.name}")
    title = markdown.splitlines()[0].removeprefix("# ")
    tokens = parser.parse(markdown)
    slugs = {}
    sections = []
    for index, token in enumerate(tokens):
        if token.type == "heading_open":
            label = tokens[index + 1].content
            slug = re.sub(r"[^\w\s-]", "", label.lower()).replace(" ", "-")
            count = slugs.get(slug, 0)
            slugs[slug] = count + 1
            token.attrSet("id", f"{slug}-{count}" if count else slug)
            if token.tag == "h2":
                sections.append((index, token.attrGet("id"), label))
    first_section = sections[0][0] if sections else len(tokens)
    intro = parser.renderer.render(tokens[3:first_section], parser.options, {})
    content = []
    for position, (start, identifier, label) in enumerate(sections):
        end = sections[position + 1][0] if position + 1 < len(sections) else len(tokens)
        content.append(f'<section class="policy-section" aria-labelledby="{identifier}">' + parser.renderer.render(tokens[start:end], parser.options, {}) + '</section>')
    body = ''.join(content)
    navigation = ''.join(f'<li><a href="#{identifier}">{escape(label)}</a></li>' for _, identifier, label in sections)
    description = {
        "privacy-notice": "Understand what Brock Fantasy collects, why it is used and how to exercise your choices.",
        "data-minimization": "Defined purposes. Limited information. Choices you control.",
    }.get(source.stem, "Clear information about your account, your leagues and the way Brock Fantasy operates.")
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{escape(title)} | Brock Fantasy</title>
<script src="/ui/policy-theme.js"></script><link rel="stylesheet" href="/ui/policies.css"><link rel="stylesheet" href="/ui/privacy.css"><script src="/ui/privacy.js" defer></script></head>
<body data-bf-cookie-auto data-policy-site="app"><a class="policy-skip" href="#bf-main">Skip to policy</a><header class="policy-header"><a class="policy-brand" href="/" aria-label="Brock Fantasy home"><span>BROCK</span><span>FANTASY</span></a><nav aria-label="Policy navigation"><a href="/privacy">Privacy overview</a><a href="/policies/terms-of-use.html">Terms</a><a href="/policies/support-policy.html">Support</a></nav></header>
<main id="bf-main" class="policy-shell" tabindex="-1"><header class="policy-hero"><p class="policy-eyebrow">YOUR INFORMATION</p><h1>{escape(title)}</h1><p class="policy-summary">{escape(description)}</p><div class="policy-meta">{intro}</div><div class="policy-actions"><a href="/policies/data-minimization.html">Data minimization</a><a href="/policies/privacy-notice.html">Complete privacy policy</a><a href="/policies/cookie-policy.html">Cookie choices</a></div></header><div class="policy-layout"><aside class="policy-toc"><nav aria-label="On this page"><h2>On this page</h2><ol>{navigation}</ol></nav></aside><article class="policy-content">{body}</article></div><section class="policy-help" aria-labelledby="policy-help-title"><div><p class="policy-eyebrow">WE CAN HELP</p><h2 id="policy-help-title">Questions about your information?</h2><p>Contact Brock Fantasy support for privacy, account or accessibility assistance.</p></div><a href="mailto:bfa.support64@gmail.com">bfa.support64@gmail.com</a></section></main>
<footer class="policy-footer"><a href="/">Return home</a><a href="mailto:bfa.support64@gmail.com">Contact Brock Fantasy support</a><a href="/policies/accessibility-statement.html">Accessibility</a><button type="button" data-bf-cookie-settings>Cookie settings</button></footer></body></html>
"""
    # - Format before comparing so generated pages remain reproducible after repository checks
    result = subprocess.run([shutil.which("node"), str(ROOT / "node_modules/prettier/bin/prettier.cjs"), "--stdin-filepath", "policy.html"], input=html, text=True, encoding="utf-8", capture_output=True, check=True, cwd=ROOT)
    return result.stdout


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--check", action="store_true")
    args.add_argument("--association-root", type=Path, default=ROOT.parent / "brock-fantasy-association")
    options = args.parse_args()
    targets = [ROOT / "apps/client/public"]
    if not options.association_root.is_dir():
        raise RuntimeError("Association checkout is required for consistent policy generation")
    targets.append(options.association_root / "public")
    pages = {f"policies/{p.stem}.html": render(p) for p in sorted(SOURCE.glob("*.md")) if p.name != "README.md"}
    pages["ui/policies.css"] = (SOURCE / "policies.css").read_text(encoding="utf-8")
    pages["ui/policy-theme.js"] = (SOURCE / "policy-theme.js").read_text(encoding="utf-8")
    for target in targets:
        for relative, content in pages.items():
            if target != ROOT / "apps/client/public" and relative.endswith(".html"):
                content = content.replace('data-policy-site="app"', 'data-policy-site="association"')
            if relative == "ui/policy-theme.js" and target != ROOT / "apps/client/public":
                with tempfile.TemporaryDirectory(prefix="brock-policy-") as directory:
                    temporary = Path(directory) / "theme.js"
                    temporary.write_text(content, encoding="utf-8")
                    subprocess.run([shutil.which("node"), str(options.association_root / "node_modules/oxfmt/bin/oxfmt"), str(temporary)], capture_output=True, check=True)
                    content = temporary.read_text(encoding="utf-8")
            output = target / relative
            if options.check:
                if not output.exists() or output.read_text(encoding="utf-8") != content:
                    raise RuntimeError(f"Generated policy differs: {output}")
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(content, encoding="utf-8", newline="\n")
    print(f"{'Verified' if options.check else 'Generated'} {len(pages) - 2} policies and shared styling for both websites")


if __name__ == "__main__":
    main()
