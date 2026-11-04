"""Project-authored WebP fixtures; Pillow12.3 encoder and saved pixel oracle.
Production/tests use the committed fixtures and pinned source-built decoder.
"""
from pathlib import Path
import json
from hashlib import sha256
from PIL import Image, ImageSequence

root = Path("server/reading/fixtures")
def pattern(width, height, frame=0, alpha=True):
    image = Image.new("RGBA", (width, height))
    image.putdata([((x*37+frame*17)%256, (y*41+frame*23)%256,
                    (x*13+y*7+frame*41)%256,
                    [0,128,255][(x+y+frame)%3] if alpha else 255)
                   for y in range(height) for x in range(width)])
    return image

for lossless in [True, False]:
    pattern(19, 11).save(root / ("webp-lossless.webp" if lossless else "webp-lossy.webp"),
                         lossless=lossless, quality=85, method=6)
pattern(2051,4,alpha=False).save(root / "webp-wide.webp", lossless=True, method=6)
frames = [pattern(9,11,i) for i in range(4)]
frames[0].save(root / "webp-animation.webp", save_all=True, append_images=frames[1:],
               lossless=True, duration=[10,20,30,40], loop=0, method=6,
               background=(255,255,255,0))

report = {"generator":"Pillow 12.3.0","synthetic":True,"files":{}}
for name in ["webp-lossless.webp","webp-lossy.webp","webp-wide.webp","webp-animation.webp"]:
    path = root / name
    image = Image.open(path)
    expected = []
    for index,frame in enumerate(ImageSequence.Iterator(image)):
        rgba = frame.convert("RGBA")
        white = Image.new("RGBA",rgba.size,"white")
        white.alpha_composite(rgba)
        expected.append({"frame":index+1,"startMs":frame.info.get("timestamp",0),
                         "durationMs":frame.info.get("duration",0),
                         "pixelsHash":sha256(white.tobytes()).hexdigest()})
    report["files"][name] = {"sha256":sha256(path.read_bytes()).hexdigest(),
                            "width":image.width,"height":image.height,"frames":expected}
(root / "webp-goldens.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")

# Optional fixed single resource measurement; not a capacity/P95 benchmark.
import sys
if "--resource" in sys.argv:
    out = Path(sys.argv[sys.argv.index("--resource") + 1])
    out.mkdir(parents=True, exist_ok=True)
    width = height = 2048
    resource_frames = []
    for frame in [0,1]:
        raw = bytearray(width*height*4)
        for y in range(height):
            for x in range(width):
                i = (y*width+x)*4
                raw[i:i+4] = bytes(((x+frame*17)%256, (y+frame*23)%256,
                                    (x+y+frame*41)%256, 255))
        resource_frames.append(Image.frombytes("RGBA", (width,height), bytes(raw)))
    path = out / "webp-resource.webp"
    resource_frames[0].save(path, save_all=True, append_images=resource_frames[1:],
                            lossless=True, duration=[10,20], method=6, loop=0)
    expected = resource_frames[1].crop((1024,1024,2048,2048)).tobytes()
    (out / "webp-resource.json").write_text(json.dumps({"width":width,"height":height,
        "totalFrames":2,"tile":8,"inputHash":sha256(path.read_bytes()).hexdigest(),
        "expectedPixelsHash":sha256(expected).hexdigest()},indent=2)+"\n",encoding="utf-8")
