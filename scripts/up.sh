#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/images.env

usage() {
  echo 'Usage: bash scripts/up.sh [--hub | --amd64] [--isolated ID [--qemu /absolute/path]] [--reuse-dependencies]' >&2
  exit 1
}
# 기본 설치는 고정 포트와 .runtime을 사용한다. 격리 설치는 별도 이름·설정 디렉터리·루프백 포트로 실행한다.
prefix=ourspot
runtime=.runtime
publish=8080:80
qemu=
mode=native
reuse=false
while (($#)); do
  case "$1" in
    --hub|--amd64) [[ "$mode" == native ]] || usage; mode=${1#--} ;;
    --isolated)
      [[ "${2:-}" =~ ^[a-z0-9][a-z0-9-]{0,35}$ && "$prefix" == ourspot ]] || usage
      prefix=ourspot-install-$2
      runtime=.runtime/$prefix
      publish=127.0.0.1::80
      shift ;;
    --qemu) [[ "${2:-}" == /* ]] || usage; qemu=$2; shift ;;
    --reuse-dependencies) reuse=true ;;
    *) usage ;;
  esac
  shift
done

# DB·Redis·Nginx는 Docker 서버의 플랫폼에서 실행한다. 앱은 모드에 따라 로컬 빌드나 Hub의 AMD64 이미지를 선택한다.
host_platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
app_platform=$host_platform
case "$mode" in
  hub) FRONT_LOCAL=$FRONT_HUB; USER_LOCAL=$USER_HUB; PLACE_LOCAL=$PLACE_HUB; app_platform=linux/amd64 ;;
  amd64) FRONT_LOCAL+=-amd64; USER_LOCAL+=-amd64; PLACE_LOCAL+=-amd64; app_platform=linux/amd64 ;;
esac
if [[ -n "$qemu" ]]; then
  # 운영 호스트에는 에뮬레이터를 등록하지 않는다. 격리 앱에만 파일을 연결한다.
  [[ "$prefix" != ourspot && "$host_platform" == linux/arm64 && "$app_platform" == linux/amd64 && -f "$qemu" && -x "$qemu" ]] || usage
elif [[ "$app_platform" != "$host_platform" ]]; then
  echo "AMD64 apps require an AMD64 Docker host or the isolated --qemu mode." >&2
  exit 1
fi

network=$prefix-net
volume=$prefix-db-data
names=(user-api place-api front proxy)
if ! "$reuse"; then names+=(db redis); fi
# 영속 리소스 생성에 앞서 컨테이너 이름과 로컬 이미지의 플랫폼을 검사한다.
for name in "${names[@]}"; do
  if docker container inspect "$prefix-$name" >/dev/null 2>&1; then
    echo "Container $prefix-$name already exists. Inspect it or choose another isolated ID." >&2
    exit 1
  fi
done
for image in "$FRONT_LOCAL" "$USER_LOCAL" "$PLACE_LOCAL"; do
  if [[ "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null)" != "$app_platform" ]]; then
    echo "Missing $app_platform image: $image. Pull or build it following the installation guide." >&2
    exit 1
  fi
done
if "$reuse" || docker volume inspect "$volume" >/dev/null 2>&1; then
  # 기존 DB에 다른 비밀값을 생성하면 계정, DB 접속 및 양쪽 세션 공유가 깨진다.
  [[ -s "$runtime/db.env" && -s "$runtime/api.env" ]] || { echo 'Existing DB requires its original private configuration.' >&2; exit 1; }
fi
# DB와 두 API가 쓸 비공개 환경 파일을 준비한다. 기존 파일 두 개가 있으면 그대로 재사용한다.
OURSPOT_RUNTIME_DIR="$runtime" python3 scripts/configure.py

run_service() {
  local service=$1
  shift
  # 이름은 설치별로 다르고, DNS 별칭은 같은 격리 네트워크 안에서만 공유한다.
  docker run -d --name "$prefix-$service" --network "$network" --network-alias "ourspot-$service" \
    --restart unless-stopped "$@"
}
# 준비 완료까지 기다리되 컨테이너가 종료되거나 unhealthy가 되면 다음 설치 단계로 넘어가지 않는다.
wait_healthy() {
  local name=$1
  local state
  for attempt in {1..90}; do
    state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$prefix-$name")
    [[ "$state" == 'running healthy' ]] && return
    [[ "$state" == exited* || "$state" == dead* || "$state" == 'running unhealthy' ]] && break
    sleep 2
  done
  echo "Health check failed: $prefix-$name ($state)" >&2
  return 1
}
# 의존성 재사용 모드에서는 지정한 네트워크에서 DB와 Redis가 실행 중인지 확인하고 새로 만들지 않는다.
if "$reuse"; then
  for name in db redis; do
    docker inspect -f "{{if index .NetworkSettings.Networks \"$network\"}}{{.State.Running}}{{end}}" "$prefix-$name" | grep -qx true
  done
else
  # 설치별 bridge 네트워크와 DB 볼륨을 이름으로 찾는다. 같은 설치 이름으로 다시 실행하면 기존 볼륨을 연결한다.
  docker network inspect "$network" >/dev/null 2>&1 || docker network create --driver bridge "$network"
  docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume"
  # SQL은 최초 초기화에만 사용하고, 이후 데이터는 Named Volume에 남긴다.
  run_service db --platform "$host_platform" --env-file "$runtime/db.env" \
    --mount "source=$volume,target=/var/lib/mysql" \
    --mount "type=bind,src=$PWD/database/init,dst=/docker-entrypoint-initdb.d,readonly" \
    --health-cmd='MYSQL_PWD="$MYSQL_PASSWORD" mysql -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "SELECT COUNT(*) FROM users"' \
    --health-interval=5s --health-timeout=4s --health-start-period=60s --health-retries=30 \
    "$MYSQL_IMAGE" --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --default-time-zone=+00:00
  # Redis는 세션용 임시 저장소로 기동한다. MySQL과 달리 /data는 tmpfs이며 디스크 저장도 끈다.
  run_service redis --platform "$host_platform" --tmpfs /data \
    --health-cmd='redis-cli ping | grep -qx PONG' --health-interval=5s --health-timeout=3s --health-retries=10 \
    "$REDIS_IMAGE" redis-server --save '' --appendonly no
fi
# DB 스키마를 조회할 수 있고 Redis가 PING에 응답해야 계정을 확인하거나 설치한다.
# 계정 준비가 끝나면 두 API와 프론트를 기동한 뒤 Nginx를 연결한다.
wait_healthy db
wait_healthy redis
OURSPOT_INSTALL_PREFIX="$prefix" OURSPOT_RUNTIME_DIR="$runtime" OURSPOT_USER_IMAGE="$USER_LOCAL" OURSPOT_QEMU="$qemu" \
  bash scripts/seed-users.sh

# 양 API에 같은 api.env를 전달한다. 실행 모드와 관계없이 Redis 주소와 세션 서명 키가 일치해야 한다.
app_options=(--pull=never --platform "$app_platform")
if [[ -n "$qemu" ]]; then
  # 이미지의 기본 헬스체크는 게스트 /bin/sh를 직접 실행한다. 이 모드는 Nginx에서 HTTP로 검사한다.
  app_options+=(--no-healthcheck --mount "type=bind,src=$qemu,dst=/run/ourspot-qemu-x86_64,readonly"
    --entrypoint /run/ourspot-qemu-x86_64)
  run_service user-api "${app_options[@]}" --env-file "$runtime/api.env" "$USER_LOCAL" /usr/local/bin/node server.cjs
  run_service place-api "${app_options[@]}" --env-file "$runtime/api.env" "$PLACE_LOCAL" /usr/local/bin/node server.cjs
  run_service front "${app_options[@]}" "$FRONT_LOCAL" /usr/local/apache2/bin/httpd -DFOREGROUND
else
  run_service user-api "${app_options[@]}" --env-file "$runtime/api.env" "$USER_LOCAL"
  run_service place-api "${app_options[@]}" --env-file "$runtime/api.env" "$PLACE_LOCAL"
  run_service front "${app_options[@]}" "$FRONT_LOCAL"
fi
# 게시 포트는 Nginx에만 연결한다. 격리 모드에서는 Docker가 루프백 포트를 할당한다.
run_service proxy --platform "$host_platform" -p "$publish" \
  --mount "type=bind,src=$PWD/infra/nginx/default.conf,dst=/etc/nginx/conf.d/default.conf,readonly" \
  --health-cmd='for path in / /api/auth/health /api/places/health; do curl --fail --silent --max-time 2 "http://127.0.0.1$path" >/dev/null || exit 1; done' \
  --health-interval=5s --health-timeout=8s --health-start-period=20s --health-retries=10 \
  "$NGINX_IMAGE"
# 일반 실행은 앱의 개별 헬스체크를 확인한다. 두 모드 모두 Nginx를 거쳐 정적 페이지와 두 API까지 확인한다.
if [[ -z "$qemu" ]]; then
  for name in user-api place-api front; do wait_healthy "$name"; done
fi
wait_healthy proxy
binding=$(docker port "$prefix-proxy" 80/tcp)
echo "OURSPOT infrastructure ready: http://127.0.0.1:${binding##*:} ($network)"
