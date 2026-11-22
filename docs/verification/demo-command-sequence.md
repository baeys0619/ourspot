# 3분 무편집 시연 명령 순서

이 순서는 기획서 12.4의 촬영 요구에 맞춰 **MySQL → Redis → User API → Place API → Frontend → Nginx**의 `docker run`을 터미널에서 직접 한 명령씩 실행한다. 이후 브라우저 로그인, 같은 브라우저 세션으로 두 API 접근, 명시적인 `docker restart`, 동일 장소 재조회까지 한 화면을 연속 녹화한다. 각 명령을 붙여 넣고 실행한 뒤 다음 명령으로 넘어간다. [기획서](../design/proposal.md#124-구현-시연-영상) · [설치 가이드 §2](installation.md#2-6개-컨테이너-시작)

## 0. 녹화 전에 준비

- Ubuntu 저장소 루트에서 전용 Bash를 열고, 빈 Firefox 프로필 또는 새 비공개 창과 나란히 둔다. 두 테스트 비밀번호를 서로 다르게 정하고 브라우저 비밀번호 저장 및 화면의 클립보드 기록 표시를 끈다.
- 이 예에서는 Ubuntu의 `127.0.0.1:8283`을 사용한다. Mac에서 녹화하면 먼저 `ssh -N -L 127.0.0.1:8283:127.0.0.1:8283 <Ubuntu-SSH-대상>`을 별도 터미널에서 연다. 두 경우 브라우저 주소는 `http://127.0.0.1:8283/login.html`이다. 포트가 사용 중이면 Ubuntu 바인딩, SSH 포워딩, 브라우저 주소를 함께 바꾼다.
- 아래 `demo-113-a`와 `8283`은 보존한 리허설 환경이다. 실제 촬영에는 새 ID와 빈 포트를 정한다. 예를 들어 `demo-113-film`과 `8284`를 사용하면 브라우저 주소는 `http://127.0.0.1:8284/login.html`이다. 환경 파일, 이미지와 QEMU는 미리 준비하고, 컨테이너 생성 명령은 녹화 시작 후 실행한다.
- 영상의 터미널에는 아래 명령과 정제된 출력만 담는다. 환경 파일, 전체 `docker inspect` JSON, Redis 키나 값, 쿠키 헤더, 브라우저 자동완성 목록은 화면과 제출 파일에서 제외한다.

```bash
set +x
set -euo pipefail
source infra/images.env
demo_id=demo-113-a
demo_port=8283
[[ "$demo_id" =~ ^demo-[a-z0-9][a-z0-9-]*$ && "$demo_port" != 8080 ]]
prefix=ourspot-install-$demo_id
net=$prefix-net
vol=$prefix-db-data
runtime=.runtime/$prefix
QEMU="$PWD/.runtime/ourspot-install-hub-113/qemu-x86_64"
test "$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')" = linux/arm64
test -x "$QEMU"
printf '%s  %s\n' d02e1860d3a9130557e627e11751a7ef82acb985b1db17dc864a9a4cbea79abf "$QEMU" | sha256sum -c
for image in "$FRONT_HUB" "$USER_HUB" "$PLACE_HUB"; do
  test "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image")" = linux/amd64
done
for image in "$MYSQL_IMAGE" "$REDIS_IMAGE" "$NGINX_IMAGE"; do
  docker image inspect "$image" >/dev/null
done
for name in db redis seed-check seed-write user-api place-api front proxy; do
  if docker container inspect "$prefix-$name" >/dev/null 2>&1; then exit 1; fi
done
if docker network inspect "$net" >/dev/null 2>&1 || docker volume inspect "$vol" >/dev/null 2>&1; then exit 1; fi
test -z "$(ss -H -ltn "sport = :$demo_port")"
OURSPOT_RUNTIME_DIR="$runtime" python3 scripts/configure.py
app=(--pull=never --platform linux/amd64 --no-healthcheck
  --mount "type=bind,src=$QEMU,dst=/run/ourspot-qemu-x86_64,readonly"
  --entrypoint /run/ourspot-qemu-x86_64)
wait_health() {
  for _ in {1..90}; do
    if [[ "$(docker inspect -f '{{.State.Status}} {{.State.Health.Status}}' "$1")" == 'running healthy' ]]; then return; fi
    sleep 1
  done
  return 1
}
demo_row() {
  docker exec "$prefix-db" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --default-character-set=utf8mb4 --batch --skip-column-names -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT id, title, category FROM places WHERE title = '\''시연용 카페'\'' ORDER BY id"'
}
```

이미지가 없다면 촬영 전에 설치 가이드 §1대로 받는다. 이 경로는 기존 QEMU 파일을 읽기 전용으로 연결해 ARM64 호스트에서 AMD64 앱을 실행한다. Frontend와 양 API의 이미지 자체 헬스체크는 게스트 셸을 직접 실행하므로 `--no-healthcheck`를 사용한다. ARM64 MySQL·Redis·Nginx는 Docker `healthy`로 확인하고, Nginx 헬스체크로 세 앱의 HTTP 응답을 확인한다. [이미지와 설치 가이드](installation.md)

## 1. 녹화 시작 후 개별 `docker run` 실행

첫 명령부터 녹화한다. 아래 블록마다 Bash 프롬프트가 돌아오는 것을 확인한다.

```bash
docker network create --driver bridge "$net"
docker volume create "$vol"
```

```bash
docker run -d --name "$prefix-db" --network "$net" --network-alias ourspot-db \
  --restart unless-stopped --platform linux/arm64 --env-file "$runtime/db.env" \
  --mount "source=$vol,target=/var/lib/mysql" \
  --mount "type=bind,src=$PWD/database/init,dst=/docker-entrypoint-initdb.d,readonly" \
  --health-cmd='MYSQL_PWD="$MYSQL_PASSWORD" mysql -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "SELECT COUNT(*) FROM users"' \
  --health-interval=5s --health-timeout=4s --health-start-period=60s --health-retries=30 \
  "$MYSQL_IMAGE" --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --default-time-zone=+00:00
```

```bash
docker run -d --name "$prefix-redis" --network "$net" --network-alias ourspot-redis \
  --restart unless-stopped --platform linux/arm64 --tmpfs /data \
  --health-cmd='redis-cli ping | grep -qx PONG' --health-interval=5s --health-timeout=3s --health-retries=10 \
  "$REDIS_IMAGE" redis-server --save '' --appendonly no
```

계정 초기화 컨테이너 두 개는 작업 후 종료된다. 다음 블록은 `empty`를 확인하고 A/B 비밀번호를 각각 한 번 숨김 입력받는다. 셸 내장 `printf`의 표준입력 파이프로만 암호를 넘긴다. 영상에는 프롬프트와 `created` 출력이 보인다.

```bash
wait_health "$prefix-db"
wait_health "$prefix-redis"
state=$(docker run --name "$prefix-seed-check" --network "$net" --env-file "$runtime/api.env" \
  "${app[@]}" "$USER_HUB" /usr/local/bin/node seed-users.cjs --check)
printf 'Seed state: %s\n' "$state"
test "$state" = empty
```

두 입력 줄은 각각 따로 붙여 넣는다. 숨김 입력 프롬프트가 뜨면 해당 비밀번호를 입력하고 Enter를 누른다.

```bash
IFS= read -rs -p 'Synthetic A password: ' demo_a; printf '\n'
```

```bash
IFS= read -rs -p 'Synthetic B password: ' demo_b; printf '\n'
```

```bash
printf '%s\n%s\n' "$demo_a" "$demo_b" | \
  docker run -i --name "$prefix-seed-write" --network "$net" --env-file "$runtime/api.env" \
    "${app[@]}" "$USER_HUB" /usr/local/bin/node seed-users.cjs
unset demo_a demo_b
```

```bash
docker run -d --name "$prefix-user-api" --network "$net" --network-alias ourspot-user-api \
  --restart unless-stopped "${app[@]}" --env-file "$runtime/api.env" \
  "$USER_HUB" /usr/local/bin/node server.cjs
```

```bash
docker run -d --name "$prefix-place-api" --network "$net" --network-alias ourspot-place-api \
  --restart unless-stopped "${app[@]}" --env-file "$runtime/api.env" \
  "$PLACE_HUB" /usr/local/bin/node server.cjs
```

```bash
docker run -d --name "$prefix-front" --network "$net" --network-alias ourspot-front \
  --restart unless-stopped "${app[@]}" "$FRONT_HUB" /usr/local/apache2/bin/httpd -DFOREGROUND
```

```bash
docker run -d --name "$prefix-proxy" --network "$net" --network-alias ourspot-proxy \
  --restart unless-stopped --platform linux/arm64 -p "127.0.0.1:$demo_port:80" \
  --mount "type=bind,src=$PWD/infra/nginx/default.conf,dst=/etc/nginx/conf.d/default.conf,readonly" \
  --health-cmd='for path in / /api/auth/health /api/places/health; do curl --fail --silent --max-time 2 "http://127.0.0.1$path" >/dev/null || exit 1; done' \
  --health-interval=5s --health-timeout=8s --health-start-period=20s --health-retries=10 "$NGINX_IMAGE"
```

## 2. 실행 상태와 브라우저 세션 보여주기

1. 다음 명령으로 실행 중인 6개 이름, 포트, 세 네이티브 컨테이너의 `healthy`와 세 앱의 `200`을 보여준다.

```bash
wait_health "$prefix-proxy"
docker ps --filter "network=$net" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
endpoint=$(docker port "$prefix-proxy" 80/tcp)
printf 'Browser: http://%s/login.html\n' "$endpoint"
for path in / /api/auth/health /api/places/health; do
  curl -fsS -o /dev/null -w "$path %{http_code}\n" "http://$endpoint$path"
done
docker exec "$prefix-redis" redis-cli DBSIZE
```

2. 주소 표시줄에 위 주소를 열고 `user_a@example.test`와 합성 A 비밀번호로 로그인한다. 암호 표시 토글은 건드리지 않는다. 로그인 뒤 **사용자 A**가 표시된 화면을 보여준다.
3. 같은 탭의 **웹 콘솔**을 열어 아래 JavaScript를 실행한다. `fetch`가 같은 출처의 HttpOnly 세션 쿠키를 자동으로 보내며, 화면에는 User API의 `/api/auth/me`와 Place API의 `/api/places` 경로 및 HTTP `200`만 나온다. 요청 헤더·쿠키를 표시하는 네트워크 및 저장소 패널은 열지 않는다. 브라우저에 붙여넣기 제한이 있으면 촬영 전에 확인하거나 아래 한 줄을 직접 입력한다.

```javascript
Promise.all(['/api/auth/me', '/api/places'].map(async path => [path, (await fetch(path)).status])).then(rows => { console.table(rows); return rows; })
```

4. 같은 터미널에서 `docker exec "$prefix-redis" redis-cli DBSIZE`를 다시 실행한다. 새 전용 Redis에서 로그인 전 `0`, 로그인 후 `1`이다. 브라우저의 두 `200`과 함께 같은 세션이 공유 저장소를 통해 양쪽에서 인식되는 화면을 담는다.

## 3. 장소 저장, MySQL 재시작, 화면 재조회

웹 콘솔을 닫는다. 브라우저에서 **+ 장소 저장**을 눌러 이름 `시연용 카페`, 카테고리 `카페`로 저장한다. 목록에 제목이 보이면 Bash에서 다음 순서로 실행한다. `docker restart` 명령과 컨테이너 이름이 화면에 보이도록 이 줄을 따로 실행한다.

```bash
docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}} -> {{.Destination}}{{end}}{{end}}' "$prefix-db"
before=$(demo_row)
test -n "$before"
printf 'Before: %s\n' "$before"
```

```bash
docker restart "$prefix-db"
```

```bash
wait_health "$prefix-db"
after=$(demo_row)
printf 'After:  %s\n' "$after"
test "$before" = "$after" && printf 'PASS: same place ID, title and category\n'
```

마지막으로 브라우저를 새로고침해 같은 로그인 상태와 `시연용 카페`가 다시 표시되는 장면에서 종료한다. 보고서용으로 필요한 `docker network inspect`와 대화형 `docker exec -it … bash` 화면은 영상 시간과 별도로 확보할 수 있다. [제출 증빙 체크리스트](evidence-checklist.md)

## 4. 리허설 및 촬영 시간

| 목표 시간 | 화면에 담을 내용 |
| --- | --- |
| 0:00~1:00 | 격리 Bridge·Volume 생성, 개별 `docker run`, 비공개 계정 초기화, QEMU 옵션 설명 |
| 1:00~1:25 | `docker ps`의 6개 이름, 포트와 헬스 상태, Nginx 경유 앱 응답 |
| 1:25~2:00 | URL, 브라우저 로그인, 콘솔의 양 API 200, Redis `0 → 1` |
| 2:00~2:55 | 합성 장소 저장, Volume과 Before, 명시적 `docker restart`, After와 브라우저 새로고침 |

### 실제 리허설 · 2026-11-22 KST

Ubuntu 24.04 ARM64, Docker 29.1.3, 격리 ID `demo-113-a`, 브라우저 `http://127.0.0.1:8283/login.html`에서 실행했다. 이미지·환경 파일·Firefox 준비 후, 문서의 명령 블록을 Bash PTY에 각각 순서대로 입력했다. Docker 명령, 브라우저 로그인과 장소 저장, 두 API 요청, MySQL 재시작 및 재조회가 실제로 실행됐다. Firefox 입력과 클릭에는 WebDriver를 사용했다. 명령 블록 전환에 주로 2초씩, 숨김 암호 입력에 각각 4초, 브라우저 조작에도 단계별 대기를 넣었다.

| 시작 후 시각 | 관찰 결과 |
| --- | --- |
| 44.2초 | 6개 서비스의 개별 `docker run` 완료. 두 계정의 초기화 컨테이너는 종료됨 |
| 50.6초 | `docker ps`에 실행 중인 6개 표시. MySQL·Redis·Nginx `healthy`, Frontend와 두 API의 Nginx 경유 응답 `200`, 로그인 전 Redis `0` |
| 65.8초 | Firefox의 실제 로그인 폼으로 사용자 A 로그인 |
| 73.1초 | 같은 브라우저 세션에서 `/api/auth/me`와 `/api/places` 각각 `200`, Redis `1` |
| 84.4초 | 브라우저로 합성 장소 저장, Named Volume과 SQL `Before` 행 확인 |
| 95.6초 | 개별 `docker restart` 후 healthy, SQL `After` 행 확인. ID `1`, 제목 `시연용 카페`, 카테고리 `카페` 일치 |
| **99.3초** | Firefox 새로고침 후 같은 사용자와 장소 표시 확인 |

이 환경에서 측정한 순서는 **1분 39.3초**로, 3분까지 **80.7초**가 남았다. 사람이 직접 입력하거나 설명하며 움직이는 시간과 Mac SSH 터널 경유 지연은 측정하지 않았다. 촬영자는 실제 사용할 화면과 프로필에서 한 번 연속 실행해 최종 시간을 확인한다. 촬영과 업로드는 수행하지 않았다. 리허설 리소스와 기존 격리 리소스는 보존했고, 운영 컨테이너·네트워크·볼륨의 확인 항목은 작업 전후 동일했다.
