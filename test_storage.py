"""Exercise real HTTP storage, persistence and conflicting tabs in temporary files."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='ritm-test-')
        self.process = None
        self.start_server()

    def start_server(self):
        self.process = subprocess.Popen(
            [sys.executable, str(Path(__file__).with_name('server.py')), '--port', '0', '--data-dir', self.folder.name],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
        )
        self.url = self.process.stdout.readline().strip().split('Ritm is ready: ')[1]
        for _ in range(30):
            try:
                self.request()
                return
            except URLError:
                time.sleep(.1)
        self.fail('Server did not become ready')

    def stop_server(self):
        self.process.terminate()
        self.process.wait(timeout=5)
        self.process.stdout.close()

    def tearDown(self):
        self.stop_server()
        self.folder.cleanup()

    def request(self, value=None, origin=None, route='/api/state'):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        request = Request(self.url + route, data=json.dumps(value).encode() if value is not None else None,
                          headers=headers, method='PUT' if value is not None else 'GET')
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_save_edit_delete_and_restart(self):
        _, state = self.request()
        state['workouts'].append({'id': 'test-record', 'date': '2026-10-09', 'time': '20:35', 'timeEstimated': True, 'typeId': 'push-ups', 'note': '3 подхода по 15'})
        status, saved = self.request(state)
        self.assertEqual(status, 200)
        disk = json.loads((Path(self.folder.name) / 'workouts.json').read_text(encoding='utf-8'))
        self.assertEqual(disk, saved)
        self.stop_server()
        self.start_server()
        self.assertEqual(self.request()[1], saved)
        saved['workouts'][0].update({'typeId': 'walking', 'date': '2026-10-10', 'time': '21:10', 'timeEstimated': False, 'note': 'Полчаса пешком'})
        status, saved = self.request(saved)
        self.assertEqual(status, 200)
        self.assertEqual(saved['workouts'][0]['typeId'], 'walking')
        self.assertEqual(saved['workouts'][0]['time'], '21:10')
        self.assertFalse(saved['workouts'][0]['timeEstimated'])
        saved['workouts'] = []
        self.assertEqual(self.request(saved)[1]['workouts'], [])

    def test_conflicting_tabs_do_not_overwrite(self):
        _, first = self.request()
        second = copy.deepcopy(first)
        first['types'].append({'id': 'running', 'name': 'Бег', 'icon': 'walk'})
        status, saved = self.request(first)
        self.assertEqual(status, 200)
        status, conflict = self.request(second)
        self.assertEqual(status, 409)
        self.assertEqual(conflict['state'], saved)
        self.assertEqual(self.request()[1], saved)

    def test_invalid_input_preserves_file(self):
        _, original = self.request()
        invalid = copy.deepcopy(original)
        invalid['workouts'] = [{'id': 'bad', 'date': '2026-02-30', 'typeId': 'walking', 'note': ''}]
        self.assertEqual(self.request(invalid)[0], 400)
        invalid['workouts'][0]['date'] = '2026-02-20'
        invalid['workouts'][0]['note'] = 'x' * 501
        self.assertEqual(self.request(invalid)[0], 400)
        self.assertEqual(self.request()[1], original)

    def test_external_site_and_private_files_are_blocked(self):
        _, state = self.request()
        self.assertEqual(self.request(state, origin='https://example.com')[0], 403)
        self.assertEqual(self.request(route='/data/workouts.json')[0], 404)
        self.assertEqual(self.request(route='/server.py')[0], 404)

    def test_old_records_and_time_validation(self):
        _, state = self.request()
        state['workouts'] = [{'id': 'legacy', 'date': '2026-09-12', 'typeId': 'walking', 'note': '7000'}]
        status, original = self.request(state)
        self.assertEqual(status, 200)
        self.assertNotIn('time', original['workouts'][0])
        for invalid_time in ['24:00', '20:60', '7:05', '', True, '20:00:00']:
            invalid = copy.deepcopy(original)
            invalid['workouts'][0]['time'] = invalid_time
            self.assertEqual(self.request(invalid)[0], 400)
            self.assertEqual(self.request()[1], original)
        valid = copy.deepcopy(original)
        valid['workouts'][0].update({'time': '22:00', 'timeEstimated': True})
        status, saved = self.request(valid)
        self.assertEqual(status, 200)
        self.assertEqual(saved['workouts'][0]['time'], '22:00')
        self.assertTrue(saved['workouts'][0]['timeEstimated'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
