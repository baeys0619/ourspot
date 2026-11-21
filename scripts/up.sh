#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/configure.py
source infra/images.env
# 계정 입력에 실패한 최초 설치는 이미 준비된 DB/Redis에서 이어갈 수 있다.
case "${1:-}" in
  '') new_dependencies=true ;;
  --reuse-dependencies) new_dependencies=false ;;
  *) echo 'Usage: bash scripts/up.sh [--reuse-dependencies]' >&2; exit 1 ;;
esac
# 이름이 충돌하면 기존 컨테이너를 삭제하지 않고 종료하여 데이터를 보존한다.
names=(user-api place-api front proxy)
if "$new_dependencies"; then names+=(db redis); fi
for name in "${names[@]}"; do
  if docker container inspect "ourspot-$name" >/dev/null 2>&1; then
    echo "Container ourspot-$name already exists; use docker start or inspect it first." >&2; exit 1
  fi
done
if "$new_dependencies"; then
  docker network inspect ourspot-net >/dev/null 2>&1 || docker network create --driver bridge ourspot-net
  docker volume inspect ourspot-db-data >/dev/null 2>&1 || docker volume create ourspot-db-data
  # DB만 영속 볼륨을 연결한다. 암호 설정은 Git 제외 파일에서 전달한다.
  docker run -d --name ourspot-db --network ourspot-net --restart unless-stopped   --env-file .runtime/db.env --mount source=ourspot-db-data,target=/var/lib/mysql   --mount "type=bind,src=$PWD/database/init,dst=/docker-entrypoint-initdb.d,readonly"   --health-cmd='MYSQL_PWD="$MYSQL_PASSWORD" mysql -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "SELECT 1"'   --health-interval=5s --health-timeout=4s --health-start-period=60s --health-retries=30   "$MYSQL_IMAGE" --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --default-time-zone=+00:00
  docker run -d --name ourspot-redis --network ourspot-net --restart unless-stopped   --health-cmd='redis-cli ping | grep -q PONG' --health-interval=5s --health-timeout=3s --health-retries=10   "$REDIS_IMAGE" redis-server --save '' --appendonly no
else
  for name in db redis; do
    docker inspect -f '{{if index .NetworkSettings.Networks "ourspot-net"}}{{.State.Running}}{{end}}' "ourspot-$name" | grep -qx true
  done
fi
wait_healthy() {
  for attempt in $(seq 1 90); do
    if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$1")" == healthy ]]; then return; fi
    sleep 2
  done
  echo "Health check timed out: $1" >&2; docker logs --tail 30 "$1"; return 1
}
wait_healthy ourspot-db
wait_healthy ourspot-redis
bash scripts/seed-users.sh
for service in user-api place-api; do
  docker run -d --name "ourspot-$service" --network ourspot-net --restart unless-stopped     --env-file .runtime/api.env "ourspot-$service:0.2"
  wait_healthy "ourspot-$service"
done
docker run -d --name ourspot-front --network ourspot-net --restart unless-stopped ourspot-front:0.1
wait_healthy ourspot-front
# 외부에 공개하는 유일한 포트: Ubuntu 8080 → Nginx 80.
docker run -d --name ourspot-proxy --network ourspot-net --restart unless-stopped -p 8080:80   --mount "type=bind,src=$PWD/infra/nginx/default.conf,dst=/etc/nginx/conf.d/default.conf,readonly"   --health-cmd='curl --fail --silent http://127.0.0.1/ >/dev/null' --health-interval=10s --health-timeout=3s --health-retries=10   "$NGINX_IMAGE"
wait_healthy ourspot-proxy
echo 'OURSPOT infrastructure ready: http://localhost:8080'
