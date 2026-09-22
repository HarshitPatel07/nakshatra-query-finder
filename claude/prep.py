"""
prep.py — turn an agency's evidence folder into pages that can actually be read.

The browser app reads whole pages at once through a free vision model, and the
measured result was that it finds fields but cannot attribute rows: on MS
Chandan, 0 of the 14 queries that name a person came out right, while 3 of the
4 that name nobody did.

The evidence was never the problem. The page that lost two of those queries was
photographed sideways and then shrunk to fit a model's input, and the signature
column went with it. Straightened and cropped, the same page gives up the three
blank signatures and their names in one read.

So this does the preparation, which is code and therefore reliable, and leaves
only the reading to a model:

    python prep.py "<agency folder>"          pages + contact sheets
    python prep.py "<folder>" --flip 3,7      those pages were upside down
    python prep.py "<folder>" --zoom 3        one page, blown up in bands

Everything lands in <folder>/_work, which is disposable.
"""

import sys, os, json, argparse

from PIL import Image
import numpy as np

Image.MAX_IMAGE_PIXELS = None

IMG_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}
PAGE_EDGE = 2600          # what a page is stored at
ZOOM_EDGE = 3400          # what a band is stored at
PDF_DPI = 220


# ---------------------------------------------------------------------------
# collecting pages
# ---------------------------------------------------------------------------

def collect(folder):
    """Every page in the folder, in a stable order, as PIL images.

    Named (label, image). A PDF contributes one entry per page; the label keeps
    the file name so a query can be traced back to the evidence it came from.

    These folders routinely hold the same evidence twice — MS Chandan has 45
    photographs and a 45-page PDF of the same pages, which came to 90. Reading
    both doubles the cost of the agency and produces every query twice, so a
    page that looks like one already taken is dropped. Images are taken before
    PDFs, because a photograph is the original and a PDF page is a copy of it.
    """
    images, pdfs = [], []
    for root, _dirs, files in os.walk(folder):
        if '_work' in root.split(os.sep):
            continue
        for name in sorted(files, key=natural):
            path = os.path.join(root, name)
            ext = os.path.splitext(name)[1].lower()
            if ext in IMG_EXT:
                images.append((name, path))
            elif ext == '.pdf':
                pdfs.append((name, path))

    out, seen, dropped = [], [], 0
    for name, path in images:
        img = Image.open(path)
        sig = signature(img)
        if any(alike(sig, s) for s in seen):
            dropped += 1
            continue
        seen.append(sig)
        out.append((name, img))

    for name, path in pdfs:
        for label, img in from_pdf(path, name):
            sig = signature(img)
            if any(alike(sig, s) for s in seen):
                dropped += 1
                continue
            seen.append(sig)
            out.append((label, img))

    if dropped:
        print(f'note        : {dropped} duplicate page(s) skipped '
              f'— the folder holds the same evidence more than once')
    return out


def signature(img):
    """A small greyscale fingerprint, orientation-independent.

    The PDF copy of a photograph is resampled and recompressed, so the bytes
    differ entirely while the page is the same. Comparing a 16x16 reduction
    catches that; comparing all four rotations catches a copy that was also
    turned on the way into the PDF.
    """
    a = np.asarray(img.convert('L').resize((48, 48)), dtype=np.float32)
    a = (a - a.mean()) / (a.std() + 1e-6)
    return [np.rot90(a, k) for k in range(4)]


def alike(sig, other, tol=0.15):
    """Same page if any rotation lines up.

    The threshold is deliberately tight, because losing a genuine page is far
    worse than reading one twice: a page not read is a query not raised. It is
    set from measurement, not taste — on this evidence two photographs of two
    different register pages sit at 0.49 to 0.68 apart, while the same
    photograph reached through a PDF sits near zero, so 0.15 has a wide margin
    on both sides. An earlier 16x16 fingerprint at 0.28 threw away fourteen
    real pages, because register pages differ only in the handwriting.
    """
    base = sig[0]
    return any(np.abs(base - o).mean() < tol for o in other)


def from_pdf(path, label):
    """Pages out of a PDF, preferring the photograph embedded in the page.

    These PDFs are photographs pasted onto pages, so rendering the page gives
    the photograph plus white margins at whatever DPI was asked for. Taking the
    embedded image instead gives the original pixels — sharper than any render,
    and it makes the page comparable with the same photograph sitting loose in
    the folder, which the margins otherwise defeat.
    """
    import io, pymupdf
    doc = pymupdf.open(path)
    zoom = PDF_DPI / 72
    pages = []

    for i, page in enumerate(doc, 1):
        embedded = page.get_images(full=True)
        img = None
        if len(embedded) == 1:
            try:
                raw = doc.extract_image(embedded[0][0])
                img = Image.open(io.BytesIO(raw['image']))
                img.load()
            except Exception:
                img = None
        if img is None:
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        pages.append((f'{label} p{i}', img))

    return pages


def natural(name):
    """image_2 before image_10, which plain sorting gets wrong."""
    import re
    return [int(t) if t.isdigit() else t.lower()
            for t in re.split(r'(\d+)', name)]


# ---------------------------------------------------------------------------
# which way up
# ---------------------------------------------------------------------------

