from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "bunnywell-defect-workflow-manual-test-script.pdf"
LOGO = ROOT / "public" / "bunnywell-report-logo.png"

GREEN = colors.HexColor("#0F3D2E")
GOLD = colors.HexColor("#D4A645")
INK = colors.HexColor("#24342D")
MUTED = colors.HexColor("#617169")
PALE_GREEN = colors.HexColor("#F3F7F4")
PALE_GOLD = colors.HexColor("#FFF8EC")
GRID = colors.HexColor("#D9DED6")
WHITE = colors.white
RED = colors.HexColor("#B42318")

PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT = 16 * mm
RIGHT = 16 * mm
TOP = 20 * mm
BOTTOM = 17 * mm
CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="PackTitle",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=24,
    leading=28,
    textColor=GREEN,
    alignment=TA_LEFT,
    spaceAfter=7 * mm,
))
styles.add(ParagraphStyle(
    name="PackSubtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=12,
    leading=17,
    textColor=MUTED,
    spaceAfter=6 * mm,
))
styles.add(ParagraphStyle(
    name="Section",
    parent=styles["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=15,
    leading=18,
    textColor=GREEN,
    spaceBefore=3 * mm,
    spaceAfter=3 * mm,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="Subsection",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=11.5,
    leading=14,
    textColor=GREEN,
    spaceBefore=2.5 * mm,
    spaceAfter=2 * mm,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="BodyPack",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=9.5,
    leading=13,
    textColor=INK,
    spaceAfter=2.2 * mm,
))
styles.add(ParagraphStyle(
    name="Small",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=8,
    leading=10.5,
    textColor=INK,
))
styles.add(ParagraphStyle(
    name="Tiny",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=7,
    leading=8.5,
    textColor=INK,
))
styles.add(ParagraphStyle(
    name="TableHead",
    parent=styles["BodyText"],
    fontName="Helvetica-Bold",
    fontSize=7.5,
    leading=9,
    textColor=WHITE,
    alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="Callout",
    parent=styles["BodyText"],
    fontName="Helvetica-Bold",
    fontSize=9.5,
    leading=13,
    textColor=GREEN,
))


def p(text, style="BodyPack"):
    return Paragraph(text, styles[style])


def tick(text):
    return p(f"[ ]&nbsp;&nbsp;{text}", "BodyPack")


def draw_header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        if LOGO.exists():
            canvas.drawImage(str(LOGO), LEFT, PAGE_HEIGHT - 15 * mm, width=35 * mm, height=10 * mm,
                             preserveAspectRatio=True, mask="auto", anchor="sw")
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(1)
        canvas.line(LEFT, PAGE_HEIGHT - 17 * mm, PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 17 * mm)
    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(0.5)
    canvas.line(LEFT, 12 * mm, PAGE_WIDTH - RIGHT, 12 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(LEFT, 7.5 * mm, "Bunnywell Homes - Manual defect workflow test")
    canvas.drawRightString(PAGE_WIDTH - RIGHT, 7.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


class PackDoc(BaseDocTemplate):
    pass


doc = PackDoc(
    str(OUTPUT),
    pagesize=A4,
    leftMargin=LEFT,
    rightMargin=RIGHT,
    topMargin=TOP,
    bottomMargin=BOTTOM,
    title="Bunnywell Portal Manual Defect Workflow Test Script",
    author="Bunnywell Homes",
)
frame = Frame(LEFT, BOTTOM, CONTENT_WIDTH, PAGE_HEIGHT - TOP - BOTTOM, id="main")
doc.addPageTemplates(PageTemplate(id="pack", frames=[frame], onPage=draw_header_footer))


def info_table(rows, widths=None):
    widths = widths or [43 * mm, CONTENT_WIDTH - 43 * mm]
    table = Table([[p(a, "Small"), p(b, "Small")] for a, b in rows], colWidths=widths, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), PALE_GREEN),
        ("TEXTCOLOR", (0, 0), (0, -1), GREEN),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, GRID),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def step_box(number, actor, account, action, expected):
    data = [
        [p(f"STEP {number}", "TableHead"), p(f"{actor} - {account}", "TableHead")],
        [p("<b>Action</b>", "Small"), p(action, "Small")],
        [p("<b>Expected</b>", "Small"), p(expected, "Small")],
        [p("<b>Result</b>", "Small"), p("[ ] Pass&nbsp;&nbsp;&nbsp; [ ] Fail&nbsp;&nbsp;&nbsp; Issue ID: ____________________", "Small")],
    ]
    table = Table(data, colWidths=[30 * mm, CONTENT_WIDTH - 30 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("SPAN", (0, 0), (0, 0)),
        ("GRID", (0, 0), (-1, -1), 0.6, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 1), (0, -1), PALE_GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return KeepTogether([table, Spacer(1, 3 * mm)])


developer_snags = [
    ("MAN-D01", "LG01 / Entrance / Hallway", "Front door paint chip", "Decorating", "Normal close"),
    ("MAN-D02", "LG01 / Kitchen", "Socket faceplate loose", "Electrical", "Normal close"),
    ("MAN-D03", "LG01 / Bathroom", "Basin tap drips", "Plumbing", "Normal close"),
    ("MAN-D04", "LG02 / Living Room", "Skirting scuffed near window", "Decorating", "Normal close"),
    ("MAN-D05", "LG02 / Kitchen", "Extractor isolator label missing", "Electrical", "Normal close"),
    ("MAN-D06", "LG02 / Bathroom", "WC flush button sticks", "Plumbing", "Normal close"),
    ("MAN-D07", "LG03 / Entrance / Hallway", "Sealant gap at threshold", "Decorating", "Request info"),
    ("MAN-D08", "LG03 / Kitchen", "Socket location unclear", "Electrical", "Request info"),
    ("MAN-D09", "LG03 / Bathroom", "Hot water flow appears low", "Plumbing", "Request info"),
    ("MAN-D10", "LG04 / Living Room", "Ceiling mark near window", "Decorating", "Request info"),
    ("MAN-D11", "LG04 / Kitchen", "Paint finish inside cupboard", "Decorating", "Reject back"),
    ("MAN-D12", "LG04 / Bathroom", "Shaver socket not powered", "Electrical", "Reject back"),
    ("MAN-D13", "LG05 / Bathroom", "Bath panel leak stain", "Plumbing", "Reject back"),
    ("MAN-D14", "LG05 / Living Room", "Wall repair remains visible", "Decorating", "Reject back"),
    ("MAN-D15", "Car Park / Lower Ground", "Emergency light flickering", "Electrical", "Leave open"),
    ("MAN-D16", "Corridor / Lower Ground", "Wall corner damaged", "Decorating", "Leave open"),
    ("MAN-D17", "Central Stair Core / Lower Ground", "Pipe boxing loose", "Decorating first", "Change trade"),
    ("MAN-D18", "Communal Gardens / Lower Ground", "External light not operating", "No trade first", "Set trade"),
]

resident_defects = [
    ("MAN-R19", "Linked unit / Kitchen", "Water visible under sink", "Accept P1", "Resolve then close"),
    ("MAN-R20", "Linked unit / Bathroom", "Extractor fan unusually noisy", "Accept P2", "Request info"),
    ("MAN-R21", "Linked unit / Living Room", "Draught around window", "More info", "Resident responds"),
    ("MAN-R22", "Linked unit / Entrance / Hallway", "Cosmetic scratch to cupboard", "Reject", "Confirm resident view"),
    ("MAN-R23", "Linked unit / Bedroom", "Socket feels loose", "Accept P1", "Resolve then close"),
    ("MAN-R24", "Linked unit / Entrance / Hallway", "Hairline crack above door", "Accept P3", "Leave open/filter"),
]


story = []

# Cover
story += [
    Spacer(1, 10 * mm),
]
if LOGO.exists():
    from reportlab.platypus import Image
    story.append(Image(str(LOGO), width=62 * mm, height=24 * mm, kind="proportional"))
story += [
    Spacer(1, 14 * mm),
    p("MANUAL DEFECT WORKFLOW TEST", "PackTitle"),
    p("A two-person staging session for Carl and Tori", "PackSubtitle"),
    info_table([
        ("Target environment", "Staging only"),
        ("Recommended duration", "3-4 hours, preferably split into two sessions"),
        ("Dataset", "24 defects: 18 developer snags and 6 resident defects"),
        ("Primary objective", "Validate the real workflow before automated end-to-end tests are written"),
        ("Test date", "____________________________________________"),
        ("Staging URL", "____________________________________________"),
        ("App version / commit", "____________________________________________"),
    ]),
    Spacer(1, 7 * mm),
    Table([[p(
        "STOP: Do not use production. Use staging accounts and test photographs only. "
        "Every created title must retain its MAN-Dxx or MAN-Rxx prefix so the dataset can be found and removed later.",
        "Callout"
    )]], colWidths=[CONTENT_WIDTH], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_GOLD),
        ("BOX", (0, 0), (-1, -1), 1, GOLD),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ])),
    Spacer(1, 8 * mm),
    p("<b>End-of-session decision</b>", "Subsection"),
    tick("Workflow is acceptable and ready to automate."),
    tick("Minor fixes are required, then the full script must be rerun."),
    tick("A workflow decision is required before automation begins."),
    PageBreak(),
]

