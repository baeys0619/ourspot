#!/usr/bin/env python3
"""공식 multiarch 이미지의 실제 다운로드 digest를 기록한다. 비밀값은 없다."""
import subprocess
from pathlib import Path
images = {'NODE_BASE':'node:22-bookworm-slim', 'FRONT_BASE':'httpd:2.4-bookworm', 'NGINX_IMAGE':'nginx:1.28-bookworm', 'MYSQL_IMAGE':'mysql:8.4', 'REDIS_IMAGE':'redis:7.4-bookworm'}
lines = ['# Actual official image digests verified on this ARM64 host.']
for key, tag in images.items():
    digest = subprocess.check_output(['docker','image','inspect',tag,'--format','{{index .RepoDigests 0}}'], text=True).strip()
    lines.append(f'{key}={digest}')
Path('infra/images.env').write_text('\n'.join(lines) + '\n')
