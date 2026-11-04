"""Collect exact published canvas SBOM notices; not run by the production reader.

Registry crate bytes must match the SHA-256 in the pinned upstream SBOM. Keep
complete unmodified MPL source archives. Native notices use exact Git revisions.
"""
import base64
import concurrent.futures
import hashlib
import io
import json
import re
import tarfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT.parent / "outputs" / "bcd-pdf-canvas-license-cache"
OUTPUT = ROOT / "server/reading/pdf-canvas-sources"
CACHE.mkdir(parents=True, exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)
if CACHE.is_symlink() or OUTPUT.is_symlink():
    raise RuntimeError("UNSAFE_LICENSE_DIRECTORY")


def fetch(url, maximum=64 * 1024 * 1024):
    path = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if path.exists():
        return path.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": "Shixu-source-notices/1"})
    with urllib.request.urlopen(req, timeout=25) as response:
        body = response.read(maximum + 1)
    if len(body) > maximum:
        raise RuntimeError("LICENSE_SOURCE_SIZE")
    path.write_bytes(body)
    return body


def crate(component):
    name, version = component["name"], component["version"]
    url = f"https://static.crates.io/crates/{name}/{name}-{version}.crate"
    body = fetch(url)
    digest = hashlib.sha256(body).hexdigest()
    expected = next(h["content"] for h in component["hashes"] if h["alg"] == "SHA-256")
    if digest != expected:
        raise RuntimeError("LICENSE_CRATE_INTEGRITY: " + name)
    licenses = component.get("licenses", [])
    notice = [f"\n===== Rust {name} {version} =====\nSource: {url}\nSHA-256: {digest}\nLicense: {json.dumps(licenses)}\n"]
    found = []
    with tarfile.open(fileobj=io.BytesIO(body), mode="r:gz") as archive:
        for item in archive.getmembers():
            path = Path(item.name)
            if item.isfile() and re.match(r"^(license|licence|copying|notice|authors|patents|ftl|legal|copyright)([._-].*)?$", path.name, re.I):
                if item.size > 1024 * 1024:
                    raise RuntimeError("LICENSE_FILE_SIZE")
                text = archive.extractfile(item).read().decode("utf-8", "replace")
                found.append(item.name)
                notice.append(f"\n--- {item.name} ---\n{text}\n")
        if not found:
            notice.append("\nThe package omits a standalone license file. See the exact upstream supplementary notice and/or the complete unmodified MPL corresponding source provided beside this notice.\n")
    if "MPL" in json.dumps(licenses):
        (OUTPUT / f"{name}-{version}.crate").write_bytes(body)
    return "".join(notice), {"name": name, "version": version, "source": url, "sha256": digest, "licenseFiles": found, "mplSourceIncluded": "MPL" in json.dumps(licenses)}


def gitiles(component):
    repo = next(p["value"] for p in component["properties"] if p["name"] == "cdx:skia:repositoryUrl")
    if not urllib.parse.urlparse(repo).hostname.endswith(".googlesource.com"):
        raise RuntimeError("UNEXPECTED_NOTICE_HOST")
    paths = {
        "expat": ["expat/COPYING"], "freetype": ["docs/FTL.TXT"],
        "brotli": ["LICENSE"], "harfbuzz": ["COPYING"], "icu": ["LICENSE"],
        "libjxl": ["LICENSE"], "highway": ["LICENSE"],
        "libjpeg-turbo": ["LICENSE.md", "README.ijg", "simd/nasm/LICENSE"],
        "libpng": ["LICENSE"], "libwebp": ["COPYING", "PATENTS", "AUTHORS"],
        "wuffs": ["LICENSE", "LICENSE-APACHE", "LICENSE-MIT"], "zlib": ["LICENSE", "zlib.h"],
    }[component["name"]]
    notice, sources = [], []
    for path in paths:
        url = f"{repo}/+/{component['version']}/{path}?format=TEXT"
        try:
            body = base64.b64decode(fetch(url, 4 * 1024 * 1024), validate=True)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                continue
            raise
        sources.append({"url": url, "sha256": hashlib.sha256(body).hexdigest()})
        notice.append(f"\n===== Native {component['name']} {component['version']} / {path} =====\nSource: {url}\n\n{body.decode('utf-8', 'replace')}\n")
    if not sources:
        raise RuntimeError("NATIVE_LICENSE_MISSING: " + component["name"])
    return "".join(notice), {"name": component["name"], "version": component["version"], "sources": sources}


if __name__ == "__main__":
    components = {}
    for platform in ["win32-x64", "linux-x64"]:
        sbom = json.loads((ROOT / f"server/reading/generated-pdf-visual/{platform}/sbom.cdx.json").read_text())
        for component in sbom["components"]:
            components[component["purl"]] = component
    registry = sorted((c for c in components.values() if c["purl"].startswith("pkg:cargo/") and c.get("hashes")), key=lambda c: (c["name"], c["version"]))
    native = sorted((c for c in components.values() if c["purl"].startswith("pkg:generic/")), key=lambda c: c["name"])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(crate, registry)) + list(pool.map(gitiles, native))
    skia_revision = "b94213a11b3a2edadfae89f0c57a7f4ab72772c9"
    skia_url = f"https://skia.googlesource.com/skia/+/{skia_revision}/LICENSE?format=TEXT"
    skia_license = base64.b64decode(fetch(skia_url), validate=True).decode()
    text = "Canvas 1.0.13 published native SBOM notices.\nCanvas source: https://github.com/Brooooooklyn/canvas/tree/00a115d9903647f116daf86eccd2c6ba36128371\nThe unmodified MPL source archives are included beside this file.\n\n===== Skia / local skia-fontations =====\nSource: " + skia_url + "\n" + skia_license + "\n"
    text += "\n".join(result[0] for result in results)
    extras = json.loads((OUTPUT / "upstream-notices.json").read_text())
    for extra in extras:
        text += f"\n===== Supplementary upstream notice {extra['repository']} {extra['revision']} =====\nSource: {extra['display_url']}\n" + extra["content"] + "\n"
    text = "\n".join(line.rstrip() for line in text.splitlines()) + "\n"
    (ROOT / "server/reading/pdf-canvas-notices.LICENSE").write_text(text, encoding="utf-8")
    manifest = {"canvasGitHead": "00a115d9903647f116daf86eccd2c6ba36128371", "skiaRevision": skia_revision, "components": [r[1] for r in results], "supplementaryNotices": [{"repository": e["repository"], "revision": e["revision"], "url": e["display_url"], "gitBlob": e["sha"]} for e in extras], "freetypeLicenseChoice": "FTL"}
    (OUTPUT / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"registry": len(registry), "native": len(native), "missingCrateLicenseFiles": [r[1]["name"] for r in results if "licenseFiles" in r[1] and not r[1]["licenseFiles"]]}))
