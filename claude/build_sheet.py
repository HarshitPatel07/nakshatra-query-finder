"""
build_sheet.py — turn transcribed register tables into the firm's Query Sheet.

This is the half that must not guess. The reading step hands over what is
actually written in each cell; everything after that is arithmetic:

    a cell is empty  ->  that row is at fault
    which row        ->  the name written on it
    same document, same field, different people   ->  one query, names joined
    same document, same field, different months   ->  one query, months joined

Asking a model to do that was the whole problem. On MS Chandan it produced
0 of the 14 queries that name a person, because a signature column that is
six-eighths filled reads as "filled" to anything that glances at it, while
rows.filter() has no opinion and no attention to run out of.

    python build_sheet.py tables.json -o "MS Chandan - Query sheet.xlsx"
"""

import argparse, json, os, re, sys

RULES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    'rules.json'), encoding='utf-8'))

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

HEADER_ROWS = [
    ('Date', 'date'), ('Name of the agency', 'agency'),
    ('Address of the agency and location', 'address'),
    ('Full name of the person who is signing', 'signedBy'),
    ('Designation in the agency', 'designation'),
    ('Signature and stamp', 'stamp'),
    ('Auditor full name', 'auditor'), ('Signature', 'auditorSign'),
    ('Auditor Employee No.', 'auditorNo'),
    ('Collection Manager Name', 'cmNames'),
    ('Collection Manager ID', 'cmIds'),
    ('Nakshatra Barcode Number', 'barcode'),
    ('Signature', 'agencySign'),
]

# what counts as an empty cell in a transcription
BLANK = {'', '-', '--', 'blank', 'empty', 'nil', 'na', 'n/a', 'none', 'not filled'}


def is_blank(v):
    return str(v or '').strip().lower() in BLANK


def month_order(m):
    g = re.match(r"([A-Za-z]{3})'?(\d{2})", str(m or '').strip())
    if not g:
        return 10 ** 6
    return int(g.group(2)) * 12 + MONTHS.index(g.group(1).title())


def join_months(months):
    """Apr'26 & May'26 for two, Apr'26 to Jun'26 for a run of three or more."""
    seen = sorted({m for m in months if m}, key=month_order)
    if not seen:
        return ''
    if len(seen) == 1:
        return seen[0]
    run = all(month_order(seen[i + 1]) - month_order(seen[i]) == 1
              for i in range(len(seen) - 1))
    if len(seen) >= 3 and run:
        return f'{seen[0]} to {seen[-1]}'
    return ', '.join(seen[:-1]) + ' & ' + seen[-1]


def join_names(names):
    seen = []
    for n in names:
        n = str(n or '').strip()
        if n and n not in seen:
            seen.append(n)
    if not seen:
        return ''
    if len(seen) == 1:
        return seen[0]
    return ', '.join(seen[:-1]) + ' & ' + seen[-1]


def phrase(doc, fields, names, months, wrong=False):
    """One observation, worded the way the firm words it."""
    stem = (RULES['wrong_stems'].get(doc) if wrong else None) \
        or RULES['stems'].get(doc) or RULES['default_stem']

    s = f'{doc} {stem}'
    if months and doc in RULES['monthly']:
        s += f' for the month of {months}'
    s += '.'

    field_txt = ', '.join(fields[:-1]) + ' & ' + fields[-1] if len(fields) > 1 else fields[0]

    # past the cap the sheet says (All <field>) rather than listing everyone
    if names and len(names.split(',')) + names.count('&') > RULES['name_cap']:
        return s + f' (All {field_txt})'

    s += f' (i.e. {field_txt})'
    if names:
        label = RULES['who_label'].get(doc, 'CM Name')
        s += f'({label} -:{names})'
    return s


# ---------------------------------------------------------------------------
# finding the blanks
# ---------------------------------------------------------------------------

def who_column(page):
    """Which transcribed column carries the person a row belongs to.

    Named explicitly in the transcription where possible; otherwise the first
    column whose heading looks like a name. Without this a blank cell has
    nobody attached to it, and a query with no name is the one the firm sends
    back — 27 of your 43 signed-off queries name somebody.
    """
    if page.get('who'):
        return page['who']
    for col in page.get('columns', []):
        low = col.lower()
        if 'name' in low or low.startswith('lan'):
            return col
    return None


def defects(page):
    """Every (field, person) pair on one page where the cell is empty.

    A field blank on every row is reported once with nobody named, the way an
    auditor writes it: "(All Executive Sign)" rather than forty names.
    """
    rows = page.get('rows') or []
    if not rows:
        return []

    skip = {c.lower() for c in (page.get('ignore') or [])}
    name_col = who_column(page)
    if name_col:
        skip.add(name_col.lower())

    columns = page.get('columns') or (list(rows[0].keys()) if rows else [])
    out = []

    for col in columns:
        if col.lower() in skip:
            continue
        # only rows that exist — a row with no name and no data is a blank line
        live = [r for r in rows if any(not is_blank(v) for k, v in r.items())]
        if not live:
            continue

        empty = [r for r in live if is_blank(r.get(col))]
        if not empty:
            continue

        if len(empty) == len(live) and len(live) > 2:
            out.append({'field': col, 'who': [], 'all': True})
        else:
            out.append({'field': col,
                        'who': [r.get(name_col, '') for r in empty] if name_col else [],
                        'all': False})
    return out


