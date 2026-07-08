from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "bunnywell-defect-workflow-test-field-guide.pdf"
LOGO = ROOT / "public" / "bunnywell-report-logo.png"

GREEN = colors.HexColor("#0F3D2E")
GOLD = colors.HexColor("#D4A645")
INK = colors.HexColor("#24342D")
MUTED = colors.HexColor("#617169")
PALE_GREEN = colors.HexColor("#F3F7F4")
PALE_GOLD = colors.HexColor("#FFF8EC")
GRID = colors.HexColor("#D9DED6")
WHITE = colors.white

PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT = RIGHT = 16 * mm
TOP = 20 * mm
BOTTOM = 17 * mm
CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="TitleFG", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=23, leading=27, textColor=GREEN, spaceAfter=5 * mm,
))
styles.add(ParagraphStyle(
    name="SubtitleFG", parent=styles["Normal"], fontName="Helvetica",
    fontSize=11.5, leading=16, textColor=MUTED, spaceAfter=5 * mm,
))
styles.add(ParagraphStyle(
    name="SectionFG", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=15, leading=18, textColor=GREEN, spaceBefore=3 * mm,
    spaceAfter=3 * mm, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="SubFG", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=11.5, leading=14, textColor=GREEN, spaceBefore=2 * mm,
    spaceAfter=1.5 * mm, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="BodyFG", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.5, leading=13, textColor=INK, spaceAfter=2.2 * mm,
))
styles.add(ParagraphStyle(
    name="SmallFG", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8, leading=10.5, textColor=INK,
))
styles.add(ParagraphStyle(
    name="HeadFG", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=8, leading=10, textColor=WHITE,
))
styles.add(ParagraphStyle(
    name="CalloutFG", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=9.5, leading=13, textColor=GREEN,
))


def p(text, style="BodyFG"):
    return Paragraph(text, styles[style])


def check(text):
    return p(f"[ ]&nbsp;&nbsp;{text}")


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        if LOGO.exists():
            canvas.drawImage(str(LOGO), LEFT, PAGE_HEIGHT - 15 * mm, width=35 * mm,
                             height=10 * mm, preserveAspectRatio=True, mask="auto")
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(1)
        canvas.line(LEFT, PAGE_HEIGHT - 17 * mm, PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 17 * mm)
    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(0.5)
    canvas.line(LEFT, 12 * mm, PAGE_WIDTH - RIGHT, 12 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(LEFT, 7.5 * mm, "Bunnywell Homes - Defect workflow field guide")
    canvas.drawRightString(PAGE_WIDTH - RIGHT, 7.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def key_value(rows):
    table = Table(
        [[p(a, "SmallFG"), p(b, "SmallFG")] for a, b in rows],
        colWidths=[42 * mm, CONTENT_WIDTH - 42 * mm],
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), PALE_GREEN),
        ("GRID", (0, 0), (-1, -1), 0.5, GRID),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


doc = BaseDocTemplate(
    str(OUTPUT), pagesize=A4, leftMargin=LEFT, rightMargin=RIGHT,
    topMargin=TOP, bottomMargin=BOTTOM,
    title="Bunnywell Defect Workflow Test Field Guide",
    author="Bunnywell Homes",
)
doc.addPageTemplates(PageTemplate(
    id="guide",
    frames=[Frame(LEFT, BOTTOM, CONTENT_WIDTH, PAGE_HEIGHT - TOP - BOTTOM, id="main")],
    onPage=header_footer,
))

story = []

# Page 1
if LOGO.exists():
    story += [Spacer(1, 8 * mm), Image(str(LOGO), width=60 * mm, height=23 * mm, kind="proportional")]
story += [
    Spacer(1, 10 * mm),
    p("DEFECT WORKFLOW TEST FIELD GUIDE", "TitleFG"),
    p(
        "A flexible staging guide for Carl and Tori. Find and record genuine defects around the house, "
        "then deliberately put selected records through different workflow routes.",
        "SubtitleFG",
    ),
    key_value([
        ("Environment", "Staging only"),
        ("Suggested dataset", "Approximately 20-30 real-world snags"),
        ("Carl", "Admin/developer role"),
        ("Tori", "Resident and contractor roles"),
        ("Main goal", "Discover workflow, permission and usability changes before automated E2E tests are written"),
        ("Test date", "____________________________________________"),
    ]),
    Spacer(1, 6 * mm),
    Table([[p(
        "Do not try to make every snag follow the same route. The value of this exercise comes from keeping "
        "some open, requesting information on some, resolving and closing some, and rejecting some work back.",
        "CalloutFG",
    )]], colWidths=[CONTENT_WIDTH], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_GOLD),
        ("BOX", (0, 0), (-1, -1), 1, GOLD),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ])),
    p("How to use this guide", "SectionFG"),
    check("Walk the property and create defects based on what you actually find."),
    check("Give each title a simple reference such as TEST-01, TEST-02 and so on."),
    check("Use varied rooms, communal areas, trades, descriptions and photographs."),
    check("After creating the dataset, choose records to cover each workflow route on pages 2-3."),
    check("When something feels unclear, slow or awkward, log it. Usability observations count as findings."),
    check("Use separate browser profiles and sign out whenever changing role."),
    p("Before starting", "SubFG"),
    check("Confirm the resident account is linked only to the intended unit."),
    check("Confirm the contractor has the intended organisation/building access."),
    check("Record the starting dashboard and snag counts."),
    check("Confirm no old TEST-xx records will be confused with this session."),
    PageBreak(),
]

