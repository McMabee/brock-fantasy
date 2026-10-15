"""Export the complete public Markdown set and a combined handoff PDF.

Run from the repository root: python scripts/export-public-pdfs.py
Install dependencies with pip -r scripts/requirements-public-pdfs.txt.
"""

from datetime import date
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re

from markdown_it import MarkdownIt
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "dev/docs/public"
OUTPUT = SOURCE / "pdfs"
QA = ROOT / "dev/tmp/pdfs"
WIDTH, HEIGHT = letter
CONTENT_WIDTH = WIDTH - 108
NAVY = colors.HexColor("#1C2D5D")
RED = colors.HexColor("#F20014")
GRAY = colors.HexColor("#59616E")
parser = MarkdownIt("commonmark").enable("table")


def register_fonts():
    windows = Path("C:/Windows/Fonts")
    if (windows / "arial.ttf").exists():
        for name, filename in [
            ("Policy", "arial.ttf"),
            ("Policy-Bold", "arialbd.ttf"),
            ("Policy-Italic", "ariali.ttf"),
            ("Policy-BoldItalic", "arialbi.ttf"),
        ]:
            pdfmetrics.registerFont(TTFont(name, str(windows / filename)))
        pdfmetrics.registerFontFamily(
            "Policy", normal="Policy", bold="Policy-Bold",
            italic="Policy-Italic", boldItalic="Policy-BoldItalic",
        )
    else:
        pdfmetrics.registerFontFamily(
            "Policy", normal="Helvetica", bold="Helvetica-Bold",
            italic="Helvetica-Oblique", boldItalic="Helvetica-BoldOblique",
        )
        return "Helvetica"
    return "Policy"


FONT = register_fonts()
styles = getSampleStyleSheet()
for name, size, leading, after in [
    ("Body", 10.2, 14.5, 8),
    ("TitlePolicy", 24, 28, 14),
    ("H2Policy", 14, 18, 8),
    ("H3Policy", 11.5, 15, 6),
    ("TablePolicy", 8.5, 11.8, 0),
    ("ReferencePolicy", 8.2, 11.5, 5),
]:
    styles.add(ParagraphStyle(
        name=name, fontName=FONT, fontSize=size, leading=leading,
        spaceAfter=after, textColor=NAVY if "Policy" in name and name != "TablePolicy" else colors.black,
        alignment=TA_LEFT, splitLongWords=True,
        allowWidows=False, allowOrphans=False,
        keepWithNext=name.startswith(("Title", "H2", "H3")),
        spaceBefore=12 if name.startswith("H") else 0,
    ))
styles["Body"].textColor = colors.HexColor("#242A34")
styles["ReferencePolicy"].textColor = GRAY


def clean(text):
    # Keep typography portable while retaining all source words and values.
    return text.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", " - ").replace("\u2212", "-")


def inline(token, references):
    parts = []
    for index, child in enumerate(token.children or []):
        if child.type == "text":
            parts.append(escape(clean(child.content)))
        elif child.type == "code_inline":
            parts.append('<font name="Courier" size="8.5">' + escape(clean(child.content)) + "</font>")
        elif child.type in ("softbreak", "hardbreak"):
            parts.append(" " if child.type == "softbreak" else "<br/>")
        elif child.type == "strong_open":
            parts.append("<b>")
        elif child.type == "strong_close":
            parts.append("</b>")
        elif child.type == "em_open":
            parts.append("<i>")
        elif child.type == "em_close":
            parts.append("</i>")
        elif child.type == "link_open":
            target = child.attrGet("href") or ""
            if target not in references:
                references.append(target)
            child.meta["reference_index"] = references.index(target) + 1
            parts.append('<font color="#1C2D5D"><u>')
        elif child.type == "link_close":
            parts.append("</u></font>")
            # Find this link's open token, including repeated/relative references.
            opening = next(c for c in reversed(token.children[:index]) if c.type == "link_open")
            parts.append(f'<super>{opening.meta["reference_index"]}</super>')
        elif child.type == "html_inline":
            # Numbered entries in table cells use explicit line breaks.
            # Reject all other HTML instead of dropping or interpreting content.
            if re.fullmatch(r"<br\s*/?>", child.content):
                parts.append("<br/>")
            else:
                raise ValueError(f"Unexpected inline HTML: {child.content}")
        else:
            raise ValueError(f"Unsupported inline Markdown: {child.type}")
    return "".join(parts)


