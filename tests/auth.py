#!/usr/bin/env python3
"""운영 리소스와 분리된 Docker 환경에서 실제 로그인과 Redis 공유를 검증한다."""
import json
import os
import re
import secrets
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote
from urllib.request import Request, urlopen

from places import verify_places
from schedules import verify_schedules

ROOT = Path(__file__).resolve().parents[1]
IMAGES = dict(line.split('=', 1) for line in (ROOT / 'infra/images.env').read_text().splitlines()
              if line and not line.startswith('#'))
NETWORK = 'ourspot-auth-' + secrets.token_hex(5)
TEST_LABEL = 'io.ourspot.auth-test=' + NETWORK


def docker(*args, stdin=None):
    result = subprocess.run(['docker', *args], input=stdin, text=True, capture_output=True, timeout=120)
    if result.returncode:
        # Docker/SQL 출력 또는 입력값을 검사 실패 로그에 남기지 않는다.
        raise RuntimeError(f'Docker {args[0]} failed (exit {result.returncode})')
    return result.stdout.strip()


def check(label, condition):
    if not condition:
        raise AssertionError(label)
    print('PASS ' + label, flush=True)


def env_file(directory, name, values):
    path = Path(directory) / name
    path.touch(mode=0o600, exist_ok=False)
    path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
    return str(path)


def wait_for(label, ready):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if ready():
            return
        time.sleep(1)
    raise RuntimeError(f'{label} readiness timeout')