# Page 2
coverage = [
    ("Location", "Several rooms; at least one communal/external area; more than one unit if available."),
    ("Trades", "Decorating, electrical, plumbing and at least one changed or initially blank trade."),
    ("Photographs", "Portrait, landscape, close-up, wider context, low light and an additional update photo."),
    ("Descriptions", "Some detailed, some brief and at least one intentionally blank."),
    ("Priority", "Resident defects triaged across P1, P2 and P3."),
    ("Status mix", "Leave some actionable while progressing others to Needs more info, Resolved and Closed."),
    ("Evidence", "Add notes, completion photos and rejection/annotated photos to selected records."),
    ("Volume", "Enough records to exercise filters, pagination, dashboard counts and a multi-page PDF report."),
]
coverage_rows = [[p("Coverage area", "HeadFG"), p("Aim", "HeadFG"), p("Done", "HeadFG")]]
for area, aim in coverage:
    coverage_rows.append([p(area, "SmallFG"), p(aim, "SmallFG"), p("[ ]", "SmallFG")])
coverage_table = Table(
    coverage_rows,
    colWidths=[35 * mm, 128 * mm, 15 * mm],
    repeatRows=1,
)
coverage_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("GRID", (0, 0), (-1, -1), 0.5, GRID),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREEN]),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (2, 1), (2, -1), "CENTER"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))

story += [
    p("1. Build a realistic dataset", "SectionFG"),
    p(
        "Do not invent a prescribed list. Walk through the property, photograph genuine issues and discuss how each "
        "would normally be described. Use this matrix only to prevent the dataset becoming too repetitive.",
    ),
    coverage_table,
    p("Creation and validation checks", "SubFG"),
    check("Developer creates multiple unit and communal snags using Save and add another."),
    check("Resident creates several defects for their linked unit."),
    check("Required fields behave clearly when location, title or photograph is missing."),
    check("Created records appear once, with the right unit/area, trade, description, photograph and creator."),
    check("Repeated entry remains practical and does not retain the wrong previous values."),
    check("Lists and photos still load comfortably after the larger dataset is present."),
    p("Useful questions while entering data", "SubFG"),
    check("Would a site inspector understand what information is expected in each field?"),
    check("Is it obvious what was preserved after Save and add another?"),
    check("Can two similar defects still be distinguished later?"),
    check("Is the photograph workflow workable on a phone?"),
    PageBreak(),
]

