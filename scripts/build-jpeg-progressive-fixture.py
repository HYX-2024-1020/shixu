"""Own synthetic progressive JPEG and independent Pillow pixel golden.

Uses an existing Pillow installation; installs no software. No personal input.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image, features, __version__

root = Path(__file__).resolve().parent.parent / "server" / "reading" / "fixtures"
image = Image.new("RGB", (19, 11))
image.putdata([((x * 37) % 256, (y * 41) % 256, (x * 13 + y * 7) % 256)
               for y in range(11) for x in range(19)])
target = root / "jpeg-progressive.jpg"
image.save(target, "JPEG", quality=90, progressive=True, subsampling=0)
pixels = Image.open(target).convert("RGBA").tobytes()
(root / "jpeg-progressive.json").write_text(json.dumps({
    "source": "project-authored synthetic RGB pattern, no external image",
    "pillow": __version__, "libjpeg": features.version("jpg"),
    "width": 19, "height": 11, "quality": 90, "progressive": True, "subsampling": 0,
    "inputHash": hashlib.sha256(target.read_bytes()).hexdigest(),
    "pixelsHash": hashlib.sha256(pixels).hexdigest(), "pixelsHex": pixels.hex(),
}, indent=2) + "\n", encoding="utf-8")

# An incomplete final restart interval in progressive single-component scans
# exercises the bounded-loop fix independently of our fixture encoder.
restart = Image.new("RGB", (23, 17))
restart.putdata([((x * 17) % 256, (y * 19) % 256, (x * 7 + y * 11) % 256)
                 for y in range(17) for x in range(23)])
restart_path = root / "jpeg-restart.jpg"
restart.save(restart_path, "JPEG", quality=90, progressive=True, subsampling=0,
             restart_marker_blocks=4)
restart_pixels = Image.open(restart_path).convert("RGBA").tobytes()
(root / "jpeg-restart.json").write_text(json.dumps({
    "source": "project-authored synthetic RGB pattern, no external image",
    "pillow": __version__, "libjpeg": features.version("jpg"),
    "width": 23, "height": 17, "quality": 90, "progressive": True,
    "subsampling": 0, "restart_marker_blocks": 4,
    "inputHash": hashlib.sha256(restart_path.read_bytes()).hexdigest(),
    "pixelsHash": hashlib.sha256(restart_pixels).hexdigest(),
    "pixelsHex": restart_pixels.hex(),
}, indent=2) + "\n", encoding="utf-8")
