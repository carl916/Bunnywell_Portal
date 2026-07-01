from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "bunnywell-portal-system-guide.md"
OUTPUT = ROOT / "docs" / "bunnywell-portal-system-guide.pdf"


def escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def inline(text: str) -> str:
    text = escape(text)
    text = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    return text


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#617169"))
    canvas.drawString(18 * mm, 12 * mm, "Bunnywell Portal System Guide")
    canvas.drawRightString(192 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_story(markdown: str):
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#24352E"),
        spaceAfter=5,
    )
    h1 = ParagraphStyle(
        "H1",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=colors.HexColor("#0F3D2E"),
        spaceAfter=10,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#0F3D2E"),
        spaceBefore=8,
        spaceAfter=6,
    )
    bullet = ParagraphStyle(
        "Bullet",
        parent=body,
        leftIndent=12,
        firstLineIndent=-8,
        bulletIndent=0,
    )
    code = ParagraphStyle(
        "Code",
        parent=body,
        fontName="Courier",
        fontSize=8,
        leading=11,
        backColor=colors.HexColor("#F7F5EF"),
        borderPadding=4,
    )

    story = []
    in_table = False
    table_rows = []

    def flush_table():
      nonlocal table_rows, in_table
      if not table_rows:
          return
      table = Table(table_rows, colWidths=[28 * mm, 100 * mm, 38 * mm])
      table.setStyle(TableStyle([
          ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F3D2E")),
          ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
          ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
          ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
          ("FONTSIZE", (0, 0), (-1, -1), 8),
          ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D9DED6")),
          ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FBFAF6")]),
          ("LEFTPADDING", (0, 0), (-1, -1), 5),
          ("RIGHTPADDING", (0, 0), (-1, -1), 5),
      ]))
      story.append(table)
      story.append(Spacer(1, 6))
      table_rows = []
      in_table = False

    lines = markdown.splitlines()
    code_block = []
    in_code = False

    for raw in lines:
        line = raw.rstrip()
        if line.startswith("```"):
            if in_code:
                story.append(Paragraph("<br/>".join(escape(item) for item in code_block), code))
                code_block = []
                in_code = False
            else:
                flush_table()
                in_code = True
            continue
        if in_code:
            code_block.append(line)
            continue

        if line.startswith("|") and line.endswith("|"):
            cells = [Paragraph(inline(cell.strip()), body) for cell in line.strip("|").split("|")]
            if all(re.fullmatch(r"-+", cell.getPlainText().strip()) for cell in cells):
                continue
            table_rows.append(cells)
            in_table = True
            continue
        elif in_table:
            flush_table()

        if not line:
            story.append(Spacer(1, 4))
            continue
        if line.startswith("# "):
            story.append(Paragraph(inline(line[2:]), h1))
            story.append(Spacer(1, 4))
            continue
        if line.startswith("## "):
            story.append(Paragraph(inline(line[3:]), h2))
            continue
        if line.startswith("- "):
            story.append(Paragraph(inline(line[2:]), bullet, bulletText="-"))
            continue
        story.append(Paragraph(inline(line), body))

    flush_table()
    return story


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    markdown = SOURCE.read_text(encoding="utf-8")
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="Bunnywell Portal System Guide",
    )
    doc.build(build_story(markdown), onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()