# Page 3
flows = [
    ("Standard completion", "Developer/admin", "Create or review an open snag.", "Contractor", "Add evidence and Resolve.", "Developer/admin", "Review and Close."),
    ("Information request", "Contractor", "Request info with a specific question.", "Developer/admin", "Send info.", "Contractor", "Resolve after response."),
    ("Failed repair/rework", "Contractor", "Resolve with evidence.", "Developer/admin", "Reject back with reason/photo.", "Contractor", "Add rework evidence and Resolve again."),
    ("Resident accepted defect", "Resident", "Submit defect.", "Admin", "Accept and choose P1/P2/P3.", "Contractor/admin", "Progress it and confirm resident visibility."),
    ("Resident more information", "Resident", "Submit defect.", "Admin", "Choose More info with a reason.", "Resident/admin", "Check whether the response and next action are obvious."),
    ("Resident rejection", "Resident", "Submit defect.", "Admin", "Reject with a reason.", "Resident", "Confirm decision and reason are understandable."),
    ("Trade correction", "Developer/admin", "Create with wrong or blank trade.", "Contractor", "Change/set trade.", "Both", "Confirm activity records old/new trade."),
    ("Remain open", "Any creator", "Create a valid snag.", "Contractor", "Do not resolve it.", "Admin", "Confirm open filters/counts remain accurate."),
]
flow_rows = [[
    p("Route", "HeadFG"), p("First actor/action", "HeadFG"), p("Handoff", "HeadFG"),
    p("Final check", "HeadFG"), p("Done", "HeadFG"),
]]
for route, a1, action1, a2, action2, a3, action3 in flows:
    flow_rows.append([
        p(route, "SmallFG"),
        p(f"<b>{a1}:</b> {action1}", "SmallFG"),
        p(f"<b>{a2}:</b> {action2}", "SmallFG"),
        p(f"<b>{a3}:</b> {action3}", "SmallFG"),
        p("[ ]", "SmallFG"),
    ])
flow_table = LongTable(
    flow_rows,
    colWidths=[31 * mm, 45 * mm, 45 * mm, 45 * mm, 12 * mm],
    repeatRows=1,
)
flow_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("GRID", (0, 0), (-1, -1), 0.5, GRID),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREEN]),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("ALIGN", (4, 1), (4, -1), "CENTER"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))

story += [
    p("2. Workflow routes to cover", "SectionFG"),
    p(
        "Choose suitable real defects from your dataset for each route. One record can cover more than one point, "
        "but preserve enough records in different statuses to test lists, filters and reporting.",
    ),
    flow_table,
    p("At every handoff, check", "SubFG"),
    check("The new status badge is correct."),
    check("The record appears in the next user's expected list/filter."),
    check("The action, reason, note or photograph appears in Timeline/Notes/Photos/Audit."),
    check("The actor name and time are correct."),
    check("No information or previous evidence disappears."),
    check("The next user can immediately understand what they are expected to do."),
    PageBreak(),
]

# Page 4
permission_checks = [
    ("Resident", "Only linked units and own defect information are visible; no contractor/admin actions."),
    ("Contractor", "Only permitted building/organisation records are visible; no setup/user/admin controls."),
    ("Admin", "All intended buildings and workflow actions are available."),
    ("Direct navigation", "Using history or a known URL does not expose another role's page or data."),
    ("Invalid actions", "Closed/resolved/non-actionable records do not offer inappropriate actions."),
]
perm_rows = [[p("Check", "HeadFG"), p("Expected", "HeadFG"), p("Pass", "HeadFG"), p("Issue", "HeadFG")]]
for role, expected in permission_checks:
    perm_rows.append([p(role, "SmallFG"), p(expected, "SmallFG"), p("[ ]", "SmallFG"), p("________", "SmallFG")])
