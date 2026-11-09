"""Generates a textbook-like PDF for spike A: real text, an outline, printed page labels
(roman numerals for the front matter, then arabic from 1), and noisy JPEG figures to bulk it up.
usage: gen.py OUT.pdf PAGES FIGURE_EVERY JPEG_QUALITY"""
import io, random, sys, time
import numpy as np
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

out, pages, every, quality = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
rng = np.random.default_rng(7)
random.seed(7)
words = ("consistency replication partition leader follower log commit quorum latency throughput index "
         "storage engine transaction isolation snapshot schema stream batch consumer producer offset "
         "checkpoint recovery failure detector timeout clock ordering causal vector merge conflict").split()

W, H = letter
c = canvas.Canvas(out, pagesize=letter)
c.setTitle("Spike A Textbook: Designing Large Systems")
FRONT = 8
c.addPageLabel(0, "ROMAN_LOWER", 1)
c.addPageLabel(FRONT, "ARABIC", 1)

t0 = time.time()
fig_bytes = 0
for p in range(pages):
    if p >= FRONT and (p - FRONT) % 30 == 0:
        ch = (p - FRONT) // 30 + 1
        c.bookmarkPage(f"ch{ch}")
        c.addOutlineEntry(f"Chapter {ch}", f"ch{ch}", level=0, closed=False)
    if p >= FRONT and (p - FRONT) % 10 == 5:
        c.bookmarkPage(f"s{p}")
        c.addOutlineEntry(f"Section {p}", f"s{p}", level=1, closed=True)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, H - 72, f"Chapter {(max(p - FRONT, 0)) // 30 + 1} (page {p + 1} of the file)")
    c.setFont("Times-Roman", 11)
    y = H - 110
    for line in range(36):
        text = " ".join(random.choice(words) for _ in range(16))
        c.drawString(72, y, text)
        y -= 14
    if p >= FRONT and p % every == 0:
        arr = rng.integers(0, 256, size=(560, 760, 3), dtype=np.uint8)
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, "JPEG", quality=quality)
        fig_bytes += buf.tell()
        buf.seek(0)
        c.drawImage(ImageReader(buf), 72, 72, width=W - 144, height=(W - 144) * 560 / 760)
    c.showPage()
c.save()
print(f"{pages} pages, figures {fig_bytes / 1e6:.0f} MB, {time.time() - t0:.0f}s")
