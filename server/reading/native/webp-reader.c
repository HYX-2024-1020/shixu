// Project-authored stdin-only adapter to pinned libwebp. MIT (repository).
// No paths, URLs, metadata strings or host configuration are accepted.
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#ifndef _WIN32
#include <sys/resource.h>
#endif
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#include "src/webp/demux.h"

static int u32(uint32_t n) {
  const unsigned char b[4] = {(unsigned char)n, (unsigned char)(n >> 8),
                            (unsigned char)(n >> 16), (unsigned char)(n >> 24)};
  return fwrite(b, 1, 4, stdout) == 4;
}
int main(int argc, char** argv) {
  const size_t limit = 10u * 1024u * 1024u;
  char* end = NULL;
  long tile;
  unsigned char* input = NULL;
  unsigned char* selected = NULL;
  WebPAnimDecoder* decoder = NULL;
  WebPAnimDecoderOptions options;
  WebPAnimInfo info;
  WebPData data;
  WebPDemuxer* demux = NULL;
  size_t length, tile_bytes;
  uint32_t columns, rows, per_frame, frame, x, y, width, height, count = 0;
  int previous = 0, timestamp, start = 0, duration = 0, result = 1;
  uint32_t peak_rss_kib = 0;
  if (argc != 2) return 2;
  tile = strtol(argv[1], &end, 10);
  if (!end || *end || tile < 1 || tile > 64) return 2;
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  input = (unsigned char*)malloc(limit + 1);
  if (!input) goto done;
  length = fread(input, 1, limit + 1, stdin);
  if (length < 12 || length > limit || ferror(stdin) || !feof(stdin)) goto done;
  data.bytes = input; data.size = length;
  demux = WebPDemux(&data);
  if (!demux) goto done;
  info.canvas_width = WebPDemuxGetI(demux, WEBP_FF_CANVAS_WIDTH);
  info.canvas_height = WebPDemuxGetI(demux, WEBP_FF_CANVAS_HEIGHT);
  info.frame_count = WebPDemuxGetI(demux, WEBP_FF_FRAME_COUNT);
  if (!info.canvas_width || !info.canvas_height || info.canvas_width > 16384 ||
      info.canvas_height > 16384 || !info.frame_count || info.frame_count > 64 ||
      (uint64_t)info.canvas_width * info.canvas_height * info.frame_count > 32000000u) goto done;
  WebPDemuxDelete(demux); demux = NULL;
  if (!WebPAnimDecoderOptionsInit(&options)) goto done;
  options.color_mode = MODE_RGBA;
  options.use_threads = 0;
  decoder = WebPAnimDecoderNew(&data, &options);
  if (!decoder || !WebPAnimDecoderGetInfo(decoder, &info)) goto done;
  if (!info.canvas_width || !info.canvas_height || info.canvas_width > 16384 ||
      info.canvas_height > 16384 || !info.frame_count || info.frame_count > 64 ||
      (uint64_t)info.canvas_width * info.canvas_height * info.frame_count > 32000000u) goto done;
  columns = (info.canvas_width + 1023) / 1024;
  rows = (info.canvas_height + 1023) / 1024;
  per_frame = columns * rows;
  if (per_frame * info.frame_count > 64 || (uint32_t)tile > per_frame * info.frame_count) goto done;
  frame = ((uint32_t)tile - 1) / per_frame + 1;
  x = (((uint32_t)tile - 1) % per_frame % columns) * 1024;
  y = (((uint32_t)tile - 1) % per_frame / columns) * 1024;
  width = info.canvas_width - x; if (width > 1024) width = 1024;
  height = info.canvas_height - y; if (height > 1024) height = 1024;
  tile_bytes = (size_t)width * height * 4;
  selected = (unsigned char*)malloc(tile_bytes);
  if (!selected) goto done;
  while (WebPAnimDecoderHasMoreFrames(decoder)) {
    uint8_t* rgba;
    uint32_t row;
    if (!WebPAnimDecoderGetNext(decoder, &rgba, &timestamp) || timestamp < previous ||
        ++count > info.frame_count) goto done;
    if (count == frame) {
      start = previous; duration = timestamp - previous;
      for (row = 0; row < height; row++)
        memcpy(selected + (size_t)row * width * 4,
               rgba + ((size_t)(row + y) * info.canvas_width + x) * 4,
               (size_t)width * 4);
    }
    previous = timestamp;
  }
#ifndef _WIN32
  { struct rusage usage; if (getrusage(RUSAGE_SELF, &usage) == 0) peak_rss_kib = (uint32_t)usage.ru_maxrss; }
#endif
  if (count != info.frame_count || fwrite("SHIXUWP3", 1, 8, stdout) != 8 ||
      !u32(info.canvas_width) || !u32(info.canvas_height) || !u32(info.frame_count) ||
      !u32(frame) || !u32((uint32_t)start) || !u32((uint32_t)duration) || !u32(x) ||
      !u32(y) || !u32(width) || !u32(height) || !u32(peak_rss_kib) || fwrite(selected, 1, tile_bytes, stdout) != tile_bytes ||
      fflush(stdout) != 0) goto done;
  result = 0;
done:
  if (demux) WebPDemuxDelete(demux);
  if (decoder) WebPAnimDecoderDelete(decoder);
  free(selected); free(input);
  return result;
}