# How to use
story += [
    p("1. Session roles and working method", "Section"),
    p(
        "Use separate browser profiles or an incognito window so one role never inherits another role's session. "
        "Sign out between every role change. Carl acts as the Bunnywell admin/developer. Tori alternates between the "
        "resident and contractor accounts. Where possible, the person not operating the app should read the expected "
        "result aloud and record any deviation.",
    ),
    info_table([
        ("Carl - Admin account", "Creates developer snags; triages resident defects; responds to information requests; closes or rejects contractor work; checks reports and audit."),
        ("Tori - Resident account", "Creates six resident defects, supplies follow-up information, and checks resident visibility and permissions."),
        ("Tori - Contractor account", "Reviews accessible snags, changes trades where required, requests information, resolves work, and checks contractor restrictions."),
        ("Observer duty", "The non-operating tester records pass/fail, timing, confusing wording, missing confirmation and anything that required explanation."),
    ]),
    p("Accounts", "Subsection"),
    info_table([
        ("Admin email", "____________________________________________"),
        ("Contractor email", "____________________________________________"),
        ("Resident email", "____________________________________________"),
        ("Resident linked unit", "____________________________________________"),
        ("Contractor organisation", "____________________________________________"),
    ]),
    p("Working rules", "Subsection"),
    tick("Use the exact MAN-Dxx or MAN-Rxx identifier at the beginning of every title."),
    tick("Use at least six genuinely different photographs. Include portrait, landscape, close-up and low-light examples."),
    tick("Do not silently work around a confusing screen. Record the issue first, then continue if possible."),
    tick("For every status change, check both the badge and the snag Timeline/Audit entry."),
    tick("Record browser, device and screen size for any layout issue."),
    tick("If a blocking issue prevents later steps, create an issue entry and continue with another snag route."),
    PageBreak(),
]

