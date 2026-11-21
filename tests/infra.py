#!/usr/bin/env python3
"""실제 Docker/HTTP 검증. 비밀번호·세션 쿠키는 출력하지 않는다."""
import json
import subprocess
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = (ROOT / 'tests/probe.cjs').read_text()
results = []

def run(*args):
    return subprocess.check_output(args, text=True, timeout=60).strip()

def check(label, condition, detail=''):
    if not condition:
        raise AssertionError(label)
    results.append({'test': label, 'result': 'PASS', 'detail': detail})
    print('PASS ' + label, flush=True)

def probe(service, action, **kwargs):
    completed = subprocess.run(['docker', 'exec', '-i', 'ourspot-' + service, 'node', '-e', PROBE],
        input=json.dumps({'action': action, **kwargs}), text=True, capture_output=True, timeout=30)
    if completed.returncode:
        raise RuntimeError('Probe failed: ' + service + '/' + action + ': ' + completed.stderr.strip())
    return json.loads(completed.stdout)

def http(path):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8080' + path, timeout=15) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()

def healthy(name):
    for _ in range(90):
        value = json.loads(run('docker', 'inspect', 'ourspot-' + name))[0]
        if value['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(2)
    raise AssertionError(name + ' did not become healthy')

marker = 'infra_' + uuid.uuid4().hex
seeded = False
paused = None
try:
    names = ['proxy','front','user-api','place-api','db','redis']
    for name in names:
        healthy(name)
        obj = json.loads(run('docker', 'inspect', 'ourspot-' + name))[0]
        check(name + ': running/healthy/network', obj['State']['Running'] and 'ourspot-net' in obj['NetworkSettings']['Networks'])
        check(name + ': bash', run('docker','exec','ourspot-' + name,'bash','-c','echo bash-ok') == 'bash-ok')
        ports = obj['HostConfig']['PortBindings'] or {}
        check(name + ': published ports', (set(ports) == {'80/tcp'} and ports['80/tcp'][0]['HostPort'] == '8080') if name == 'proxy' else not ports)
        image = json.loads(run('docker','image','inspect',obj['Image']))[0]
        check(name + ': ARM64 image', image['Architecture'] == 'arm64')
    check('Apache via Nginx', http('/')[0] == 200 and 'OURSPOT' in http('/')[1])
    for prefix, service in [('auth','user-api'),('places','place-api')]:
        status, body = http('/api/' + prefix + '/health')
        data = json.loads(body)['data']
        check(service + ': HTTP/MySQL/Redis via proxy', status == 200 and data == {'service': service,'status':'ok','mysql':'ok','redis':'ok'})
    check('unsupported API returns 404', http('/api/auth/missing')[0] == 404)
    check('unknown API prefix isolated from Apache', http('/api/unknown')[0] == 404)
    check('Nginx configuration valid', 'successful' in subprocess.run(['docker','exec','ourspot-proxy','nginx','-t'], text=True, capture_output=True).stderr)
    schema = probe('user-api','schema')
    check('exactly three schema tables / UTC', sorted(next(iter(t.values())) for t in schema['tables']) == ['place_comments','places','users'] and schema['zone'][0]['timezone'] == '+00:00', json.dumps(schema['counts']))
    # 같은 운영 공통 모듈을 사용하는 독립 프로세스 두 개에서 쿠키/세션을 왕복한다.
    created = probe('user-api','session',route='create')
    cookie = created['cookie']
    check('session cookie flags', created['status'] == 200 and cookie.startswith('ourspot.sid=') and all(x in cookie for x in ['HttpOnly','SameSite=Lax','Path=/']) and 'Secure' not in cookie)
    ttl_before = probe('user-api','ttl')['ttl']
    time.sleep(2)
    read = probe('place-api','session',route='read',cookie=cookie)
    check('User API session read by Place API module', read['status'] == 200 and json.loads(read['body']) == {'userId':123,'coupleId':'infra-probe'})
    ttl_after = probe('place-api','ttl')['ttl']
    check('24-hour TTL does not roll on read', 86300 < ttl_after < ttl_before <= 86400)
    check('tampered cookie rejected', probe('place-api','session',route='read',cookie='ourspot.sid=tampered')['status'] == 401)
    check('logout removes shared session', probe('user-api','session',route='logout',cookie=cookie)['status'] == 204 and probe('place-api','session',route='read',cookie=cookie)['status'] == 401)
    cookie = probe('user-api','session',route='create')['cookie']
    probe('user-api','ttl',expire=True)
    check('absolute expiry enforced in both modules', all(probe(s,'session',route='read',cookie=cookie)['status'] == 401 for s in ['user-api','place-api']))
    # 만료된 검증용 세션만 제거한다.
    cleanup_code = "const {connectInfrastructure}=require('/app/common/infrastructure.cjs'); (async()=>{const i=await connectInfrastructure();for(const k of await i.redis.keys('ourspot:sess:*')){const v=JSON.parse(await i.redis.get(k));if(v.coupleId==='infra-probe')await i.redis.del(k);}await i.close();})().catch(()=>process.exit(1));"
    run('docker','exec','ourspot-user-api','node','-e',cleanup_code)
    fixture = probe('user-api','seed',marker=marker)
    seeded = True
    before = probe('place-api','snapshot',marker=marker)
    check('place/comment fixture stored', len(before) == 1 and before[0]['id'] == fixture['placeId'] and before[0]['comment_id'] == fixture['commentId'])
    run('docker','restart','ourspot-db')
    healthy('db')
    after = probe('place-api','snapshot',marker=marker)
    check('MySQL restart preserves identical IDs/content/timestamps', before == after, json.dumps(after, ensure_ascii=False))
    mounts = json.loads(run('docker','inspect','ourspot-db'))[0]['Mounts']
    check('named DB volume mounted', any(m.get('Name') == 'ourspot-db-data' and m['Destination'] == '/var/lib/mysql' for m in mounts))
    for dependency in ['db','redis']:
        paused = dependency
        run('docker','stop','ourspot-' + dependency)
        check(dependency + ' outage: both APIs return 503', all(http('/api/' + p + '/health')[0] == 503 for p in ['auth','places']))
        if dependency == 'redis':
            status, body = http('/api/auth/missing')
            check('Redis outage fails closed', status == 503 and json.loads(body)['error']['code'] == 'SESSION_UNAVAILABLE')
        run('docker','start','ourspot-' + dependency)
        paused = None
        healthy(dependency)
        for service in ['user-api','place-api']: healthy(service)
        check(dependency + ' recovery: both APIs healthy', all(http('/api/' + p + '/health')[0] == 200 for p in ['auth','places']))
finally:
    if paused:
        run('docker','start','ourspot-' + paused)
        healthy(paused)
    if seeded:
        probe('user-api','cleanup',marker=marker)
    (ROOT / 'docs/verification/infra-stage1-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2) + '\n')
print(f'{len(results)} checks passed; own DB fixtures removed; volume preserved.')
