"""
Creates a minimal test xlsx for the container import script.

Usage:
    python3 scripts/create-test-sheet.py

Then:
  1. Upload to Google Sheets (Drive → New → File upload, or open sheets.google.com → File → Import)
  2. Share as "Anyone with the link can view"
  3. Replace REPLACE-SKU-1 / REPLACE-SKU-2 in column L with real master_skus
     from your fc_products table before running the import
  4. Paste the share URL into the Container Import admin page

Layout:
  Row 3  — headers: CBM label (col B), SKU label (col L),
            container names (cols M and S), ETA dates (cols R and X)
  Row 4+ — data: master_sku in col L, cbm in col B, qty in container cols
"""

import zipfile
import datetime
import os

# ── Column helpers ─────────────────────────────────────────────────────────────

def col_letter(n: int) -> str:
    result = ""
    while n:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result

def cell_ref(col: int, row: int) -> str:
    return f"{col_letter(col)}{row}"

# ── Sheet layout ───────────────────────────────────────────────────────────────

CONTAINER_1 = "99-TEST-1"
CONTAINER_2 = "99-TEST-2"

COL_CBM  = 2   # B
COL_SKU  = 12  # L
COL_C1   = 13  # M — container 1
COL_ETA1 = 18  # R — ETA for container 1 (col_c1 + 5)
COL_C2   = 19  # S — container 2
COL_ETA2 = 24  # X — ETA for container 2 (col_c2 + 5)

ETA_DATE   = datetime.date(2026, 10, 1)
ETA_SERIAL = (ETA_DATE - datetime.date(1899, 12, 30)).days

SKU_ROWS = [
    {"sku": "REPLACE-SKU-1", "cbm": 0.50, "c1": 10, "c2": 5},
    {"sku": "REPLACE-SKU-2", "cbm": 0.35, "c1": 8,  "c2": 0},
]

# ── Shared strings ─────────────────────────────────────────────────────────────

STRINGS = [
    "Container Import Test",
    "CBM/unit",
    "Master SKU",
    CONTAINER_1,
    CONTAINER_2,
] + [r["sku"] for r in SKU_ROWS]

STR_IDX = {s: i for i, s in enumerate(STRINGS)}

def sst_xml() -> str:
    items = "".join(f"<si><t>{s}</t></si>" for s in STRINGS)
    n = len(STRINGS)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        f' count="{n}" uniqueCount="{n}">{items}</sst>'
    )

# ── Cell helpers — return (col_index, xml) so rows can sort before emitting ───

def str_cell(col: int, row: int, s: str):
    return (col, f'<c r="{cell_ref(col, row)}" t="s"><v>{STR_IDX[s]}</v></c>')

def num_cell(col: int, row: int, v):
    return (col, f'<c r="{cell_ref(col, row)}"><v>{v}</v></c>')

def make_row(rnum: int, cells: list) -> str:
    # xlsx requires cells to be in ascending column order within a row;
    # violating this causes Google Sheets to silently shift cells right.
    ordered = sorted(cells, key=lambda x: x[0])
    return f'<row r="{rnum}">{"".join(xml for _, xml in ordered)}</row>'

# ── Build sheet rows ───────────────────────────────────────────────────────────

rows = []

rows.append(make_row(1, [str_cell(1, 1, "Container Import Test")]))

rows.append(make_row(3, [
    str_cell(COL_CBM,  3, "CBM/unit"),
    str_cell(COL_SKU,  3, "Master SKU"),
    str_cell(COL_C1,   3, CONTAINER_1),
    num_cell(COL_ETA1, 3, ETA_SERIAL),
    str_cell(COL_C2,   3, CONTAINER_2),
    num_cell(COL_ETA2, 3, ETA_SERIAL),
]))

for i, r in enumerate(SKU_ROWS, start=4):
    cells = [
        num_cell(COL_CBM, i, r["cbm"]),
        str_cell(COL_SKU, i, r["sku"]),
    ]
    if r["c1"]:
        cells.append(num_cell(COL_C1, i, r["c1"]))
    if r["c2"]:
        cells.append(num_cell(COL_C2, i, r["c2"]))
    rows.append(make_row(i, cells))

SHEET_XML = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    "<sheetData>"
    + "".join(rows)
    + "</sheetData></worksheet>"
)

# ── Static xlsx boilerplate ────────────────────────────────────────────────────

CONTENT_TYPES = """\
<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"""

RELS = """\
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="xl/workbook.xml"/>
</Relationships>"""

WB_RELS = """\
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
    Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"
    Target="sharedStrings.xml"/>
  <Relationship Id="rId3"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
</Relationships>"""

WORKBOOK = """\
<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="L- Test" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"""

STYLES = """\
<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts><font><sz val="11"/></font></fonts>
  <fills>
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>"""

# ── Write xlsx ─────────────────────────────────────────────────────────────────

out = os.path.join(os.path.dirname(__file__), "test-container-sheet.xlsx")

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("[Content_Types].xml",        CONTENT_TYPES)
    zf.writestr("_rels/.rels",                RELS)
    zf.writestr("xl/workbook.xml",            WORKBOOK)
    zf.writestr("xl/_rels/workbook.xml.rels", WB_RELS)
    zf.writestr("xl/worksheets/sheet1.xml",   SHEET_XML)
    zf.writestr("xl/sharedStrings.xml",       sst_xml())
    zf.writestr("xl/styles.xml",              STYLES)

print(f"Created: {out}")
print()
print(f"  Tab      : 'L- Test'")
print(f"  Col B    : CBM/unit (0.50 and 0.35)")
print(f"  Col L    : Master SKU (replace placeholders with real SKUs)")
print(f"  Col M    : {CONTAINER_1} quantities (10 and 8)")
print(f"  Col R    : ETA for {CONTAINER_1} ({ETA_DATE}, serial {ETA_SERIAL})")
print(f"  Col S    : {CONTAINER_2} quantities (5)")
print(f"  Col X    : ETA for {CONTAINER_2} ({ETA_DATE}, serial {ETA_SERIAL})")
print()
print("Next steps:")
print("  1. Upload to Google Sheets → File → Import")
print("  2. Replace REPLACE-SKU-1 / REPLACE-SKU-2 in col L with real master_skus")
print("  3. Share as 'Anyone with the link can view' → copy link")
print("  4. Paste into Container Import admin page, dry run first")
