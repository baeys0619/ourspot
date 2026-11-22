#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# 배포와 같은 고정 베이스 및 npm lockfile로 빌드한다.
source infra/images.env
build=(docker build)
case "${1:-}" in
  '') ;;
  --amd64)
    build=(docker buildx build --platform linux/amd64 --load --provenance=false)
    # 기존 ARM64 태그 및 게시 태그와 겹치지 않는 로컬 빌드 이름을 사용한다.
    FRONT_LOCAL+=-amd64
    USER_LOCAL+=-amd64
    PLACE_LOCAL+=-amd64
    ;;
  *) echo 'Usage: bash scripts/build.sh [--amd64]' >&2; exit 1 ;;
esac
docker_build_api() {
  "${build[@]}" --build-arg "NODE_BASE=$NODE_BASE" --build-arg "SERVICE=$1" \
    -f services/Dockerfile -t "$2" .
}
"${build[@]}" --build-arg "FRONT_BASE=$FRONT_BASE" -f frontend/Dockerfile -t "$FRONT_LOCAL" .
docker_build_api user-api "$USER_LOCAL"
docker_build_api place-api "$PLACE_LOCAL"
