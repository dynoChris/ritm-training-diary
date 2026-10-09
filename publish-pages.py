"""Publish only public assets to the existing GitHub Pages branch."""
from pathlib import Path
import hashlib
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
REPO = 'https://github.com/dynoChris/ritm-training-diary.git'
PUBLIC_FILES = ['index.html', 'styles.css', 'app.js', 'firebase-cloud.js', 'runtime-config.js', 'assets/favicon.svg']


def main():
    subprocess.run(['node', '--check', str(ROOT / 'app.js')], check=True)
    subprocess.run(['node', '--input-type=module', '--check'], input=(ROOT / 'firebase-cloud.js').read_bytes(), check=True)
    with tempfile.TemporaryDirectory(prefix='ritm-pages-') as folder:
        checkout = Path(folder) / 'site'
        subprocess.run(['git', 'clone', '--depth', '1', '--branch', 'gh-pages', REPO, str(checkout)], check=True)
        for filename in PUBLIC_FILES:
            target = checkout / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / filename).read_bytes())
        release = hashlib.sha256(b''.join((ROOT / filename).read_bytes() for filename in PUBLIC_FILES)).hexdigest()[:12]
        html = (checkout / 'index.html').read_text(encoding='utf-8')
        for filename in ['styles.css', 'app.js', 'runtime-config.js']:
            html = html.replace('"' + filename + '"', '"' + filename + '?v=' + release + '"')
        (checkout / 'index.html').write_text(html, encoding='utf-8')
        client = (checkout / 'app.js').read_text(encoding='utf-8').replace("import('./firebase-cloud.js')", "import('./firebase-cloud.js?v=" + release + "')")
        (checkout / 'app.js').write_text(client, encoding='utf-8')
        (checkout / '.nojekyll').touch()
        subprocess.run(['git', 'add', '.'], cwd=checkout, check=True)
        if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=checkout).returncode == 0:
            print('Public files are already up to date.')
            return
        subprocess.run(['git', 'commit', '-m', 'Update published training diary'], cwd=checkout, check=True)
        subprocess.run(['git', 'push', 'origin', 'gh-pages'], cwd=checkout, check=True)
    print('GitHub Pages publication started: https://dynochris.github.io/ritm-training-diary/')


if __name__ == '__main__':
    main()