# Preconditions
story += [
    p("2. Pre-flight checks", "Section"),
    step_box("2.1", "Carl", "Admin", "Sign in and confirm Dashboard, Admin, Users, Add snag, Snags, Resident, Reports and Audit are visible.", "All admin navigation is present and staging data loads without errors."),
    step_box("2.2", "Tori", "Contractor", "Sign in, note the visible navigation, open Snags, and record the number of visible snags before testing.", "Dashboard, Snags and Reports are visible. Admin, Users, Add snag, Resident and Audit are not visible."),
    step_box("2.3", "Tori", "Resident", "Sign in and confirm the displayed building and linked unit.", "Only the Resident area is available and only linked unit data is visible."),
    step_box("2.4", "Carl", "Admin", "Confirm the test building has LG01-LG05 or select equivalent configured units, plus Car Park, Corridor, Central Stair Core and Communal Gardens.", "Enough unit and communal locations exist to distribute the test dataset."),
    step_box("2.5", "Carl", "Admin", "Open the Snags list and confirm filters, pagination and detail navigation work before data entry begins.", "The baseline list works and no stale MAN-D/MAN-R records remain from an earlier run."),
    p("Baseline counts", "Subsection"),
    info_table([
        ("Total snags before test", "____________"),
        ("Open", "____________"),
        ("Resolved by contractor", "____________"),
        ("Closed", "____________"),
        ("Rejected back to contractor", "____________"),
    ]),
    PageBreak(),
]

