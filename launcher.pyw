"""Open the local diary, starting its server in the background when needed."""
import ctypes
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent
URL = 'http://127.0.0.1:8791'


def ready():
    try:
        with urlopen(URL + '/', timeout=1) as response:
            return '<title>Ритм — дневник тренировок</title>' in response.read().decode('utf-8')
    except (URLError, OSError, UnicodeError):
        return False


def main():
    if not ready():
        (ROOT / 'data').mkdir(exist_ok=True)
        with (ROOT / 'data' / 'server.log').open('ab') as log:
            process = subprocess.Popen(
                [sys.executable, '-u', str(ROOT / 'server.py')], cwd=ROOT,
                stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if ready():
                break
            if process.poll() is not None:
                # A simultaneous launcher may have started the server first.
                time.sleep(.3)
                if ready():
                    break
                raise RuntimeError('Не удалось запустить дневник. Подробности в data/server.log. Попробуй «Запустить.cmd».')
            time.sleep(.15)
        else:
            raise RuntimeError('Сервер не ответил. Попробуй «Запустить.cmd».')
    webbrowser.open(URL)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        ctypes.windll.user32.MessageBoxW(None, str(error), 'Ритм — ошибка запуска', 0x10)