def build_story(markdown):
    tokens = parser.parse(markdown)
    story, references, list_stack = [], [], []
    index = 0
    title = None
    while index < len(tokens):
        token = tokens[index]
        if token.type == "heading_open":
            text = inline(tokens[index + 1], references)
            level = int(token.tag[1])
            style = "TitlePolicy" if level == 1 else "H2Policy" if level == 2 else "H3Policy"
            heading_style = styles[style]
            if index + 3 < len(tokens) and tokens[index + 3].type == "table_open":
                heading_style = ParagraphStyle("BeforeTable", parent=heading_style, keepWithNext=False)
            story.append(Paragraph(text, heading_style))
            if title is None:
                title = tokens[index + 1].content
                story.append(HRFlowable(width="100%", thickness=2, color=RED, spaceAfter=12))
            index += 3
            continue
        if token.type in ("bullet_list_open", "ordered_list_open"):
            list_stack.append({"ordered": token.type == "ordered_list_open", "number": token.attrGet("start") or 1})
        elif token.type in ("bullet_list_close", "ordered_list_close"):
            list_stack.pop()
        elif token.type == "paragraph_open":
            text = inline(tokens[index + 1], references)
            style = styles["Body"]
            if list_stack:
                context = list_stack[-1]
                marker = f'{context["number"]}.' if context["ordered"] else "-"
                context["number"] = int(context["number"]) + 1
                text = f"{marker} {text}"
                style = ParagraphStyle("ListPolicy", parent=style, leftIndent=12 * len(list_stack), firstLineIndent=-9)
            story.append(Paragraph(text, style))
            index += 3
            continue
        elif token.type == "table_open":
            rows, row, header = [], [], False
            index += 1
            while tokens[index].type != "table_close":
                cell = tokens[index]
                if cell.type == "thead_open":
                    header = True
                elif cell.type == "thead_close":
                    header = False
                elif cell.type == "tr_open":
                    row = []
                elif cell.type == "tr_close":
                    rows.append(row)
                elif cell.type == "inline":
                    value = inline(cell, references)
                    row.append(Paragraph(f"<b>{value}</b>" if header else value, styles["TablePolicy"]))
                index += 1
            count = len(rows[0])
            fractions = [0.27, 0.73] if count == 2 else [0.23, 0.34, 0.43] if count == 3 else [1/count] * count
            table = LongTable(rows, colWidths=[CONTENT_WIDTH*f for f in fractions], repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E9EDF4")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, NAVY),
                ("INNERGRID", (0, 1), (-1, -1), 0.25, colors.HexColor("#D9DFE7")),
                ("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#D9DFE7")),
            ]))
            story.extend([table, Spacer(1, 10)])
        elif token.type == "fence":
            story.append(Paragraph(escape(clean(token.content)).replace("\n", "<br/>"), styles["ReferencePolicy"]))
        elif token.type == "hr":
            story.append(HRFlowable(width="100%", thickness=0.5, color=GRAY, spaceAfter=8))
        elif token.type not in ("list_item_open", "list_item_close", "blockquote_open", "blockquote_close"):
            raise ValueError(f"Unsupported block Markdown: {token.type}")
        index += 1
    if references:
        story.append(Paragraph("References and document links", styles["H2Policy"]))
        for number, target in enumerate(references, 1):
            text = escape(clean(target))
            if target.startswith(("https://", "http://")):
                text = f'<link href="{escape(target, quote=True)}" color="#1C2D5D">{text}</link>'
            elif target.split("#")[0].endswith(".md") and not target.startswith("../"):
                pdf_target = target.split("#")[0].replace(".md", ".pdf")
                text += f" (companion PDF: {escape(pdf_target)})"
            story.append(Paragraph(f"{number}. {text}", styles["ReferencePolicy"]))
    return story, title