def verify(env_dir):
    def name(service):
        return NETWORK + '-' + service

    def run(service, image, *options, command=()):
        docker('run', '-d', '--name', name(service), '--label', TEST_LABEL, '--network', NETWORK,
               '--network-alias', 'ourspot-' + service, *options, image, *command)

    def healthy(service):
        status = docker('inspect', '-f', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}',
                        name(service))
        if status.startswith(('exited', 'dead')):
            raise RuntimeError(f'{service} exited during startup')
        return status == 'running healthy'

    def sql(query):
        return docker('exec', name('db'), 'sh', '-c',
                      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 '
                      '--default-character-set=utf8mb4 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "$1"', 'sh', query)

    def redis(*args):
        return docker('exec', name('redis'), 'redis-cli', '--raw', *args)

    def redis_sets():
        match = re.search(r'^cmdstat_set:calls=(\d+)', redis('INFO', 'commandstats'), re.MULTILINE)
        return int(match[1]) if match else 0

    def cache(user_id, expire=False):
        # 임시 Redis에서 해당 사용자 키의 개수와 TTL만 내보낸다. 쿠키와 키는 출력하지 않는다.
        return redis('EVAL', '''
            local cursor, count, ttl = "0", 0, -2
            repeat
              local batch = redis.call("SCAN", cursor, "MATCH", "ourspot:sess:*")
              cursor = batch[1]
              for _, key in ipairs(batch[2]) do
                local value = redis.call("GET", key)
                if value then
                  local data = cjson.decode(value)
                  if data.userId == tonumber(ARGV[1]) and data.coupleId == "couple_001" then
                    count = count + 1
                    ttl = redis.call("TTL", key)
                    if ARGV[2] == "1" then
                      data.expiresAt = 1
                      redis.call("SET", key, cjson.encode(data), "KEEPTTL")
                    end
                  end
                end
              end
            until cursor == "0"
            return {count, ttl}
        ''', '0', str(user_id), str(int(expire))).splitlines()

    db_password = secrets.token_hex(32)
    session_secret = secrets.token_hex(48)
    db_env = env_file(env_dir, 'db.env', {
        'MYSQL_DATABASE': 'ourspot', 'MYSQL_USER': 'ourspot_app', 'MYSQL_PASSWORD': db_password,
        'MYSQL_ROOT_PASSWORD': secrets.token_hex(32),
    })
    api_env = env_file(env_dir, 'api.env', {
        'DB_HOST': 'ourspot-db', 'DB_NAME': 'ourspot', 'DB_USER': 'ourspot_app', 'DB_PASSWORD': db_password,
        'REDIS_URL': 'redis://ourspot-redis:6379/0', 'SESSION_SECRET': session_secret, 'COOKIE_SECURE': 'false',
    })
    run('db', IMAGES['MYSQL_IMAGE'], '--env-file', db_env, '--tmpfs', '/var/lib/mysql:rw,size=536870912',
        '--mount', f'type=bind,src={ROOT / "database/init"},dst=/docker-entrypoint-initdb.d,readonly',
        '--health-cmd', 'MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h127.0.0.1 '
        '-u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "SELECT COUNT(*) FROM users"',
        '--health-interval', '2s', '--health-retries', '30',
        command=('--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci', '--default-time-zone=+00:00'))
    run('redis', IMAGES['REDIS_IMAGE'], '--tmpfs', '/data',
        '--health-cmd', 'redis-cli ping | grep -x PONG', '--health-interval', '2s',
        command=('redis-server', '--save', '', '--appendonly', 'no'))
    wait_for('MySQL', lambda: healthy('db'))
    wait_for('Redis', lambda: healthy('redis'))

    seed = ('run', '--rm', '-i', '--label', TEST_LABEL, '--network', NETWORK, '--env-file', api_env,
            'ourspot-user-api:0.2', 'node', 'seed-users.cjs')
    check('blank schema is detected', docker(*seed, '--check') == 'empty')
    sql('ALTER TABLE users AUTO_INCREMENT = 9')
    password_a = ' ' + secrets.token_urlsafe(24) + ' '
    password_b = secrets.token_hex(30) + '한' * 4
    started = time.monotonic()
    result = docker(*seed, stdin=f'{password_a}\n{password_b}\n')
    check(f'ARM64 bcrypt seed cost 12 ({time.monotonic() - started:.2f}s with Docker startup)', result == 'created')
    check('two cost-12 hashes with independent salts; other tables empty', sql(
        "SELECT COUNT(*), COUNT(DISTINCT LEFT(password_hash,29)), "
        "SUM(LEFT(password_hash,7)='$2b$12$'), (SELECT COUNT(*) FROM places), "
        "(SELECT COUNT(*) FROM place_comments) FROM users") == '2\t2\t2\t0\t0')
    check('seed rerun preserves accounts', docker(*seed, '--check') == 'ready' and
          docker(*seed, stdin=f'{secrets.token_hex(32)}\n{secrets.token_hex(32)}\n') == 'ready')

    for service in ('user-api', 'place-api'):
        image = f'ourspot-{service}:0.2'
        if service == 'place-api':
            image = os.environ.get('OURSPOT_PLACE_TEST_IMAGE', image)
        run(service, image, '--env-file', api_env)
    run('front', 'ourspot-front:0.1')
    run('proxy', IMAGES['NGINX_IMAGE'], '--publish', '127.0.0.1::80',
        '--mount', f'type=bind,src={ROOT / "infra/nginx/default.conf"},dst=/etc/nginx/conf.d/default.conf,readonly')
    port = docker('port', name('proxy'), '80/tcp').rsplit(':', 1)[1]
    for service in ('user-api', 'place-api'):
        wait_for(service, lambda: healthy(service))

    def http(path, method='GET', cookie=None, payload=None, headers=None):
        headers = dict(headers or {})
        if cookie:
            headers['Cookie'] = cookie
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            if not isinstance(payload, bytes):
                payload = json.dumps(payload).encode()
        request = Request(f'http://127.0.0.1:{port}{path}', data=payload, headers=headers, method=method)
        try:
            response = urlopen(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            body = response.read()
            return response.status, json.loads(body) if body else None, response.headers.get('Set-Cookie')

    login_path, logout_path, me, places = '/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/places'
    email_a, email_b = 'user_a@example.test', 'user_b@example.test'

    def login(email, password, cookie=None):
        return http(login_path, 'POST', cookie, {'email': email, 'password': password})

    def session_header(header):
        return 'ourspot.sid=' + SimpleCookie(header)['ourspot.sid'].value

    def is_error(response, status, code):
        return response[0] == status and response[1].get('error', {}).get('code') == code and response[2] is None

    check('two independently routed APIs', all(http(path + '/health')[1]['data']['service'] == service
          for path, service in (('/api/auth', 'user-api'), (places, 'place-api'))))
    check('anonymous protected APIs return 401', all(is_error(http(path), 401, 'AUTH_REQUIRED') for path in (me, places)))
    wrong = login(email_a, secrets.token_hex(32))
    check('unknown email and incorrect password share one response', is_error(wrong, 401, 'AUTH_FAILED') and
          all(wrong == login(email, password_a) for email in ('unknown@example.test', 'usér_a@example.test')))
    check('invalid JSON, email, missing password, 73+ UTF-8 bytes and forged identity', all(
        is_error(http(login_path, 'POST', payload=payload), status, code) for payload, status, code in [
            (b'{', 400, 'BAD_REQUEST'), ({'email': email_a}, 422, 'VALIDATION_ERROR'),
            ({'email': 'not-an-email', 'password': password_a}, 422, 'VALIDATION_ERROR'),
            ({'email': email_a, 'password': '한' * 25}, 422, 'VALIDATION_ERROR'),
            ({'email': email_a, 'password': password_a, 'couple_id': 'other'}, 403, 'FORBIDDEN'),
        ]))

    started = time.monotonic()
    set_count = redis_sets()
    a = login('  ' + email_a.upper(), password_a)
    b = login(email_b, password_b)
    check(f'A/B login via proxy ({(time.monotonic() - started) / 2:.2f}s/auth HTTP mean)', a[0] == b[0] == 200)
    check('only one Redis SET per successful login', redis_sets() == set_count + 2)
    users = [response[1]['data']['user'] for response in (a, b)]
    a_id, b_id = (user['id'] for user in users)
    a_cookie, b_cookie = (session_header(response[2]) for response in (a, b))
    check('actual numeric IDs and response fields', a_id != b_id and min(a_id, b_id) >= 9 and
          all(set(user) == {'id', 'email', 'display_name', 'couple_id'} and user['couple_id'] == 'couple_001' for user in users))
    morsel = SimpleCookie(a[2])['ourspot.sid']
    remaining = (parsedate_to_datetime(morsel['expires']) - datetime.now(timezone.utc)).total_seconds()
    check('cookie flags and absolute expiry', morsel['httponly'] and morsel['samesite'].lower() == 'lax' and
          morsel['path'] == '/' and not morsel['secure'] and not morsel['domain'] and 86390 < remaining <= 86400)
    cached, ttl_before = map(int, cache(a_id))
    check('Redis stores real user with a 24-hour TTL before first API read', cached == 1 and 86390 < ttl_before <= 86400)
    check('same cookies authenticate in both API containers', a_cookie != b_cookie and all(
          http(me, cookie=cookie)[1]['data']['user'] == user and
          http(places, cookie=cookie)[:2] == (200, {'data': {'places': [], 'counts': {'unvisited': 0, 'visited': 0}}})
          for cookie, user in zip((a_cookie, b_cookie), users)))

    sql(f"""INSERT INTO places (couple_id,added_by,title,category,planned_date,visit_order,is_visited,
        visited_at,created_at,updated_at) VALUES
        ('couple_001',{a_id},'first','카페','2026-11-14',2,0,NULL,'2026-11-01 08:00:00.123','2026-11-01 08:00:00.125'),
        ('couple_001',{b_id},'second','맛집','2026-11-14',1,1,'2026-11-02 08:00:00.999',
         '2026-11-02 08:00:00','2026-11-02 08:00:00'),
        ('test-other-couple',{a_id},'hidden','기타',NULL,NULL,0,NULL,'2026-11-03 08:00:00','2026-11-03 08:00:00')""")
    dated = http(places + '?planned_date=2026-11-14&sort=oldest', cookie=a_cookie)[1]['data']
    filtered = http(places + '?planned_date=2026-11-14&status=unvisited', cookie=b_cookie)[1]['data']
    check('real MySQL list, shared visibility, filters, ordering, independent counts and UTC milliseconds',
          dated['counts'] == filtered['counts'] == {'unvisited': 1, 'visited': 1} and
          [row['title'] for row in dated['places']] == ['second', 'first'] and
          dated['places'][0]['is_visited'] is True and dated['places'][0]['visited_at'] == '2026-11-02T08:00:00.999Z' and
          len(filtered['places']) == 1 and filtered['places'][0]['added_by'] == a_id and
          filtered['places'][0]['added_by_name'] == users[0]['display_name'] and
          filtered['places'][0]['updated_at'] == '2026-11-01T08:00:00.125Z' and
          [row['title'] for row in http(places + '?sort=oldest', cookie=b_cookie)[1]['data']['places']] == ['first', 'second'])
    check('invalid date filter returns 422', is_error(http(places + '?planned_date=2026-02-30', cookie=a_cookie),
                                                    422, 'VALIDATION_ERROR'))

    def other_couple_cookie():
        # 운영 계정은 두 개로 유지하고 테스트 DB에서만 기동 이후 다른 커플 계정을 만든다.
        email = 'test_other@example.test'
        sql(f"""INSERT INTO users (email, password_hash, display_name, couple_id)
            SELECT '{email}', password_hash, '테스트 C', 'test-other-couple' FROM users WHERE id = {a_id}""")
        response = login(email, password_a)
        check('other couple also receives a real Redis session', response[0] == 200 and
              response[1]['data']['user']['couple_id'] == 'test-other-couple')
        other_id = response[1]['data']['user']['id']
        sql(f"UPDATE places SET added_by = {other_id} WHERE couple_id = 'test-other-couple'")
        return session_header(response[2])

    other_cookie = other_couple_cookie()
    sets_before_places = redis_sets()
    verify_places(http, sql, check, is_error, other_cookie, a_cookie, b_cookie, users)
    verify_schedules(http, sql, check, is_error, other_cookie, a_cookie, b_cookie)
    check('Place CRUD and schedule requests do not rewrite authenticated Redis sessions',
          redis_sets() == sets_before_places)
    time.sleep(2)
    check('reads do not extend TTL', 0 < int(cache(a_id)[1]) < ttl_before)
    tampered = a_cookie[:-1] + ('x' if not a_cookie.endswith('x') else 'y')
    check('tampered cookie rejected', is_error(http(places, cookie=tampered), 401, 'AUTH_REQUIRED'))
    newer = session_header(login(email_a, password_a, a_cookie)[2])
    check('login replaces the previous Redis session', newer != a_cookie and cache(a_id)[0] == '1' and
          is_error(http(places, cookie=a_cookie), 401, 'AUTH_REQUIRED'))
    logout = http(logout_path, 'POST', newer)
    check('logout removes Redis session, clears cookie, and B stays authenticated',
          logout[:2] == (204, None) and SimpleCookie(logout[2])['ourspot.sid'].value == '' and
          cache(a_id)[0] == '0' and all(is_error(http(path, cookie=newer), 401, 'AUTH_REQUIRED') for path in (me, places))
          and http(places, cookie=b_cookie)[0] == 200)

    cache(b_id, expire=True)
    check('both APIs reject expired session with remaining Redis TTL', int(cache(b_id)[1]) > 0 and
          all(is_error(http(path, cookie=b_cookie), 401, 'AUTH_REQUIRED') for path in (me, places)))
    check('expired and missing session logout return 204', all(
          http(logout_path, 'POST', cookie)[:2] == (204, None) for cookie in (b_cookie, None)) and cache(b_id)[0] == '0')

    active = session_header(login(email_a, password_a)[2])
    for denied, calls in [
        ('get', [lambda: http(me, cookie=active), lambda: http(places, cookie=active)]),
        ('set', [lambda: login(email_a, password_a)]),
        ('del', [lambda: http(logout_path, 'POST', active), lambda: login(email_a, password_a, active)]),
    ]:
        if redis('ACL', 'SETUSER', 'default', '-' + denied) != 'OK':
            raise RuntimeError(f'Could not isolate Redis {denied} failure')
        try:
            check(f'Redis {denied.upper()} failure returns 503 without Set-Cookie',
                  all(is_error(call(), 503, 'SESSION_UNAVAILABLE') for call in calls))
        finally:
            redis('ACL', 'SETUSER', 'default', '+' + denied)
    check('failed logout preserves session for retry', http(places, cookie=active)[0] == 200 and
          http(logout_path, 'POST', active)[0] == 204)
    docker('exec', name('user-api'), 'node', '-e', '''
      const assert = require('node:assert/strict');
      const {sessionTtl, SESSION_DURATION} = require('/app/common/infrastructure.cjs');
      for (const expiresAt of [undefined, null, NaN, Infinity, '86400', 1, Number.MAX_VALUE]) {
        assert.equal(sessionTtl({expiresAt}), 0);
      }
      assert.equal(sessionTtl({expiresAt: Date.now() + SESSION_DURATION}), 86400);
    ''')
    check('invalid expiry cannot reach Redis as an invalid TTL', True)
    logs = '\n'.join(docker('logs', name(service)) for service in ('user-api', 'place-api', 'proxy'))
    cookie_values = [cookie.partition('=')[2] for cookie in (a_cookie, b_cookie, other_cookie, newer, active)]
    session_ids = [unquote(value).removeprefix('s:').partition('.')[0] for value in cookie_values]
    check('passwords, session secret, cookie values and session IDs absent from service logs', all(
        value not in logs for value in (password_a, password_b, session_secret, *cookie_values, *session_ids)))


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='ourspot-auth-') as env_dir:
        docker('network', 'create', NETWORK)
        try:
            verify(env_dir)
        finally:
            try:
                containers = docker('ps', '-aq', '--filter', 'label=' + TEST_LABEL).splitlines()
                if containers:
                    docker('rm', '-f', *containers)
            finally:
                docker('network', 'rm', NETWORK)