perm_table = Table(perm_rows, colWidths=[34 * mm, 110 * mm, 16 * mm, 18 * mm])
perm_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("GRID", (0, 0), (-1, -1), 0.5, GRID),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREEN]),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (2, 1), (-1, -1), "CENTER"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))

story += [
    p("3. Permissions and supporting features", "SectionFG"),
    perm_table,
    p("Lists, dashboard and reporting", "SubFG"),
    check("Use building, unit, status, trade, priority and quick filters in different combinations."),
    check("Confirm clearing filters restores the expected list and pagination/counts remain consistent."),
    check("Compare dashboard totals/cards with the underlying snag list."),
    check("Generate a PDF for a unit with enough defects to span pages."),
    check("Check titles, status, room, trade, dates and photographs in the PDF."),
    check("Confirm five compact snag panels fit when the content allows, without clipping."),
    check("Check contractor reports do not expose inaccessible data."),
    p("Usability and resilience", "SubFG"),
    check("Repeat key actions on a phone-sized screen."),
    check("Test long titles/descriptions and portrait/landscape photographs."),
    check("Observe loading, duplicate clicks, confirmations and error messages."),
    check("Check Previous/Next navigation through snag details."),
    check("Consider whether notes, original photos, resolution photos and rejection photos are easy to distinguish."),
    p("Questions to discuss together", "SubFG"),
    check("Could each role tell what needed attention without being briefed outside the app?"),
    check("Did any status label or action mean something different to each of you?"),
    check("Did either of you need to message the other to explain an in-app handoff?"),
    check("Which repeated actions felt slower or more awkward than they should?"),
    check("What should be fixed before the workflow is encoded in automated tests?"),
    PageBreak(),
]

# Page 5
issue_rows = [[
    p("ID", "HeadFG"), p("Snag / role / flow", "HeadFG"), p("What happened", "HeadFG"),
    p("Severity", "HeadFG"), p("Decision / owner", "HeadFG"),
]]
for i in range(1, 9):
    issue_rows.append([
        p(f"ISS-{i:02d}", "SmallFG"), p("", "SmallFG"), p("", "SmallFG"),
        p("", "SmallFG"), p("", "SmallFG"),
    ])
issue_table = LongTable(
    issue_rows,
    colWidths=[17 * mm, 40 * mm, 68 * mm, 21 * mm, 32 * mm],
    rowHeights=[None] + [13.5 * mm] * 8,
    repeatRows=1,
)
issue_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("GRID", (0, 0), (-1, -1), 0.55, GRID),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story += [
    p("4. Findings and sign-off", "SectionFG"),
    p(
        "Log functional defects, permission problems, confusing interactions and feature ideas. "
        "Suggested severity: S1 blocker/security/data; S2 major workflow problem; S3 minor defect; S4 usability/polish.",
    ),
    issue_table,
    Spacer(1, 5 * mm),
    key_value([
        ("Dataset created", "____________ snags"),
        ("Workflow routes covered", "____________ / 8"),
        ("S1 / S2 findings", "____________"),
        ("S3 / S4 findings", "____________"),
        ("Top change before automation", "____________________________________________"),
        ("Retest required", "[ ] Yes    [ ] No"),
        ("Ready to automate", "[ ] Yes    [ ] After fixes    [ ] Workflow decision needed"),
        ("Carl / date", "____________________________________________"),
        ("Tori / date", "____________________________________________"),
    ]),
    Spacer(1, 5 * mm),
    Table([[p(
        "Keep the staging dataset until findings have been reproduced and agreed. Once the workflow is stable, "
        "use the completed coverage matrix to decide the automated E2E suite.",
        "CalloutFG",
    )]], colWidths=[CONTENT_WIDTH], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_GREEN),
        ("BOX", (0, 0), (-1, -1), 1, GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ])),
]

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc.build(story)
print(OUTPUT)