def page_frame(canvas, document):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.setFont(FONT, 8.5)
    canvas.drawString(54, HEIGHT - 31, "BROCK FANTASY  /  PUBLIC POLICY HANDOFF")
    canvas.setStrokeColor(colors.HexColor("#D9DFE7"))
    canvas.line(54, 39, WIDTH - 54, 39)
    canvas.setFillColor(GRAY)
    canvas.setFont(FONT, 8)
    canvas.drawString(54, 26, "Unapproved draft - effective date pending")
    canvas.drawRightString(WIDTH - 54, 26, f"{date.today().isoformat()}  |  Page {document.page}")
    canvas.restoreState()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    sources = sorted(SOURCE.glob("*.md"), key=lambda path: (path.name != "README.md", path.name))
    writer, evidence = PdfWriter(), []
    for source in sources:
        markdown = source.read_text(encoding="utf-8")
        if any(marker in markdown for marker in ("â€", "Ã", "\ufffd")):
            raise RuntimeError(f"Suspected source encoding damage in {source.name}")
        story, title = build_story(markdown)
        output = OUTPUT / f"{source.stem}.pdf"
        document = SimpleDocTemplate(
            str(output), pagesize=letter, leftMargin=54, rightMargin=54,
            topMargin=58, bottomMargin=54, title=title,
            author="Brock Fantasy", subject="Public documents for Tarik; operator publication pending",
        )
        document.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
        reader = PdfReader(output)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        if len(text.strip()) < len(markdown) * 0.45 or not text.strip():
            raise RuntimeError(f"Insufficient extracted content in {output}")
        if "\ufffd" in text or "\u25a0" in text:
            raise RuntimeError(f"Unrendered glyph in {output}")
        without_frames = re.sub(r"BROCK FANTASY\s*/\s*PUBLIC POLICY HANDOFF\s*", "", text)
        without_frames = re.sub(r"Unapproved draft - effective date pending\s*", "", without_frames)
        without_frames = re.sub(r"\d{4}-\d{2}-\d{2}\s*\|\s*Page\s*\d+\s*", "", without_frames)
        normalized = lambda value: re.sub(r"\s+", "", clean(value).replace(" - ", "-"))
        for token in parser.parse(markdown):
            for child in token.children or []:
                if child.type in ("text", "code_inline") and normalized(child.content) not in normalized(without_frames):
                    raise RuntimeError(f"Source text absent from {output.name}: {child.content}")
        start_page = len(writer.pages)
        for page in reader.pages:
            writer.add_page(page)
        writer.add_outline_item(title, start_page)
        evidence.append({"source":str(source.relative_to(ROOT)).replace("\\", "/"),
            "sourceHash":sha256(source.read_bytes()).hexdigest(),
            "pdf":str(output.relative_to(ROOT)).replace("\\", "/"),
            "pdfHash":sha256(output.read_bytes()).hexdigest(), "pages":len(reader.pages),
            "extractedCharacters":len(text)})
    bundle = OUTPUT / "brock-fantasy-public-policies.pdf"
    writer.add_metadata({"/Title":"Brock Fantasy public policies - Tarik handoff", "/Author":"Brock Fantasy"})
    writer.write(bundle)
    writer.close()
    if len(PdfReader(bundle).pages) != sum(item["pages"] for item in evidence):
        raise RuntimeError("Combined package page count differs from individual PDFs")
    (QA / "export-evidence.json").write_text(json.dumps({"documents":evidence,
        "bundle":str(bundle.relative_to(ROOT)), "bundlePages":len(PdfReader(bundle).pages)}, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"individualPdfs":len(evidence), "bundlePages":len(PdfReader(bundle).pages), "output":str(OUTPUT)}))


if __name__ == "__main__":
    main()
