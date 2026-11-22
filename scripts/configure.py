#!/usr/bin/env python3
"""비공개 인프라 암호를 최초 한 번만 생성한다. 사용자 계정 암호는 생성하지 않는다."""
from pathlib import Path
import secrets
import os
root = Path(__file__).resolve().parents[1]
runtime = Path(os.environ.get('OURSPOT_RUNTIME_DIR', root / '.runtime'))
os.umask(0o077)
runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(runtime, 0o700)
paths = [runtime / 'db.env', runtime / 'api.env']
if any(p.exists() for p in paths):
    if all(p.exists() for p in paths):
        print('Existing private configuration preserved.')
        raise SystemExit(0)
    raise SystemExit('Partial configuration exists; refusing to overwrite secrets.')
app_password = secrets.token_hex(32)
paths[0].write_text('MYSQL_DATABASE=ourspot\nMYSQL_USER=ourspot_app\nMYSQL_PASSWORD=' + app_password + '\nMYSQL_ROOT_PASSWORD=' + secrets.token_hex(32) + '\n')
paths[1].write_text('NODE_ENV=production\nDB_HOST=ourspot-db\nDB_PORT=3306\nDB_NAME=ourspot\nDB_USER=ourspot_app\nDB_PASSWORD=' + app_password + '\nREDIS_URL=redis://ourspot-redis:6379/0\nCOOKIE_SECURE=false\nSESSION_SECRET=' + secrets.token_hex(48) + '\n')
print('Private infrastructure configuration created (mode 600).')