# Dataset tables
story += [
    p("3. Dataset creation - developer snags", "Section"),
    p(
        "Carl creates the following 18 records from <b>Add snag</b>. Every developer snag requires a location, title "
        "and photograph. Use the suggested location where it exists; otherwise use an equivalent room or communal area "
        "and write the actual location in the margin. Include a short description on odd-numbered records and leave the "
        "description blank on even-numbered records.",
    ),
]
dev_header = [
    p("Created", "TableHead"), p("ID", "TableHead"), p("Location", "TableHead"),
    p("Title", "TableHead"), p("Trade", "TableHead"), p("Planned route", "TableHead"),
]
dev_rows = [dev_header]
for snag_id, location, title, trade, route in developer_snags:
    dev_rows.append([
        p("[ ]", "Small"), p(snag_id, "Tiny"), p(location, "Tiny"),
        p(f"{snag_id} {title}", "Tiny"), p(trade, "Tiny"), p(route, "Tiny"),
    ])
dev_table = LongTable(
    dev_rows,
    colWidths=[12 * mm, 17 * mm, 42 * mm, 53 * mm, 25 * mm, 29 * mm],
    repeatRows=1,
    hAlign="LEFT",
)
dev_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("GRID", (0, 0), (-1, -1), 0.45, GRID),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (0, 1), (0, -1), "CENTER"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREEN]),
    ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story += [dev_table, Spacer(1, 4 * mm)]
story += [
    tick("After creation, filter/search the list and confirm all 18 identifiers are present exactly once."),
    tick("Open at least three records and confirm title, location, trade, description state, photograph and creator are correct."),
    PageBreak(),
    p("4. Dataset creation - resident defects", "Section"),
    p(
        "Tori signs in as the resident and creates six records from <b>Add defect</b>. A room/area, title and photograph "
        "are required. Use the linked unit. Use different photographs from the developer snag set.",
    ),
]
res_header = [
    p("Created", "TableHead"), p("ID", "TableHead"), p("Location", "TableHead"),
    p("Title", "TableHead"), p("Admin triage", "TableHead"), p("Planned route", "TableHead"),
]
res_rows = [res_header]
for snag_id, location, title, triage, route in resident_defects:
    res_rows.append([
        p("[ ]", "Small"), p(snag_id, "Tiny"), p(location, "Tiny"),
        p(f"{snag_id} {title}", "Tiny"), p(triage, "Tiny"), p(route, "Tiny"),
    ])
res_table = Table(
    res_rows,
    colWidths=[12 * mm, 18 * mm, 42 * mm, 52 * mm, 27 * mm, 27 * mm],
    repeatRows=1,
    hAlign="LEFT",
)
res_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("GRID", (0, 0), (-1, -1), 0.45, GRID),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (0, 1), (0, -1), "CENTER"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREEN]),
    ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story += [
    res_table,
    Spacer(1, 5 * mm),
    step_box("4.1", "Tori", "Resident", "Try to submit a defect with no photograph, then with no room/area.", "Submission remains unavailable or a clear validation message explains what is missing."),
    step_box("4.2", "Tori", "Resident", "Open each submitted defect and inspect available actions.", "Resident can view their own defect, photograph, status and activity. Resident must not see admin triage controls or contractor resolve controls."),
    step_box("4.3", "Carl", "Admin", "Open Resident and confirm MAN-R19 to MAN-R24 are visible for the linked unit.", "All six defects appear once with the correct source data and initial status."),
    PageBreak(),
]

# Triage resident
story += [
    p("5. Resident-defect triage", "Section"),
    p("Carl performs the triage decisions below from the Resident defect list. Check that a reason is required for More info and Reject."),
    step_box("5.1", "Carl", "Admin", "Accept MAN-R19 as P1, MAN-R20 as P2, MAN-R23 as P1 and MAN-R24 as P3.", "Each status becomes Accepted, the selected priority is saved, and an SLA due date is calculated."),
    step_box("5.2", "Carl", "Admin", "Choose More info for MAN-R21 without entering a reason, then enter: 'Please photograph the full window frame and identify which side is draughty.'", "The empty action is blocked. After a reason is supplied, status becomes Needs more info and the reason appears in activity."),
    step_box("5.3", "Carl", "Admin", "Reject MAN-R22 without entering a reason, then enter: 'Cosmetic mark is within the agreed finish tolerance.'", "The empty action is blocked. After a reason is supplied, status becomes Rejected and the reason is recorded."),
    step_box("5.4", "Tori", "Resident", "Review all six defects. For MAN-R21, add a note and an additional photograph responding to the request.", "Resident sees current status and reasons. The note/photo is attributed to the resident and visible to Carl. No admin-only controls are exposed."),
    step_box("5.5", "Carl", "Admin", "Review MAN-R21's new note/photo and decide whether the current UI provides a clear route to accept/reopen it.", "The next action is obvious and produces a valid status transition. If not, record a workflow issue rather than inventing a workaround."),
    PageBreak(),
]

