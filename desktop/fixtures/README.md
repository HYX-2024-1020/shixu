RAR fixture from libarchive's test suite:
https://github.com/libarchive/libarchive/blob/master/libarchive/test/test_read_format_rar.rar.uu

Used only by the archive parser tests. It contains small test text files, directories and a link. No archived program is executed. The original uuencoded form is retained for traceability.

Legacy Office fixtures (testWORD.doc, testEXCEL.xls, testPPT.ppt) are from Apache Tika, Apache License 2.0:
https://github.com/apache/tika/tree/main/tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/resources/test-documents

Live recognition acceptance (opt-in, actual API usage):

- `teacher-notice.svg` is a repository-created synthetic notification with a date/time, PDF naming requirement, 2-column table and a formula. The acceptance script renders it to PNG and embeds a JPEG copy in a textless PDF, so the real PDF rendering/OCR path is exercised.
- The Chinese handwritten paper image is from PaddlePaddle's public PP-OCRv5 demo, pinned revision `13ea0c7`:
  https://huggingface.co/spaces/PaddlePaddle/PP-OCRv5_Online_Demo/resolve/13ea0c7/examples/handwrite_ch_demo.png
  The depicted poem is Su Shi's public-domain 《初到黄州》. The photograph is not redistributed in this repository; keep the downloaded evaluation copy at `.private/live-fixtures/handwrite_ch_demo.png`, or set `SHIXU_HANDWRITING_FIXTURE` to its path.
- Expected image SHA-256: `28B1AD0E935A0309F8F44D6B4924EAD2492FEAA379A3A617E3A1FA919305B07F`.
- `desktop-live-acceptance.mjs` submits only these public/generated fixtures and eight synthetic text sources, not the user's personal workspace. It copies only the encrypted key and Local State encryption metadata into an isolated profile, and removes those copies after closing. The saved reports contain sample results and API usage, never credentials.
- Passing these samples does not establish an accuracy rate for arbitrary handwriting, formulas, complex layouts or photographs. The UI always labels OCR as a transcription requiring comparison with the original.
