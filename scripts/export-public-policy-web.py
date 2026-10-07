"""Create checked-in web policy pages from the authoritative public Markdown.

Run after editing dev/docs/public: python scripts/export-public-policy-web.py
Uses the markdown-it-py version pinned in requirements-public-pdfs.txt.
The generated static files are included in Expo's public export without Python
being required on the hosting build machine.
"""

from hashlib import sha256
from datetime import date
from html import escape
import json
from pathlib import Path
import re

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "dev/docs/public"
OUTPUT = ROOT / "apps/client/public/policies"
parser = MarkdownIt("commonmark", {"html": False}).enable("table")
STYLE = """
:root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.6; }
body { margin: 0; background: #fff; color: #242a34; }
header, footer { background: #1c2d5d; color: #fff; padding: 1.25rem max(1rem, calc((100% - 76rem)/2)); }
header a, footer a { color: #fff; }
main { max-width: 76rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
main > p, main > ul, main > ol { max-width: 78ch; }
h1, h2, h3 { line-height: 1.3; color: #1c2d5d; }
h2 { margin-top: 2rem; }
a { color: #1c2d5d; text-decoration-thickness: .1em; text-underline-offset: .15em; overflow-wrap: anywhere; }
a:focus-visible { outline: 3px solid #f20014; outline-offset: 4px; }
table { width: 100%; border-collapse: collapse; font-size: .95rem; }
th, td { padding: .7rem; border: 1px solid #59616e; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
code { overflow-wrap: anywhere; }
@media (max-width: 40rem) { table { display: block; overflow-x: auto; } }
@media (prefers-color-scheme: dark) {
  body { background: #111827; color: #f3f4f6; }
  h1, h2, h3, main a { color: #c8d6ff; }
}
"""


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    pages = []
    for source in sorted(SOURCE.glob("*.md")):
        if source.name == "README.md":
            continue  # Internal publication checklist is only in the PDF handoff.
        markdown = source.read_text(encoding="utf-8")
        if any(marker in markdown for marker in ("â€", "Ã", "\ufffd")):
            raise RuntimeError(f"Suspected source encoding damage in {source.name}")
        title = markdown.splitlines()[0].removeprefix("# ")
        tokens = parser.parse(markdown)
        for token in tokens:
            for child in token.children or []:
                if child.type == "link_open":
                    target = child.attrGet("href") or ""
                    if re.fullmatch(r"[\w-]+\.md(?:#[\w-]+)?", target):
                        child.attrSet("href", target.replace(".md", ".html", 1))
        # Local fragment references use the same heading slugs as the Markdown.
        slugs = {}
        for i, token in enumerate(tokens):
            if token.type == "heading_open":
                label = tokens[i + 1].content
                slug = re.sub(r"[^\w\s-]", "", label.lower()).replace(" ", "-")
                count = slugs.get(slug, 0)
                slugs[slug] = count + 1
                token.attrSet("id", f"{slug}-{count}" if count else slug)
        body = parser.renderer.render(tokens, parser.options, {})
        html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{escape(title)} | Brock Fantasy</title><style>{STYLE}</style></head>
<body><header><a href="/">Brock Fantasy</a> · Draft for operator publication</header>
<main>{body}</main><footer>Requests: <a href="mailto:tymabee@proton.me,gt22me@brocku.ca">email Ty and Tarik</a>.</footer></body></html>
"""
        output = OUTPUT / f"{source.stem}.html"
        output.write_text(html, encoding="utf-8")
        pages.append({"source": source.relative_to(ROOT).as_posix(),
            "sourceHash": sha256(source.read_bytes()).hexdigest(),
            "page": output.relative_to(ROOT).as_posix(),
            "pageHash": sha256(output.read_bytes()).hexdigest()})
    evidence = ROOT / f"dev/docs/evidence/{date.today().isoformat()}-public-policy-web.json"
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps({"pages": pages, "hostedPublicationVerified": False,
        "status": "Drafts generated locally; effective date and configured-provider verification pending"}, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(pages)} complete draft policy pages in {OUTPUT}")


if __name__ == "__main__":
    main()
