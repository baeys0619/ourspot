#!/usr/bin/env python3
"""Ubuntu 대화형 터미널에서 운영 계정 하나의 세션만 검증한다."""
import getpass
import http.client
import json
import re
import subprocess
import sys
import warnings
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from urllib.parse import unquote


def request(path, method='GET', *, cookie=None, payload=None):
    # 로컬 Nginx만 사용한다. 리다이렉트를 따라가거나 응답 헤더를 출력하지 않는다.
    conn = http.client.HTTPConnection('127.0.0.1', 8080, timeout=10)
    headers = {}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    if cookie is not None:
        headers['Cookie'] = cookie
    try:
        conn.request(method, path, payload, headers)
        response = conn.getresponse()
        body = response.read(4 * 1024 * 1024 + 1)
        return response.status, response.headers.get_all('Set-Cookie', []), body
    finally:
        conn.close()


def redis(*args, key=None):
    # 키가 필요한 경우 표준입력으로만 전달하고 Redis의 출력·오류 원문은 폐기한다.
    result = subprocess.run(['docker', 'exec', '-i', 'ourspot-redis', 'redis-cli', '--raw', *args],
                            input=key, capture_output=True, timeout=10, check=True)
    return result.stdout.strip()


def require(condition, label):
    if not condition:
        raise RuntimeError(label)
    print('PASS ' + label, flush=True)


def verify(email, password):
    for path in ('/api/auth/me', '/api/places'):
        status, _, body = request(path)
        require(status == 401 and json.loads(body)['error']['code'] == 'AUTH_REQUIRED',
                f'GET {path} without cookie: 401 AUTH_REQUIRED')
    status, set_cookies, login_body = request(
        '/api/auth/login', 'POST', payload=json.dumps({'email': email, 'password': password}).encode())
    require(status == 200, 'POST /api/auth/login: 200')
    cookies = SimpleCookie()
    for value in set_cookies:
        cookies.load(value)
    session_cookie = cookies['ourspot.sid']
    cookie = 'ourspot.sid=' + session_cookie.coded_value
    try:
        signed = re.fullmatch(r's:([A-Za-z0-9_-]+)\.[A-Za-z0-9+/=]+', unquote(session_cookie.value))
        require(signed is not None, 'signed session cookie received (value omitted)')
        key = b'ourspot:sess:' + signed[1].encode('ascii')
        ttl = int(redis('-x', 'TTL', key=key))
        require(0 < ttl <= 86400, f'Redis session TTL: {ttl}s')
        # 한 번 로그인해 받은 쿠키를 두 API에 그대로 보낸다. 쿠키 없이 거부되는 경로가 각각 같은 세션으로 열리는지 확인한다.
        status, _, body = request('/api/auth/me', cookie=cookie)
        login_user = json.loads(login_body)['data']['user']
        require(status == 200 and json.loads(body)['data']['user'] == login_user,
                'GET /api/auth/me with same cookie: 200, login identity matches')
        status, _, body = request('/api/places', cookie=cookie)
        require(status == 200 and isinstance(json.loads(body)['data']['places'], list),
                'GET /api/places with same cookie: 200, place list returned')
    finally:
        status, _, _ = request('/api/auth/logout', 'POST', cookie=cookie)
        require(status == 204, 'POST /api/auth/logout: 204')
    ttl = int(redis('-x', 'TTL', key=key))
    require(ttl == -2, 'Redis session TTL after logout: -2 (key absent)')
    for path in ('/api/auth/me', '/api/places'):
        status, _, body = request(path, cookie=cookie)
        require(status == 401 and json.loads(body)['error']['code'] == 'AUTH_REQUIRED',
                f'GET {path} with old cookie: 401 AUTH_REQUIRED')


def main():
    if not sys.stdin.isatty():
        print('Ubuntu 대화형 터미널에서 실행하세요.', file=sys.stderr)
        return 1
    try:
        require(redis('PING') == b'PONG', 'Redis PING')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            email = getpass.getpass('운영 사용자 A 또는 B 이메일 (비표시): ').strip()
            password = getpass.getpass('운영 비밀번호 (비표시): ')
        print(datetime.now(timezone(timedelta(hours=9))).isoformat(timespec='seconds'), flush=True)
        verify(email, password)
    except KeyboardInterrupt:
        return 130
    except (OSError, ValueError, LookupError, RuntimeError, subprocess.SubprocessError,
            http.client.HTTPException, getpass.GetPassWarning):
        print('FAIL 운영 세션 확인 중단. 마지막 PASS 단계와 종료 상태를 확인하세요.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
