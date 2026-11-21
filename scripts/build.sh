#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# 최초 pull 뒤 digest를 저장한다. 재실행은 같은 digest로 빌드한다.
mkdir -p .runtime
if [[ ! -f infra/images.env ]]; then
  for image in node:22-bookworm-slim httpd:2.4-bookworm nginx:1.28-bookworm mysql:8.4 redis:7.4-bookworm; do
    docker pull "$image"
  done
  python3 scripts/lock-images.py
fi
source infra/images.env
# lockfile이 없을 때만 npm으로 생성한다. 개발 PC의 Node/npm 설치에 의존하지 않는다.
if [[ ! -f services/package-lock.json ]]; then
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/services:/work" -w /work "$NODE_BASE" npm install --package-lock-only --ignore-scripts --no-audit --no-fund
fi
docker build --build-arg "FRONT_BASE=$FRONT_BASE" -f frontend/Dockerfile -t ourspot-front:0.1 .
for service in user-api place-api; do
  docker build --build-arg "NODE_BASE=$NODE_BASE" --build-arg "SERVICE=$service" -f services/Dockerfile -t "ourspot-$service:0.2" .
done
