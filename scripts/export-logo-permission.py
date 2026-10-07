"""Export the unsigned logo permission template for the rights holder."""
from pathlib import Path
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate
import importlib.util

spec = importlib.util.spec_from_file_location("public_pdf_export", Path(__file__).with_name("export-public-pdfs.py"))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
build_story, FONT, WIDTH = exporter.build_story, exporter.FONT, exporter.WIDTH

root = Path(__file__).resolve().parents[1]
source = root / "dev/docs/templates/logo-permission-signoff.md"
output = source.with_suffix(".pdf")
story, title = build_story(source.read_text(encoding="utf-8"))

def frame(canvas, document):
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#1C2D5D"))
    canvas.setFont(FONT, 8)
    canvas.drawString(54, letter[1] - 32, "BROCK FANTASY / LOGO PERMISSION")
    canvas.drawString(54, 26, "Unsigned template - permission pending")
    canvas.drawRightString(WIDTH - 54, 26, f"Page {document.page}")
    canvas.restoreState()

document = SimpleDocTemplate(str(output), pagesize=letter, leftMargin=54,
    rightMargin=54, topMargin=58, bottomMargin=54, title=title,
    author="Brock Fantasy", subject="Unsigned logo rights permission template")
document.build(story, onFirstPage=frame, onLaterPages=frame)
reader = PdfReader(output)
text = "\n".join(page.extract_text() or "" for page in reader.pages)
for expected in ("Mark Pirog", "Ty Mabee", "Signatures", "permission", "Unsigned"):
    if expected not in text:
        raise RuntimeError(f"Missing template content: {expected}")
print(f"Exported unsigned logo permission form: {len(reader.pages)} pages")
