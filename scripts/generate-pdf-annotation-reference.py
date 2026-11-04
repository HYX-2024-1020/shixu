"""Independent reference for the project-generated NeedAppearances text field.

PyMuPDF only generates a mask; it is not part of the service or parser runtime.
"""
import hashlib
import json
import pathlib
import sys
import zlib
import pymupdf

if pymupdf.VersionBind != '1.28.2' or len(sys.argv) != 3:
    raise SystemExit('PyMuPDF 1.28.2, synthetic PDF and output JSON required')
source = pathlib.Path(sys.argv[1])
with pymupdf.open(source) as document:
    pix = document[0].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
    data = pix.samples
    mask = bytes(1 if data[i + 2] < 200 else 0 for i in range(0, len(data), 3))
result = {'generator': 'PyMuPDF 1.28.2', 'scale': 1.5, 'blueThreshold': 200,
          'pdfHash': hashlib.sha256(source.read_bytes()).hexdigest(),
          'width': pix.width, 'height': pix.height, 'maskDeflateHex': zlib.compress(mask).hex()}
pathlib.Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
