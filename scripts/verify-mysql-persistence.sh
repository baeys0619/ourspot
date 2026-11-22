#!/usr/bin/env bash
# 운영 자원과 이름이 다른 새 네트워크·볼륨에서만 장소와 코멘트를 기록한다.
set +x
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/images.env
base="ourspot-persist-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
network="$base-net"
volume="$base-data"
db="$base-db"

if docker network inspect "$network" >/dev/null 2>&1 ||
   docker volume inspect "$volume" >/dev/null 2>&1 ||
   docker container inspect "$db" >/dev/null 2>&1; then
  echo 'FAIL isolated resource name collision' >&2
  exit 1
fi
docker image inspect "$MYSQL_IMAGE" --format 'image={{.Id}} platform={{.Os}}/{{.Architecture}}'
printf 'network=%s volume=%s container=%s\n' "$network" "$volume" "$db"
private_env=$(mktemp)
trap 'rm -f -- "$private_env"' EXIT
{
  printf 'MYSQL_DATABASE=persistence_check\nMYSQL_USER=persistence_check\n'
  printf 'MYSQL_PASSWORD=%s\nMYSQL_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)"
} > "$private_env"
docker network create --internal --driver bridge "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker run -d --pull=never --name "$db" --network "$network" \
  --env-file "$private_env" --mount "type=volume,src=$volume,dst=/var/lib/mysql" \
  --mount "type=bind,src=$PWD/database/init,dst=/docker-entrypoint-initdb.d,readonly" \
  --health-cmd='MYSQL_PWD="$MYSQL_PASSWORD" mysql -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "SELECT COUNT(*) FROM places"' \
  --health-interval=2s --health-timeout=3s --health-retries=45 \
  "$MYSQL_IMAGE" --character-set-server=utf8mb4 --default-time-zone=+00:00 >/dev/null
rm -f -- "$private_env"
trap - EXIT

wait_healthy() {
  for ((attempt=0; attempt<60; attempt++)); do
    state=$(docker inspect -f '{{.State.Status}} {{.State.Health.Status}}' "$db")
    case "$state" in
      'running healthy') return ;;
      exited*|dead*) break ;;
    esac
    sleep 2
  done
  echo "FAIL MySQL readiness: $state" >&2
  return 1
}

sql() {
  docker exec -i "$db" bash -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 \
    -u"$MYSQL_USER" "$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --raw'
}

snapshot() {
  sql <<'SQL'
SELECT p.id AS place_id, p.title, p.created_at AS place_created_at,
       c.id AS comment_id, c.content, c.created_at AS comment_created_at
FROM places AS p JOIN place_comments AS c ON c.place_id = p.id
WHERE p.title = 'Persistence fixture' AND c.phase = 'before'
ORDER BY p.id, c.id;
SQL
}

wait_healthy
docker volume inspect "$volume" -f 'volume={{.Name}} driver={{.Driver}}'
docker network inspect "$network" -f 'network={{.Name}} driver={{.Driver}} internal={{.Internal}}'
docker inspect "$db" -f 'container={{.Id}} health={{.State.Health.Status}} started={{.State.StartedAt}} ports={{json .NetworkSettings.Ports}}{{range .Mounts}}{{if eq .Type "volume"}} mount={{.Name}}:{{.Destination}}{{end}}{{end}}'
sql <<'SQL'
START TRANSACTION;
INSERT INTO users (email, password_hash, display_name, couple_id)
VALUES ('fixture@example.test', 'disabled-test-fixture', 'Fixture', 'fixture');
SET @fixture_user = LAST_INSERT_ID();
INSERT INTO places (couple_id, added_by, title, category)
VALUES ('fixture', @fixture_user, 'Persistence fixture', '카페');
INSERT INTO place_comments (place_id, user_id, phase, content)
VALUES (LAST_INSERT_ID(), @fixture_user, 'before', 'Same content after restart');
COMMIT;
SQL

before=$(snapshot)
[[ $(wc -l <<< "$before") -eq 2 && "$before" == *'Same content after restart'* ]] ||
  { echo 'FAIL fixture snapshot missing' >&2; exit 1; }
printf 'BEFORE\n%s\n' "$before"
# 같은 컨테이너에서 시작 시각이 달라졌는지 보고, 재시작 후 동일한 행과 시각이 조회되는지도 확인한다.
before_identity=$(docker inspect "$db" -f '{{.Id}} {{.State.StartedAt}}')
echo 'docker stop (isolated)'
docker stop "$db"
docker inspect "$db" -f 'state={{.State.Status}}'
echo 'docker start (isolated)'
docker start "$db"
wait_healthy
docker inspect "$db" -f 'container={{.Id}} health={{.State.Health.Status}} started={{.State.StartedAt}}{{range .Mounts}}{{if eq .Type "volume"}} mount={{.Name}}:{{.Destination}}{{end}}{{end}}'
after_identity=$(docker inspect "$db" -f '{{.Id}} {{.State.StartedAt}}')
after=$(snapshot)
printf 'AFTER\n%s\n' "$after"
if [[ "$before" != "$after" || "${before_identity%% *}" != "${after_identity%% *}" || "$before_identity" == "$after_identity" ]]; then
  echo 'FAIL snapshot or restart identity mismatch' >&2
  exit 1
fi
echo 'PASS identical place/comment IDs, content and timestamps after restart'
# 스크린샷에 사용할 실험 자원을 보존하고 DB 프로세스만 중지한다.
docker stop "$db" >/dev/null
docker inspect "$db" -f 'retained={{.Name}} state={{.State.Status}}'
