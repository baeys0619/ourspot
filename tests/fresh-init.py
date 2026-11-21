#!/usr/bin/env python3
"""tmpfs DB로 최초 초기화 SQL을 재검증한다. Docker Volume은 만들거나 삭제하지 않는다."""
import json
import subprocess
import time
from pathlib import Path
root = Path(__file__).resolve().parents[1]
images = dict(line.split('=',1) for line in (root/'infra/images.env').read_text().splitlines() if '=' in line)
name = 'ourspot-init-check'

def run(*args):
    return subprocess.check_output(args,text=True,timeout=60).strip()

# --tmpfs가 공식 이미지의 /var/lib/mysql VOLUME 선언을 덮어쓰므로 영속 볼륨이 생기지 않는다.
run('docker','run','-d','--name',name,'--env-file',str(root/'.runtime/db.env'),
    '--tmpfs','/var/lib/mysql:rw,size=536870912',
    '--mount',f'type=bind,src={root}/database/init,dst=/docker-entrypoint-initdb.d,readonly',
    images['MYSQL_IMAGE'],'--character-set-server=utf8mb4','--collation-server=utf8mb4_unicode_ci','--default-time-zone=+00:00')
try:
    query = "SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM places),(SELECT COUNT(*) FROM place_comments); SELECT HEX(SUBSTRING_INDEX(SUBSTRING_INDEX(COLUMN_TYPE,CHAR(39),2),CHAR(39),-1)) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='places' AND column_name='category'; SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND constraint_name='chk_places_schedule';"
    result = None
    for _ in range(90):
        completed = subprocess.run(['docker','exec',name,'bash','-c',
            'MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h127.0.0.1 --default-character-set=utf8mb4 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "$1"', 'bash',query],
            text=True,capture_output=True,timeout=10)
        if completed.returncode == 0:
            result = completed.stdout.strip().splitlines()
            break
        time.sleep(2)
    assert result == ['0\t0\t0', '카페'.encode().hex().upper(), '1'], result
    mounts = json.loads(run('docker','inspect',name))[0]['Mounts']
    assert not any(m['Type']=='volume' for m in mounts)
    evidence = {'result':'PASS','storage':'tmpfs; no Docker volume created/deleted', 'initial_rows':{'users':0,'places':0,'place_comments':0},'category_utf8_hex':result[1],'schedule_constraint':'present'}
    (root/'docs/verification/fresh-init-results.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
    print('PASS fresh SQL initialization: three empty tables, correct Korean ENUM, schedule constraint; no volumes created/deleted')
finally:
    run('docker','stop',name)
    run('docker','rm',name)
