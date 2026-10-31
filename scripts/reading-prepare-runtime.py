"""Build a minimal, secret-free Node root in a NEW synthetic test directory.

No packages are installed and no running service is changed. Linux/root only.
Only Node and its absolute ldd dependencies are copied, never /etc or /opt.
"""
import os
import pathlib
import re
import shutil
import subprocess
import sys

if os.geteuid() != 0 or len(sys.argv) != 2:
    raise SystemExit('root and one NEW runtime directory required')
root = pathlib.Path(sys.argv[1])
if not root.is_absolute() or root.exists() or any(c.isspace() for c in str(root)):
    raise SystemExit('new absolute directory without whitespace required')
node = pathlib.Path(shutil.which('node')).resolve()
env = pathlib.Path(shutil.which('env')).resolve()
dependencies = subprocess.check_output(['ldd', str(node)], text=True) + subprocess.check_output(['ldd', str(env)], text=True)
libs = set(re.findall(r'(/[\w/+.\-]+)', dependencies))
if not libs or 'not found' in dependencies:
    raise SystemExit('unresolved runtime dependencies')
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
