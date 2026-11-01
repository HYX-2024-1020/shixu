"""Build a minimal, secret-free Node root in a NEW synthetic test directory.

No packages are installed and no running service is changed. Linux/root only.
Only Node/env and absolute ldd dependencies are copied, never /etc or /opt.
Optional --pdf-visual DIRECTORY also resolves the verified renderer's shared
libraries. It installs no packages and loads no system or user font directory.
"""
import os
import pathlib
import re
import shutil
import subprocess
import sys
import json
import hashlib

if os.geteuid() != 0 or len(sys.argv) not in (2, 4):
    raise SystemExit('root, NEW runtime directory, optional --pdf-visual DIRECTORY required')
root = pathlib.Path(sys.argv[1])
if not root.is_absolute() or root.exists() or any(c.isspace() for c in str(root)):
    raise SystemExit('new absolute directory without whitespace required')
node = pathlib.Path(shutil.which('node')).resolve()
env = pathlib.Path(shutil.which('env')).resolve()
dependencies = subprocess.check_output(['ldd', str(node)], text=True) + subprocess.check_output(['ldd', str(env)], text=True)
if len(sys.argv) == 4:
    renderer = pathlib.Path(sys.argv[3])
    if sys.argv[2] != '--pdf-visual' or not renderer.is_absolute() or renderer.is_symlink():
        raise SystemExit('absolute verified PDF visual directory required')
    manifest = json.loads((renderer / 'manifest.json').read_text())
    native = renderer / 'skia.node'
    if (manifest.get('protocol') != 'shixu-pdf-visual/2' or manifest.get('platform') != 'linux-x64'
            or manifest.get('pdfjs') != '6.2.108' or manifest.get('canvas') != '1.0.13'
            or native.is_symlink()
            or manifest['files']['skia.node'] != 'd069aa85c077131fec7e75eaabc2f33a1bfb61f7a626f2f371d778b426489e3b'
            or hashlib.sha256(native.read_bytes()).hexdigest() != manifest['files']['skia.node']):
        raise SystemExit('PDF native renderer integrity mismatch')
    dependencies += subprocess.check_output(['ldd', str(native)], text=True)
libs = set(re.findall(r'(/[\w/+.\-]+)', dependencies))
if not libs or 'not found' in dependencies:
    raise SystemExit('unresolved runtime dependencies')
if any(not lib.startswith(('/lib/', '/lib64/', '/usr/lib/', '/usr/lib64/')) for lib in libs):
    raise SystemExit('non-system shared library path rejected')
root.mkdir(mode=0o755)
shutil.copy2(node, root / 'node')
shutil.copy2(env, root / 'env')
for lib in libs:
    dest = root / lib.lstrip('/')
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(lib, dest)
for name in ['reader', 'input', 'scratch', 'proc', 'dev', 'sys', 'run', 'tmp']:
    (root / name).mkdir(mode=0o755)
os.chmod(root / 'tmp', 0o555)
print('minimal synthetic runtime prepared')