# Contractor normal
story += [
    p("6. Contractor processing - normal completion", "Section"),
    step_box("6.1", "Tori", "Contractor", "Open Snags and confirm MAN-D01 to MAN-D18 plus accepted resident defects are visible as permitted by contractor access.", "Only records within the contractor's permitted building/organisation scope are visible."),
    step_box("6.2", "Tori", "Contractor", "Resolve MAN-D01 to MAN-D06, MAN-R19 and MAN-R23. Add a completion note to at least two and a resolution photograph to at least three before resolving.", "Each becomes Resolved by contractor. Notes/photos are retained and attributed to Tori's contractor account."),
    step_box("6.3", "Tori", "Contractor", "Attempt to resolve one record twice and attempt to alter a closed/non-actionable record if one is visible.", "Duplicate or invalid actions are unavailable and no duplicate status events are created."),
    step_box("6.4", "Carl", "Admin", "Open each resolved record, review evidence, and Close MAN-D01 to MAN-D06, MAN-R19 and MAN-R23.", "Each becomes Closed, closed date is populated, and the full created -> resolved -> closed sequence appears in Timeline/Audit."),
    p("Normal-route reconciliation", "Subsection"),
    info_table([
        ("Expected newly closed", "8"),
        ("Actual newly closed", "____________"),
        ("Issues raised", "____________________________________________"),
    ]),
    PageBreak(),
]

# Info requests
story += [
    p("7. Contractor information requests", "Section"),
    step_box("7.1", "Tori", "Contractor", "For MAN-D07 to MAN-D10, select Request info. Use a different request on each, including measurements, a wider photo, exact location and confirmation of when the issue occurs.", "Each becomes Needs more info and the request text appears in the activity history."),
    step_box("7.2", "Tori", "Contractor", "Try to send an empty information request.", "The action is disabled or blocked until text is entered."),
    step_box("7.3", "Carl", "Admin", "Open MAN-D07 to MAN-D10, enter an appropriate response in Information for contractor, and select Send info.", "Each returns to Open and the response appears in activity with Carl as author."),
    step_box("7.4", "Tori", "Contractor", "Confirm the four records have returned to the actionable list, read Carl's response, then Resolve all four.", "All four become Resolved by contractor without losing the earlier request/response history."),
    step_box("7.5", "Carl", "Admin", "Close MAN-D07 to MAN-D10 after checking the timeline.", "All four become Closed and retain the entire information-request sequence."),
    p("Information-route reconciliation", "Subsection"),
    info_table([
        ("Expected newly closed", "4"),
        ("Expected remaining Needs more info", "MAN-R20 plus any intentionally unresolved resident route"),
        ("Actual", "____________________________________________"),
    ]),
    PageBreak(),
]

# Reject back
story += [
    p("8. Rejected-back-to-contractor loop", "Section"),
    step_box("8.1", "Tori", "Contractor", "Resolve MAN-D11 to MAN-D14. Add a resolution photo to MAN-D11 and MAN-D13.", "All four become Resolved by contractor."),
    step_box("8.2", "Carl", "Admin", "For each record select Reject back to contractor. Enter a specific reason. Add an annotated rejection photo to at least two.", "Each becomes Rejected back to contractor. Reason and optional photo are visible in activity."),
    step_box("8.3", "Tori", "Contractor", "Open all four rejected records, verify the rejection evidence is visible, add a rework note/photo, then Resolve again.", "Each returns to Resolved by contractor with both resolution attempts preserved."),
    step_box("8.4", "Carl", "Admin", "Close MAN-D11 to MAN-D14 after confirming the rework evidence.", "All four become Closed. Timeline order clearly shows first resolution, rejection, rework resolution and close."),
    p("Rejected-route reconciliation", "Subsection"),
    info_table([
        ("Expected newly closed", "4"),
        ("Expected rejection cycles", "4"),
        ("Actual", "____________________________________________"),
    ]),
    PageBreak(),
]

