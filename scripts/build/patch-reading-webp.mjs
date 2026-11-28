// Exact transformations of the pinned BSD libwebp source. Source and complete
// notices are shipped beside the adapter. Fail closed on every anchor mismatch.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function patchReadingWebp(src) {
  const change = async (file, edits) => {
    let text = await readFile(join(src, file), "utf8");
    for (const [before, after, count = 1] of edits) {
      if (text.split(before).length !== count + 1)
        throw Error("WEBP_PATCH_ANCHOR: " + file);
      text = text.replaceAll(before, after);
    }
    await writeFile(join(src, file), text);
  };
  await change("src/utils/bit_reader_utils.h", [
    [
      '#include "src/webp/types.h"',
      '#include "src/webp/types.h"\n#include "src/utils/bit_writer_utils.h"',
    ],
    [
      "  int eof;                   // true if input is exhausted",
      "  int eof;                   // true if input is exhausted\n  VP8BitWriter shixu_writer;\n  const uint8_t* shixu_start;\n  size_t shixu_size;",
    ],
    [
      "// Initialize the bit reader and the boolean decoder.",
      "// Re-encode decoded boolean symbols with their exact probabilities.\n// Only a canonical terminated partition may be delivered by this adapter.\nvoid ShixuRecordBit(VP8BitReader* br, int bit, int prob);\nint ShixuPartitionEnd(VP8BitReader* br);\n\n// Initialize the bit reader and the boolean decoder.",
    ],
  ]);
  await change("src/utils/bit_reader_utils.c", [
    ["#include <stddef.h>", "#include <stddef.h>\n#include <string.h>"],
    [
      "  br->range   = 255 - 1;",
      "  memset(&br->shixu_writer, 0, sizeof(br->shixu_writer));\n  br->shixu_start = start; br->shixu_size = size;\n  VP8BitWriterInit(&br->shixu_writer, size + 8);\n  br->range   = 255 - 1;",
    ],
    [
      "void VP8RemapBitReader(",
      `void ShixuRecordBit(VP8BitReader* br, int bit, int prob) {
  VP8BitWriter* bw = &br->shixu_writer;
  if (!bw->error) {
    VP8PutBit(bw, bit, prob);
    if (VP8BitWriterPos(bw) / 8 > br->shixu_size + 1) bw->error = 1;
  }
}
int ShixuPartitionEnd(VP8BitReader* br) {
  VP8BitWriter* bw = &br->shixu_writer;
  if (bw->error) return 0;
  VP8BitWriterFinish(bw);
  return !bw->error && bw->pos == br->shixu_size &&
         memcmp(bw->buf, br->shixu_start, bw->pos) == 0;
}

void VP8RemapBitReader(`,
    ],
  ]);
  await change("src/utils/bit_reader_inl_utils.h", [
    [
      "    BT_TRACK(br);\n    return bit;",
      "    BT_TRACK(br);\n    ShixuRecordBit(br, bit, prob);\n    return bit;",
      2,
    ],
    [
      "    BT_TRACK(br);\n    return (v ^ mask) - mask;",
      "    BT_TRACK(br);\n    ShixuRecordBit(br, mask != 0, 128);\n    return (v ^ mask) - mask;",
    ],
  ]);
  await change("src/dec/vp8_dec.c", [
    [
      "    if (ok) ok = ParseFrame(dec, io);",
      `    if (ok) ok = ParseFrame(dec, io);
    if (ok) {
      unsigned int p;
      ok = ShixuPartitionEnd(&dec->br);
      for (p = 0; ok && p <= dec->num_parts_minus_one; ++p)
        ok = ShixuPartitionEnd(&dec->parts[p]);
      if (!ok) VP8SetError(dec, VP8_STATUS_BITSTREAM_ERROR, "noncanonical partition suffix");
    }`,
    ],
    [
      "  memset(&dec->br, 0, sizeof(dec->br));",
      `  {
    unsigned int p;
    VP8BitWriterWipeOut(&dec->br.shixu_writer);
    for (p = 0; p < 8; ++p) {
      VP8BitWriterWipeOut(&dec->parts[p].shixu_writer);
      memset(&dec->parts[p], 0, sizeof(dec->parts[p]));
    }
  }
  memset(&dec->br, 0, sizeof(dec->br));`,
    ],
  ]);
  await change("src/dec/webp_dec.c", [
    [
      "  io.data_size = headers.data_size - headers.offset;",
      "  io.data_size = headers.compressed_size; // Exclude RIFF padding and later metadata.",
    ],
  ]);
  const strict = `static int ShixuLosslessEnd(VP8LDecoder* dec) {
  const VP8LBitReader* br = &dec->br;
  const size_t bits = (br->pos > 8 ? (br->pos - 8) * 8 : 0) + br->bit_pos;
  if ((bits + 7) / 8 != br->len ||
      ((bits & 7) && (br->buf[br->len - 1] >> (bits & 7)) != 0))
    return VP8LSetError(dec, VP8_STATUS_BITSTREAM_ERROR);
  return 1;
}
`;
  await change("src/dec/vp8l_dec.c", [
    [
      "int VP8LDecodeAlphaImageStream(",
      strict + "\nint VP8LDecodeAlphaImageStream(",
    ],
    [
      "  return alph_dec->use_8b_decode ?",
      "  const int ok = alph_dec->use_8b_decode ?",
    ],
    [
      "                      last_row, ExtractAlphaRows);",
      "                      last_row, ExtractAlphaRows);\n  return ok && (last_row < dec->height || ShixuLosslessEnd(dec));",
    ],
    [
      "  params->last_y = dec->last_out_row;",
      "  if (io->crop_bottom == io->height && !ShixuLosslessEnd(dec)) goto Err;\n  params->last_y = dec->last_out_row;",
    ],
  ]);
}