def upright(img):
    """Deliberately does nothing. Orientation is declared, not guessed.

    Guessing was tried and measured against twelve pages whose true orientation
    was known. Aspect ratio is useless — these photographs are 1808x1769, almost
    square, and roughly half are sideways. The usual projection tricks, which
    work on flat scans, were no better: comparing how abruptly ink changes along
    each axis put an upright page at a ratio of 2.76 and a sideways one at 1.07,
    the wrong way round. The book is photographed at an angle under a hard light
    and the shadow gradient across the page swamps the text.

    Half-right rotation is worse than none, because it turns one clear
    instruction — "these pages are sideways" — into a scattered list of
    exceptions. So every page is stored as photographed, the contact sheet shows
    what that looks like, and --rotate corrects them in one command. Wrong
    orientation costs real queries: the page that lost two of MS Chandan's was
    sideways, and read straight it gives up all three blank signatures.
    """
    return img, 0


def fit(img, edge):
    w, h = img.size
    if max(w, h) <= edge:
        return img
    s = edge / max(w, h)
    return img.resize((int(w * s), int(h * s)), Image.LANCZOS)


# ---------------------------------------------------------------------------
# output
# ---------------------------------------------------------------------------

def contact_sheets(work, pages, per=12, cols=4):
    """Numbered thumbnails, so the orientation of forty pages can be checked in
    three glances rather than forty reads."""
    from PIL import ImageDraw
    sheets = []
    cell = 430
    rows = (per + cols - 1) // cols

    for start in range(0, len(pages), per):
        chunk = pages[start:start + per]
        sheet = Image.new('RGB', (cols * cell, rows * cell), 'white')
        draw = ImageDraw.Draw(sheet)
        for i, (n, img) in enumerate(chunk):
            thumb = fit(img.convert('RGB'), cell - 34)
            x = (i % cols) * cell
            y = (i // cols) * cell + 30
            sheet.paste(thumb, (x + 4, y))
            draw.rectangle([x + 2, y - 28, x + 90, y - 4], fill='black')
            draw.text((x + 10, y - 24), f'page {n}', fill='white')
        path = os.path.join(work, 'contact', f'sheet_{start // per + 1:02d}.jpg')
        sheet.save(path, quality=88)
        sheets.append(path)
    return sheets


def zoom_page(work, number, img, bands=3):
    """One page cut into full-width horizontal bands.

    Full width, always. Cutting a register vertically separates the name column
    from the data and every observation comes back with nobody on it — that was
    measured, and it took the accuracy from 4 in 12 down to 1 in 12. Horizontal
    bands keep every row intact and simply make it bigger.
    """
    out = []
    w, h = img.size
    overlap = int(h * 0.04)          # so a row split by a cut still appears whole
    for i in range(bands):
        top = max(0, int(h * i / bands) - overlap)
        bottom = min(h, int(h * (i + 1) / bands) + overlap)
        band = img.crop((0, top, w, bottom))
        band = fit(band, ZOOM_EDGE)
        path = os.path.join(work, 'zoom', f'page{number:03d}_{chr(97 + i)}.jpg')
        band.save(path, quality=95)
        out.append(path)
    return out


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--rotate', default='',
                    help='corrections from the contact sheet, e.g. "1:90,2:90,8:180" '
                         '(degrees clockwise to apply on top of the guess)')
    ap.add_argument('--flip', default='', help='shorthand for rotating these pages 180')
    ap.add_argument('--zoom', default='', help='page numbers to blow up into bands')
    ap.add_argument('--bands', type=int, default=3)
    args = ap.parse_args()

    folder = os.path.abspath(args.folder)
    if not os.path.isdir(folder):
        sys.exit(f'not a folder: {folder}')

    work = os.path.join(folder, '_work')
    for sub in ('pages', 'contact', 'zoom'):
        os.makedirs(os.path.join(work, sub), exist_ok=True)

    turns = {}
    for part in args.rotate.replace(' ', '').split(','):
        if ':' in part:
            n, deg = part.split(':', 1)
            turns[int(n)] = int(deg) % 360
    for x in args.flip.replace(' ', '').split(','):
        if x:
            turns[int(x)] = 180
    want_zoom = {int(x) for x in args.zoom.replace(' ', '').split(',') if x}

    raw = collect(folder)
    if not raw:
        sys.exit(f'no images or PDFs found in {folder}')

    manifest, prepared = [], []
    for n, (label, img) in enumerate(raw, 1):
        page, turned = upright(img.convert('RGB'))
        extra = turns.get(n, 0)
        if extra:
            # PIL rotates anticlockwise, the correction is given clockwise
            page = page.rotate(-extra, expand=True)
            turned = (turned + extra) % 360
        page = fit(page, PAGE_EDGE)
        path = os.path.join(work, 'pages', f'page{n:03d}.jpg')
        page.save(path, quality=92)
        manifest.append({'page': n, 'source': label, 'rotated': turned,
                         'file': os.path.relpath(path, folder).replace('\\', '/')})
        prepared.append((n, page))

    if want_zoom:
        for n, page in prepared:
            if n in want_zoom:
                zoom_page(work, n, page, args.bands)

    sheets = contact_sheets(work, prepared)

    with open(os.path.join(work, 'pages.json'), 'w', encoding='utf-8') as f:
        json.dump({'agency': os.path.basename(folder), 'pages': manifest}, f, indent=1)

    print(f'agency      : {os.path.basename(folder)}')
    print(f'pages       : {len(manifest)}')
    print(f'straightened: {sum(1 for m in manifest if m["rotated"])}')
    print(f'pages in    : {os.path.join(work, "pages")}')
    print(f'contact     : {len(sheets)} sheet(s) in {os.path.join(work, "contact")}')
    if want_zoom:
        print(f'zoomed      : pages {sorted(want_zoom)} into {args.bands} bands each')


if __name__ == '__main__':
    main()
