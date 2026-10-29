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
    for index, token in enumerate(tokens):
        if token.type == "heading_open":
            label = tokens[index + 1].content
            slug = re.sub(r"[^\w\s-]", "", label.lower()).replace(" ", "-")
            count = slugs.get(slug, 0)
            slugs[slug] = count + 1
            token.attrSet("id", f"{slug}-{count}" if count else slug)
    body = parser.renderer.render(tokens, parser.options, {})
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{escape(title)} | Brock Fantasy</title>
<script src="/ui/policy-theme.js"></script><link rel="stylesheet" href="/ui/policies.css"><link rel="stylesheet" href="/ui/privacy.css"><script src="/ui/privacy.js" defer></script></head>
<body data-bf-cookie-auto><header class="policy-header"><a class="policy-brand" href="/">BROCK FANTASY</a><nav aria-label="Policy navigation"><a href="/privacy">Privacy overview</a><a href="/policies/terms-of-use.html">Terms</a><a href="/policies/support-policy.html">Support</a></nav></header>
<main id="bf-main" class="policy-shell" tabindex="-1"><article class="policy-content">{body}</article></main>
<footer class="policy-footer"><a href="/">Return home</a><a href="mailto:tymabee@proton.me">Contact Brock Fantasy support</a><a href="/policies/accessibility-statement.html">Accessibility</a><button type="button" data-bf-cookie-settings>Cookie settings</button></footer></body></html>
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
