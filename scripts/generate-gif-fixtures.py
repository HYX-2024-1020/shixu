"""Project-authored synthetic GIFs and independent Pillow 12.3 pixel oracle.
Run from repository root; generated fixtures contain no third-party artwork.
Pillow is development-only; production and normal tests do not import Python.
"""
from pathlib import Path
from hashlib import sha256
import json
from PIL import Image, ImageSequence

root = Path("server/reading/fixtures")
palette = [v for i in range(256) for v in (i, (i * 53) % 256, (i * 137) % 256)]
state = 7319
data = []
for _ in range(129 * 129):
    state = (1664525 * state + 1013904223) & 0xffffffff
    data.append((state >> 17) & 255)
static = Image.new("P", (129, 129))
static.putpalette(palette)
static.putdata(data)
static.save(root / "gif-lzw.gif", optimize=False, interlace=True)

frames = []
for frame in range(4):
    image = Image.new("P", (9, 11), 0)
    image.putpalette(palette)
    for y in range(11):
        for x in range(9):
            if (x + 2 * y + frame) % 4 == 0:
                image.putpixel((x, y), 1 + frame * 17 + (x * 3 + y) % 13)
    frames.append(image)
frames[0].save(root / "gif-disposals.gif", save_all=True, append_images=frames[1:],
               duration=[10, 20, 30, 40], disposal=[1, 2, 3, 1], transparency=0,
               loop=0, optimize=False, interlace=False)

transparent = Image.new("P", (2, 1))
transparent.putpalette(palette)
transparent.putdata([1, 2])
transparent.save(root / "gif-transparent-background.gif", transparency=1,
                 background=2, optimize=False)

report = {"generator": "Pillow 12.3.0", "synthetic": True, "files": {}}
for name in ["gif-lzw.gif", "gif-disposals.gif", "gif-transparent-background.gif"]:
    path = root / name
    image = Image.open(path)
    expected = []
    at = 0
    for index, frame in enumerate(ImageSequence.Iterator(image)):
        rgba = frame.convert("RGBA")
        white = Image.new("RGBA", rgba.size, "white")
        white.alpha_composite(rgba)
        duration = frame.info.get("duration", 0)
        expected.append({"frame": index + 1, "startMs": at, "durationMs": duration,
                         "pixelsHash": sha256(white.tobytes()).hexdigest()})
        at += duration
    report["files"][name] = {"sha256": sha256(path.read_bytes()).hexdigest(),
                            "width": image.width, "height": image.height, "frames": expected}
(root / "gif-goldens.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
