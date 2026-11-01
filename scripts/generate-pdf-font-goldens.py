"""Independent raster reference from project-generated PDF fixtures; no installs.

Input PDFs are produced by pdf-font-fixtures.mjs, not external documents.
PyMuPDF's substitutes differ from Foxit/Liberation; compare glyph masks with a
small spatial tolerance, never claim byte-identical antialiasing or outlines.
"""
import hashlib
import json
import pathlib
import sys
import zlib
import pymupdf

if pymupdf.VersionBind != '1.28.2' or len(sys.argv) != 3:
    raise SystemExit('PyMuPDF 1.28.2, input directory and output JSON required')
source = pathlib.Path(sys.argv[1])
out = {'generator': 'PyMuPDF 1.28.2', 'scale': 1.5, 'darkThreshold': 200, 'fonts': {}}
for pdf in sorted(source.glob('*.pdf')):
    with pymupdf.open(pdf) as doc:
        pix = doc[0].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
        rgb = pix.samples
        mask = bytes(1 if rgb[i] < 200 else 0 for i in range(0, len(rgb), 3))
        item = {'pdfHash': hashlib.sha256(pdf.read_bytes()).hexdigest(),
                'width': pix.width, 'height': pix.height,
                'maskDeflateHex': zlib.compress(mask).hex()}
        if pdf.stem == 'ZapfDingbats':
            item['diagnosticOnly'] = 'MuPDF has different pencil/nib designs at codes 0x30-32; keep reference, verify Unicode against the encoding separately.'
        out['fonts'][pdf.stem] = item
if len(out['fonts']) != 14:
    raise SystemExit('Exactly fourteen standard-font PDFs required')
pathlib.Path(sys.argv[2]).write_text(json.dumps(out, indent=2) + '\n', encoding='utf8')