# Trade/open
story += [
    p("9. Trade changes, open work and filters", "Section"),
    step_box("9.1", "Tori", "Contractor", "Open MAN-D17, change the trade from Decorating to Plumbing, and inspect activity.", "Trade updates immediately and an activity event records old and new values."),
    step_box("9.2", "Tori", "Contractor", "Open MAN-D18, set its blank trade to Electrical, and inspect activity.", "Trade is saved and the change is recorded."),
    step_box("9.3", "Tori", "Contractor", "Leave MAN-D15, MAN-D16, MAN-D17, MAN-D18 and MAN-R24 unresolved. Request info on MAN-R20.", "The open dataset remains available for filtering; MAN-R20 becomes Needs more info."),
    step_box("9.4", "Carl", "Admin", "Use building, unit, trade, status, quick filters and pagination. Locate each remaining record using at least two different filter combinations.", "Counts, rows and page totals remain consistent; clearing filters restores the full list."),
    step_box("9.5", "Carl", "Admin", "Check Dashboard counts and cards against the final status reconciliation below.", "Dashboard figures agree with the snag list and link to the expected filtered records."),
    p("Expected end state for the 24-record dataset", "Subsection"),
]
end_state_rows = [
    [p("Status", "TableHead"), p("Expected records", "TableHead"), p("Count", "TableHead"), p("Actual", "TableHead")],
    [p("Closed", "Small"), p("MAN-D01-D14, MAN-R19, MAN-R23", "Small"), p("16", "Small"), p("______", "Small")],
    [p("Open / Accepted / actionable", "Small"), p("MAN-D15-D18, MAN-R24; MAN-R21 depending on agreed follow-up route", "Small"), p("5-6", "Small"), p("______", "Small")],
    [p("Needs more info", "Small"), p("MAN-R20; possibly MAN-R21 until answered/accepted", "Small"), p("1-2", "Small"), p("______", "Small")],
    [p("Rejected", "Small"), p("MAN-R22", "Small"), p("1", "Small"), p("______", "Small")],
    [p("Rejected back to contractor", "Small"), p("None remaining", "Small"), p("0", "Small"), p("______", "Small")],
]
end_table = Table(end_state_rows, colWidths=[38 * mm, 92 * mm, 20 * mm, 28 * mm], hAlign="LEFT")
end_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("GRID", (0, 0), (-1, -1), 0.5, GRID),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREEN]),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story += [end_table, PageBreak()]

# Permissions and reporting
story += [
    p("10. Permissions, audit and reporting", "Section"),
    step_box("10.1", "Tori", "Resident", "Try to navigate directly to admin/snags/report routes using known URLs or browser history.", "Resident remains within permitted resident functionality and cannot access another role's data/actions."),
    step_box("10.2", "Tori", "Resident", "Review the linked unit's defect list and filters.", "Only linked-unit records are visible. Contractor-only and admin-only actions are absent."),
    step_box("10.3", "Tori", "Contractor", "Search for data from a building/unit outside contractor access, if staging contains one.", "Unauthorised data cannot be found through lists, filters, detail URLs or reports."),
    step_box("10.4", "Carl", "Admin", "Open Audit and search recent events for report generation and key setup actions. Then inspect snag-level Timeline, Notes, Photos and Audit tabs.", "Events show the correct actor, time, status, comments and photo additions without unexplained duplicates."),
    step_box("10.5", "Carl", "Admin", "Generate a PDF snag report for a unit containing at least five of the test records.", "The report downloads, identifies the correct building/unit, includes correct snag data and fits five compact snag panels on a page without clipping."),
    step_box("10.6", "Tori", "Contractor", "Generate an available report and compare its content with contractor permissions.", "Report content is limited to data the contractor is allowed to access."),
    p("Cross-browser/device spot check", "Subsection"),
    tick("Repeat one create, one request-info, one resolve and one close action on a phone-sized viewport."),
    tick("Check long titles, long status labels and portrait photographs for overlap or clipping."),
    tick("Check keyboard focus, button labels and confirmation/notice messages during one complete route."),
    PageBreak(),
]

