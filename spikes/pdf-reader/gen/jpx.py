"""Minimal one-page PDF whose image is JPEG 2000 (/JPXDecode), to exercise pdf.js's openjpeg decoder."""
import io, sys
import numpy as np
from PIL import Image
w, h = 800, 600
x = np.linspace(0, 255, w, dtype=np.uint8)
y = np.linspace(0, 255, h, dtype=np.uint8)
arr = np.stack([np.tile(x, (h, 1)), np.tile(y[:, None], (1, w)), np.full((h, w), 128, np.uint8)], axis=2)
buf = io.BytesIO(); Image.fromarray(arr).save(buf, "JPEG2000"); jpx = buf.getvalue()
content = b"q 400 0 0 300 50 50 cm /Im0 Do Q"
objs = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 400] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /Length %d >>\nstream\n" % (w, h, len(jpx)) + jpx + b"\nendstream",
    b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
]
out = bytearray(b"%PDF-1.5\n"); offs = []
for i, o in enumerate(objs, 1):
    offs.append(len(out)); out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
xref = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
open(sys.argv[1], "wb").write(out); print("jpx pdf", len(out), "bytes")
