#!/usr/bin/env python3
"""공식 multiarch 이미지의 실제 다운로드 digest를 기록한다. 비밀값은 없다."""
import subprocess
from pathlib import Path
images = {'NODE_BASE':'node:22-bookworm-slim', 'FRONT_BASE':'httpd:2.4-bookworm', 'NGINX_IMAGE':'nginx:1.28-bookworm', 'MYSQL_IMAGE':'mysql:8.4', 'REDIS_IMAGE':'redis:7.4-bookworm'}
path = Path('infra/images.env')
existing = path.read_text().splitlines()
# 이미 로컬에 내려받은 이미지의 저장소 다이제스트를 읽고, 해당 베이스 항목만 교체한다.
for key, tag in images.items():
    digest = subprocess.check_output(['docker','image','inspect',tag,'--format','{{index .RepoDigests 0}}'], text=True).strip()
    existing = [f'{key}={digest}' if line.startswith(f'{key}=') else line for line in existing]
path.write_text('\n'.join(existing) + '\n')
