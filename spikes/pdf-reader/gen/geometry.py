"""Spike C fixture: one page per awkward page geometry, each with the same two landmarks in raw PDF user space:
a red square at (100,100)-(150,150) and the text ANCHOR TEXT, 24 pt Helvetica, baseline at (100,300).
Pages differ only in /MediaBox, /CropBox, /Rotate and /UserUnit, so a viewer that maps raw user-space rectangles
correctly puts the same rectangle over the same landmark on every page.
usage: geometry.py OUT.pdf"""
import sys

PAGES = [
    ("plain", {"MediaBox": [0, 0, 612, 792]}),
    ("rotate90", {"MediaBox": [0, 0, 612, 792], "Rotate": 90}),
    ("rotate180", {"MediaBox": [0, 0, 612, 792], "Rotate": 180}),
    ("rotate270", {"MediaBox": [0, 0, 612, 792], "Rotate": 270}),
    ("crop", {"MediaBox": [0, 0, 612, 792], "CropBox": [50, 60, 450, 600]}),
    ("media-offset", {"MediaBox": [-100, -100, 512, 692]}),
    ("crop+rotate90", {"MediaBox": [0, 0, 612, 792], "CropBox": [50, 60, 450, 600], "Rotate": 90}),
    ("media-offset+crop+rotate270", {"MediaBox": [-100, -100, 512, 692], "CropBox": [-20, -30, 420, 560], "Rotate": 270}),
    ("userunit2", {"MediaBox": [0, 0, 612, 792], "UserUnit": 2}),
]

CONTENT = b"1 0 0 rg 100 100 50 50 re f 0 g BT /F1 24 Tf 100 300 Td (ANCHOR TEXT) Tj ET"


def nums(v):
    return "[" + " ".join(str(n) for n in v) + "]"


objs = []  # index 0 is object 1
n_pages = len(PAGES)
font_id = 3 + 2 * n_pages
objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n_pages))
objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
for i, (_, geo) in enumerate(PAGES):
    page_id, content_id = 3 + 2 * i, 4 + 2 * i
    entries = f"/Type /Page /Parent 2 0 R /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R"
    for key in ("MediaBox", "CropBox"):
        if key in geo:
            entries += f" /{key} {nums(geo[key])}"
    for key in ("Rotate", "UserUnit"):
        if key in geo:
            entries += f" /{key} {geo[key]}"
    objs.append(f"<< {entries} >>".encode())
    objs.append(b"<< /Length %d >>\nstream\n" % len(CONTENT) + CONTENT + b"\nendstream")
objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

out = bytearray(b"%PDF-1.6\n")
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(len(out))
    out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
xref = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
open(sys.argv[1], "wb").write(out)
print(f"{n_pages} pages: " + ", ".join(name for name, _ in PAGES))