def observations(data):
    """Collate the whole folder into the rows of the sheet.

    Two passes, because the firm merges in two directions: several people with
    the same defect on the same page become one query, and the same defect in
    several months becomes one query with the months joined.
    """
    # pass 1 — one entry per person per field, carrying the months they are at
    # fault in. The person has to come first: the firm's sheets read "Sarmila
    # Sarkar, Apr'26 to Jun'26" and "Santanu Tarafder & Santanu Ghosh, May'26 &
    # Jun'26", which is each person's own run of months. Gathering people per
    # month instead splits one person across three rows.
    per_person = {}
    for page in data.get('pages', []):
        doc = page.get('document')
        if not doc:
            continue
        month = page.get('month', '')
        for d in defects(page):
            people = d['who'] or ['']
            for person in people:
                key = (doc, d['field'], str(person).strip(), d['all'])
                e = per_person.setdefault(key, {'months': set(), 'pages': []})
                if month:
                    e['months'].add(month)
                e['pages'].append(page.get('page'))

    # pass 2 — people whose months are identical share a row
    by_dfw = {}
    for (doc, field, person, all_rows), e in per_person.items():
        months = join_months(e['months'])
        key = (doc, field, months, all_rows)
        g = by_dfw.setdefault(key, {'who': [], 'pages': []})
        if person:
            g['who'].append(person)
        g['pages'].extend(e['pages'])

    # pass 3 — the same document, people and months, gathering fields, because
    # three blanks in one person's row are one query naming three fields
    merged = {}
    for (doc, field, months, all_rows), g in by_dfw.items():
        key = (doc, join_names(g['who']), months, all_rows)
        m = merged.setdefault(key, {'fields': [], 'pages': []})
        m['fields'].append(field)
        m['pages'].extend(g['pages'])

    rows = []
    for (doc, names, months, all_rows), m in merged.items():
        rows.append({
            'category': RULES['categories'].get(doc, 'Process Management'),
            'observation': phrase(doc, m['fields'], '' if all_rows else names,
                                  months, wrong=False),
            'review': '',
            'pages': sorted({p for p in m['pages'] if p}),
        })

    # anything the reader raised that is not a blank cell — a missing document,
    # an alteration, something seen at the premises
    for extra in data.get('extra', []):
        rows.append({'category': extra.get('category', 'Process Management'),
                     'observation': extra.get('observation', ''),
                     'review': extra.get('review', ''),
                     'pages': extra.get('pages', [])})

    rows = [r for r in rows if r['observation']]
    rows.sort(key=lambda r: (r['category'], r['observation']))
    return rows


# ---------------------------------------------------------------------------
# the workbook
# ---------------------------------------------------------------------------

def write(data, rows, path):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = Workbook()
    ws = wb.active
    ws.title = (data.get('agency') or 'Agency')[:31]

    head = Font(bold=True)
    grey = PatternFill('solid', fgColor='D9D9D9')
    thin = Side(style='thin', color='999999')
    box = Border(left=thin, right=thin, top=thin, bottom=thin)
    wrap = Alignment(vertical='top', wrap_text=True)

    ws['A1'] = 'Agency Visit Sign Off'
    ws['A1'].font = head
    ws.merge_cells('A1:B1')

    h = data.get('header', {})
    for i, (label, key) in enumerate(HEADER_ROWS, start=2):
        ws.cell(i, 1, label).font = head
        ws.cell(i, 2, h.get(key, ''))

    ws['A16'] = 'Audit Observation'
    ws['A16'].font = head
    ws.merge_cells('A16:B16')

    for col, title in ((1, 'Main Category'), (2, 'Observation'), (3, 'Sign off Revert')):
        c = ws.cell(17, col, title)
        c.font = head
        c.fill = grey
        c.border = box

    for i, r in enumerate(rows, start=18):
        ws.cell(i, 1, r['category']).border = box
        obs = ws.cell(i, 2, r['observation'])
        obs.border = box
        obs.alignment = wrap
        ws.cell(i, 3, r.get('review', '')).border = box

    ws.column_dimensions['A'].width = 34
    ws.column_dimensions['B'].width = 104
    ws.column_dimensions['C'].width = 20

    wb.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tables', help='the transcribed tables, as JSON')
    ap.add_argument('-o', '--out', default='', help='where to write the workbook')
    args = ap.parse_args()

    with open(args.tables, encoding='utf-8') as f:
        data = json.load(f)

    rows = observations(data)
    if not rows:
        sys.exit('no defects found in that transcription — check the tables file')

    out = args.out or f"{data.get('agency', 'Agency')} - Query sheet.xlsx"
    write(data, rows, out)

    print(f"agency      : {data.get('agency', '?')}")
    print(f"pages read  : {len(data.get('pages', []))}")
    print(f"observations: {len(rows)}")
    print(f"written     : {out}\n")
    for r in rows:
        where = f"  [pages {', '.join(str(p) for p in r['pages'])}]" if r['pages'] else ''
        print(f"  {r['category']}\n    {r['observation']}{where}")


if __name__ == '__main__':
    main()
