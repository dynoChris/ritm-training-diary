"""Local, dependency-free server for the Ritm training diary."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DEFAULT_STATE = {
    'version': 1,
    'revision': 0,
    'types': [
        {'id': 'push-ups', 'name': 'Отжимания от пола', 'icon': 'push'},
        {'id': 'pull-ups', 'name': 'Подтягивания на турнике', 'icon': 'pull'},
        {'id': 'walking', 'name': 'Ходьба', 'icon': 'walk'},
    ],
    'workouts': [],
}
MAX_BODY = 4 * 1024 * 1024
LOCK = threading.Lock()


def validate_state(value):
    if not isinstance(value, dict):
        raise ValueError('Некорректный формат данных.')
    revision = value.get('revision')
    if type(revision) is not int or revision < 0:
        raise ValueError('Некорректная версия данных.')
    types = value.get('types')
    workouts = value.get('workouts')
    if not isinstance(types, list) or not 1 <= len(types) <= 100:
        raise ValueError('Допустимо от 1 до 100 видов тренировок.')
    if not isinstance(workouts, list) or len(workouts) > 20000:
        raise ValueError('Допустимо до 20 000 записей.')
    type_ids, names, workout_ids = set(), set(), set()
    normalized_types, normalized_workouts = [], []
    for item in types:
        if not isinstance(item, dict):
            raise ValueError('Некорректный вид тренировки.')
        identifier, name, icon = item.get('id'), item.get('name'), item.get('icon')
        if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,80}', identifier) or identifier in type_ids:
            raise ValueError('Некорректный идентификатор вида тренировки.')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40 or name.strip().casefold() in names:
            raise ValueError('Названия должны быть уникальными и содержать до 40 символов.')
        if icon not in ('push', 'pull', 'walk'):
            raise ValueError('Неизвестная иконка.')
        type_ids.add(identifier)
        names.add(name.strip().casefold())
        normalized_types.append({'id': identifier, 'name': name.strip(), 'icon': icon})
    for item in workouts:
        if not isinstance(item, dict):
            raise ValueError('Некорректная запись тренировки.')
        identifier, date, type_id, note = item.get('id'), item.get('date'), item.get('typeId'), item.get('note')
        if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,80}', identifier) or identifier in workout_ids:
            raise ValueError('Некорректный идентификатор тренировки.')
        if type_id not in type_ids:
            raise ValueError('Неизвестный вид тренировки.')
        if not isinstance(date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
            raise ValueError('Некорректная дата.')
        try:
            datetime.date.fromisoformat(date)
        except ValueError as error:
            raise ValueError('Некорректная дата.') from error
        if not isinstance(note, str) or len(note) > 500:
            raise ValueError('Описание должно содержать до 500 символов.')
        workout_time = item.get('time')
        estimated_time = item.get('timeEstimated', False)
        if workout_time is not None and (not isinstance(workout_time, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', workout_time)):
            raise ValueError('Время должно быть в формате ЧЧ:ММ, от 00:00 до 23:59.')
        if type(estimated_time) is not bool or (estimated_time and workout_time is None):
            raise ValueError('Некорректная отметка примерного времени.')
        workout_ids.add(identifier)
        record = {'id': identifier, 'date': date, 'typeId': type_id, 'note': note.strip()}
        if workout_time is not None:
            record.update({'time': workout_time, 'timeEstimated': estimated_time})
        normalized_workouts.append(record)
    return {'version': 1, 'revision': revision, 'types': normalized_types, 'workouts': normalized_workouts}


def atomic_save(path, value):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


class Handler(BaseHTTPRequestHandler):
    def allowed_request(self):
        port = self.server.server_port
        allowed_hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if self.headers.get('Host') not in allowed_hosts:
            self.json_response(403, {'error': 'Разрешён только локальный доступ.'})
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://{host}' for host in allowed_hosts}:
            self.json_response(403, {'error': 'Запрос с другого сайта запрещён.'})
            return False
        return True

    def json_response(self, code, value):
        self.send_bytes(code, json.dumps(value, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

    def send_bytes(self, code, body, content_type):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'")
        self.end_headers()
        self.wfile.write(body)

    def read_state(self):
        return validate_state(json.loads(self.server.data_path.read_text(encoding='utf-8')))

    def do_GET(self):
        if not self.allowed_request():
            return
        route = urlsplit(self.path).path
        if route == '/api/state':
            try:
                with LOCK:
                    self.json_response(200, self.read_state())
            except (OSError, ValueError, TypeError) as error:
                print(f'Cannot read data file: {error}', flush=True)
                self.json_response(500, {'error': 'Не удалось прочитать файл данных. Он сохранён без изменений.'})
            return
        files = {
            '/': ('index.html', 'text/html; charset=utf-8'),
            '/index.html': ('index.html', 'text/html; charset=utf-8'),
            '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
            '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
            '/runtime-config.js': ('runtime-config.js', 'text/javascript; charset=utf-8'),
            '/assets/favicon.svg': ('assets/favicon.svg', 'image/svg+xml'),
        }
        if route not in files:
            self.json_response(404, {'error': 'Страница не найдена.'})
            return
        filename, content_type = files[route]
        try:
            self.send_bytes(200, (ROOT / filename).read_bytes(), content_type)
        except OSError:
            self.json_response(404, {'error': 'Файл сайта не найден.'})

    def do_PUT(self):
        if not self.allowed_request():
            return
        if urlsplit(self.path).path != '/api/state':
            self.json_response(404, {'error': 'Страница не найдена.'})
            return
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            self.json_response(415, {'error': 'Ожидается JSON.'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                self.json_response(413, {'error': 'Превышен допустимый размер данных.'})
                return
            value = validate_state(json.loads(self.rfile.read(length)))
            with LOCK:
                current = self.read_state()
                if value['revision'] != current['revision']:
                    self.json_response(409, {'error': 'Данные изменились в другой вкладке.', 'state': current})
                    return
                value['revision'] += 1
                atomic_save(self.server.data_path, value)
                self.json_response(200, value)
        except (ValueError, TypeError, UnicodeError) as error:
            self.json_response(400, {'error': str(error)})
        except OSError as error:
            print(f'Cannot save data file: {error}', flush=True)
            self.json_response(500, {'error': 'Не удалось сохранить файл. Проверь свободное место и доступ к папке.'})


def main():
    parser = argparse.ArgumentParser(description='Ritm local training diary')
    parser.add_argument('--port', type=int, default=8791)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--open', action='store_true', help='Open the diary in your browser')
    options = parser.parse_args()
    options.data_dir.mkdir(parents=True, exist_ok=True)
    path = options.data_dir / 'workouts.json'
    if not path.exists():
        atomic_save(path, DEFAULT_STATE)
    # Existing files must never be silently reset if malformed.
    try:
        validate_state(json.loads(path.read_text(encoding='utf-8')))
    except (OSError, ValueError, TypeError) as error:
        print(f'Cannot read {path}: {error}. The original file has not been changed.', flush=True)
        raise SystemExit(1)
    try:
        # Windows SO_REUSEADDR can let two applications bind the same port.
        # Refuse an occupied port instead of serving an unrelated local app.
        ThreadingHTTPServer.allow_reuse_address = os.name != 'nt'
        server = ThreadingHTTPServer(('127.0.0.1', options.port), Handler)
    except OSError as error:
        print(f'Cannot start local server on port {options.port}: {error}', flush=True)
        print(f'If the diary is already running, open http://127.0.0.1:{options.port} .', flush=True)
        raise SystemExit(1)
    server.data_path = path
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'Ritm is ready: {url}', flush=True)
    print(f'Data file: {path}', flush=True)
    print('Keep this window open. Press Ctrl+C to stop.', flush=True)
    if options.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
