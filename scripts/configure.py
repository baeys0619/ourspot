#!/usr/bin/env python3
"""비공개 인프라 암호를 최초 한 번만 생성한다. 사용자 계정 암호는 생성하지 않는다."""
from pathlib import Path
import secrets
import os
root = Path(__file__).resolve().parents[1]
runtime = Path(os.environ.get('OURSPOT_RUNTIME_DIR', root / '.runtime'))
# 새 설정 파일은 설치를 실행한 사용자만 읽고 쓸 수 있게 만든다.
os.umask(0o077)
runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(runtime, 0o700)
paths = [runtime / 'db.env', runtime / 'api.env']
# 파일 한쪽만 남은 상태에서 새 암호를 만들면 기존 DB의 암호와 어긋날 수 있어 중단한다.
if any(p.exists() for p in paths):
    if all(p.exists() for p in paths):
        print('Existing private configuration preserved.')
        raise SystemExit(0)
    raise SystemExit('Partial configuration exists; refusing to overwrite secrets.')
# MySQL 초기화의 앱 계정 암호와 API 접속 암호는 같은 값으로 기록한다. 두 API는 같은 api.env에서 세션 서명 키를 읽는다.
app_password = secrets.token_hex(32)
paths[0].write_text('MYSQL_DATABASE=ourspot\nMYSQL_USER=ourspot_app\nMYSQL_PASSWORD=' + app_password + '\nMYSQL_ROOT_PASSWORD=' + secrets.token_hex(32) + '\n')
paths[1].write_text('NODE_ENV=production\nDB_HOST=ourspot-db\nDB_PORT=3306\nDB_NAME=ourspot\nDB_USER=ourspot_app\nDB_PASSWORD=' + app_password + '\nREDIS_URL=redis://ourspot-redis:6379/0\nCOOKIE_SECURE=false\nSESSION_SECRET=' + secrets.token_hex(48) + '\n')
print('Private infrastructure configuration created (mode 600).')
