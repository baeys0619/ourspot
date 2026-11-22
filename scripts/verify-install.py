#!/usr/bin/env python3
"""격리 설치를 검사하고 합성 장소·일정·코멘트의 MySQL 재시작 전후 상태를 비교한다."""
import argparse
import getpass
import http.client
import json
import re
import secrets
import subprocess
import time
import warnings
from datetime import datetime
from http.cookies import SimpleCookie
from urllib.parse import unquote
from zoneinfo import ZoneInfo


def docker(*args, data=None):
    result = subprocess.run(['docker', *args], input=data, text=True, capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError(f'Docker {args[0]} failed ({result.returncode})')
    return result.stdout.strip()


def check(condition, label):
    if not condition:
        raise RuntimeError(label)
    print('PASS ' + label, flush=True)


def verify(install_id, passwords):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,35}', install_id):
        raise RuntimeError('Invalid isolated installation ID')
    prefix = f'ourspot-install-{install_id}'
    db = f'{prefix}-db'
    redis = f'{prefix}-redis'
    binding = docker('port', f'{prefix}-proxy', '80/tcp')
    if not re.fullmatch(r'127\.0\.0\.1:[0-9]+', binding):
        raise RuntimeError('Expected a single local proxy port')
    port = int(binding.split(':')[1])

    def request(path, method='GET', expected=200, *, cookie=None, payload=None):
        headers = {'Cookie': cookie} if cookie else {}
        body = None
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            body = json.dumps(payload).encode()
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
        try:
            conn.request(method, path, body, headers)
            response = conn.getresponse()
            content = response.read()
            if response.status != expected:
                raise RuntimeError(f'{method} {path}: HTTP {response.status}, expected {expected}')
            return content, response.getheader('Set-Cookie')
        finally:
            conn.close()

    mounts = docker('inspect', '-f', '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Type}} {{.Name}}{{end}}{{end}}', db)
    check(mounts == f'volume {prefix}-db-data', f'{db}: {mounts} -> /var/lib/mysql')
    services = {
        'db': '', 'redis': '', 'proxy': '', 'front': '/',
        'user-api': '/api/auth/health', 'place-api': '/api/places/health',
    }
    for service, path in services.items():
        state = docker('inspect', '-f', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}', f'{prefix}-{service}')
        healthy = state == 'running healthy'
        if path and state == 'running no-healthcheck':
            entrypoint = docker('inspect', '-f', '{{json .Config.Entrypoint}}', f'{prefix}-{service}')
            healthy = json.loads(entrypoint) == ['/run/ourspot-qemu-x86_64']
        check(healthy, f'{service}: {state}')
        if path:
            body, _ = request(path)
            if service == 'front':
                check(b'<html' in body, 'Nginx -> Apache: GET / 200 HTML')
            else:
                data = json.loads(body)['data']
                check(data == dict(service=service, status='ok', mysql='ok', redis='ok'), f'{path}: HTTP 200, MySQL and Redis OK')

    for path in ('/api/auth/me', '/api/places'):
        request(path, expected=401)
    cookies, keys, users = [], [], []
    for name, password in zip(('a', 'b'), passwords, strict=True):
        email = f'user_{name}@example.test'
        body, header = request('/api/auth/login', 'POST', payload={'email': email, 'password': password})
        user = json.loads(body)['data']['user']
        check(user['email'] == email, f'account {name.upper()}: POST /api/auth/login 200')
        session = SimpleCookie(header)['ourspot.sid']
        cookie = f'ourspot.sid={session.coded_value}'
        session_id = re.fullmatch(r's:([A-Za-z0-9_-]+)\.[A-Za-z0-9+/=]+', unquote(session.value))
        check(session_id is not None, f'account {name.upper()}: signed session received')
        key = 'ourspot:sess:' + session_id[1]
        ttl = int(docker('exec', '-i', redis, 'redis-cli', '--raw', '-x', 'TTL', data=key))
        check(0 < ttl <= 86400, f'account {name.upper()}: Redis TTL={ttl}s')
        me, _ = request('/api/auth/me', cookie=cookie)
        places, _ = request('/api/places', cookie=cookie)
        check(json.loads(me)['data']['user'] == user and isinstance(json.loads(places)['data']['places'], list),
              f'account {name.upper()}: User API /me 200 and Place API list 200 with the same cookie')
        cookies.append(cookie)
        keys.append(key)
        users.append(user)
    check(keys[0] != keys[1] and users[0]['id'] != users[1]['id'] and users[0]['couple_id'] == users[1]['couple_id'],
          'A and B have separate sessions and one shared couple')

    # 재실행마다 별도 합성 행을 만들고, 아래에서 해당 행의 ID와 내용을 비교한다.
    title = 'OURSPOT install check ' + secrets.token_hex(4)
    day = datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
    body, _ = request('/api/places', 'POST', 201, cookie=cookies[0], payload={'title': title, 'category': '카페'})
    place = json.loads(body)['data']['place']
    path = f"/api/places/{place['id']}"
    request(path, 'PATCH', cookie=cookies[0], payload={'planned_date': day, 'expected_updated_at': place['updated_at']})
    comment_body, _ = request(path + '/comments/before', 'PUT', cookie=cookies[1], payload={'content': '설치 검증용 합성 코멘트'})
    comment = json.loads(comment_body)['data']['comment']

    def snapshot():
        return tuple(json.loads(request(p, cookie=cookies[1])[0])['data'] for p in
                     (path, path + '/comments', f'/api/places?planned_date={day}'))

    # 격리 MySQL을 재시작하기 전후로 상세·날짜별 목록·코멘트 응답을 비교한다. 건수 외에 ID와 내용이 같은지도 확인한다.
    before = snapshot()
    check(before[0]['place']['title'] == title and before[0]['place']['planned_date'] == day and
          before[1]['comments'] == [comment] and before[0]['place'] in before[2]['places'],
          f"A saved a place and date, B viewed both and wrote comment (place={place['id']}, comment={comment['id']})")
    started = time.monotonic()
    docker('restart', db)
    for _ in range(90):
        if docker('inspect', '-f', '{{.State.Health.Status}}', db) == 'healthy':
            break
        time.sleep(1)
    else:
        raise RuntimeError('Isolated MySQL did not become healthy again')
    check(before == snapshot(), f'MySQL restart + healthy in {time.monotonic() - started:.1f}s; same place, schedule and comment')

    for name, cookie, key in zip(('A', 'B'), cookies, keys, strict=True):
        request('/api/auth/logout', 'POST', 204, cookie=cookie)
        check(docker('exec', '-i', redis, 'redis-cli', '--raw', '-x', 'TTL', data=key) == '-2',
              f'account {name}: logout 204 and Redis session removed')
        for path in ('/api/auth/me', '/api/places'):
            request(path, expected=401, cookie=cookie)
    check(True, 'both APIs reject the old cookies (401)')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('isolated_id', help='scripts/up.sh --isolated에 사용한 ID')
    args = parser.parse_args()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            passwords = [getpass.getpass(f'격리 사용자 {name} 비밀번호: ') for name in ('A', 'B')]
        verify(args.isolated_id, passwords)
    except (OSError, ValueError, LookupError, TypeError, http.client.HTTPException,
            subprocess.SubprocessError, getpass.GetPassWarning):
        parser.exit(1, 'FAIL 격리 검증 오류. 마지막 PASS 단계를 확인하세요.\n')
    except RuntimeError as error:
        parser.exit(1, f'FAIL {error}\n')


if __name__ == '__main__':
    main()