# Experience review
story += [
    p("11. Workflow experience review", "Section"),
    p("Complete this section together immediately after the operational test while the handoffs are fresh."),
]
review_prompts = [
    ("Creating defects", "Was it fast to create repeated snags? Did Save and add another preserve the right fields?"),
    ("Finding work", "Could each role immediately tell what required action? Were filters and counts trustworthy?"),
    ("Information requests", "Was the question/answer loop obvious to both parties? Was the next action clear?"),
    ("Evidence", "Were notes, original photos, resolution photos and rejection photos easy to distinguish?"),
    ("Status language", "Did Open, Accepted, Needs more info, Resolved by contractor, Rejected back and Closed mean what both testers expected?"),
    ("Resident workflow", "Could the resident understand triage decisions and respond without seeing privileged controls?"),
    ("Notifications", "Were save confirmations and errors visible, specific and persistent long enough?"),
    ("Handoffs", "Did either tester need to message the other outside the portal to explain what happened?"),
    ("Reporting", "Did the PDF provide a useful site/reporting record without manual correction?"),
    ("Speed", "Did lists, photos, filters or navigation become noticeably slower with 24 additional records?"),
]
review_data = [[p("Area", "TableHead"), p("Discussion prompt", "TableHead"), p("Rating 1-5", "TableHead"), p("Issue IDs", "TableHead")]]
for area, prompt in review_prompts:
    review_data.append([p(area, "Small"), p(prompt, "Small"), p("____", "Small"), p("____________", "Small")])
review_table = LongTable(review_data, colWidths=[34 * mm, 100 * mm, 22 * mm, 22 * mm], repeatRows=1)
review_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
    ("GRID", (0, 0), (-1, -1), 0.5, GRID),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREEN]),
    ("ALIGN", (2, 1), (2, -1), "CENTER"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story += [
    review_table,
    Spacer(1, 5 * mm),
    p("<b>Top three changes before automation</b>", "Subsection"),
    p("1. __________________________________________________________________________________________"),
    p("2. __________________________________________________________________________________________"),
    p("3. __________________________________________________________________________________________"),
    PageBreak(),
]

# Issue log
story += [
    p("12. Issue log", "Section"),
    p(
        "Use one row for every functional defect, permission problem, confusing interaction or requested feature change. "
        "Severity: S1 blocker/data/security; S2 major workflow failure; S3 minor defect; S4 usability/polish.",
    ),
]
issue_header = [
    p("ID", "TableHead"), p("Step / snag", "TableHead"), p("Role", "TableHead"),
    p("Expected vs actual", "TableHead"), p("Severity", "TableHead"), p("Owner / notes", "TableHead"),
]
issue_rows = [issue_header]
for i in range(1, 13):
    issue_rows.append([
        p(f"ISS-{i:02d}", "Tiny"), p("", "Tiny"), p("", "Tiny"), p("", "Tiny"), p("", "Tiny"), p("", "Tiny")
    ])
issue_table = LongTable(
    issue_rows,
    colWidths=[16 * mm, 27 * mm, 22 * mm, 70 * mm, 18 * mm, 25 * mm],
    rowHeights=[None] + [17 * mm] * 12,
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
story += [issue_table, PageBreak()]

# Signoff
story += [
    p("13. Session sign-off and next actions", "Section"),
    info_table([
        ("Tests completed", "____________ / planned steps"),
        ("Passes", "____________"),
        ("Failures", "____________"),
        ("S1 / S2 issues", "____________"),
        ("S3 / S4 issues", "____________"),
        ("Feature changes proposed", "____________"),
    ]),
    Spacer(1, 5 * mm),
    p("Readiness decision", "Subsection"),
    tick("READY - workflow is agreed; begin automated E2E test implementation."),
    tick("CONDITIONAL - implement listed fixes, then rerun affected sections."),
    tick("NOT READY - workflow or permissions need redesign before automation."),
    Spacer(1, 5 * mm),
    p("Agreed automated regression candidates", "Subsection"),
    tick("Developer snag: create -> contractor resolve -> developer close."),
    tick("Contractor request info -> developer response -> contractor resolve -> close."),
    tick("Resolve -> reject back -> resolve again -> close."),
    tick("Resident submit -> admin triage -> contractor action -> resident visibility."),
    tick("Role-based visibility and blocked direct navigation."),
    tick("Trade changes, activity history, filters, counts and PDF report."),
    Spacer(1, 8 * mm),
    info_table([
        ("Carl signature", "____________________________________    Date: ______________"),
        ("Tori signature", "____________________________________    Date: ______________"),
        ("Retest required by", "____________________________________________"),
        ("Automation can begin after", "____________________________________________"),
    ]),
    Spacer(1, 10 * mm),
    Table([[p(
        "Cleanup note: retain the MAN-Dxx and MAN-Rxx records until issues are reproduced and fixed. "
        "Once the session is signed off, remove only this manual dataset or reset/reimport staging as agreed.",
        "Callout"
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
