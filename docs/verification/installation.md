# Docker Hub 설치 및 검증 가이드

2026-11-22 KST 기준. 저장소 루트의 Bash에서 실행한다. Docker Engine, Bash, Python 3, `curl`이 필요하다. 소스 빌드와 원격 매니페스트 조회에는 Docker Buildx가 필요하다. 원격 Docker 데몬을 쓰는 경우 SQL·Nginx 설정 파일과 에뮬레이터가 데몬 호스트의 마운트 경로에도 있어야 한다. [기획서](../design/proposal.md) · [구현 결정서](../design/implementation-decisions.md)

## 1. 이미지 받기 또는 빌드하기

### Docker Hub에서 설치

게시된 세 앱은 `linux/amd64`다. 일반 설치에는 AMD64 Docker 엔진을 사용한다. 기존 Ubuntu 24.04 ARM64에서는 §2의 개별 QEMU 실행으로 격리 검증할 수 있다. 아래 표는 2026-11-23 KST에 Docker Hub의 `1.0` 태그에서 확인한 최종 게시 이미지다. `--hub` 설치에서는 `infra/images.env`의 `FRONT_HUB`, `USER_HUB`, `PLACE_HUB`에 고정된 다이제스트를 사용한다.

| 앱 | 운영 ARM64 태그 | Docker Hub Public 태그 | 원격 매니페스트 SHA-256 |
| --- | --- | --- | --- |
| Frontend | `ourspot-front:0.4` | [`baeyunsun0619/ourspot-front:1.0`](https://hub.docker.com/r/baeyunsun0619/ourspot-front/tags) | `f8832a714e64d565f0cea1eee18361fbcb25b194fcf9667c0c46d6a005951d87` |
| User API | `ourspot-user-api:0.2` | [`baeyunsun0619/ourspot-user-api:1.0`](https://hub.docker.com/r/baeyunsun0619/ourspot-user-api/tags) | `c36d15b76f603203138ccf01013c018d37bbf4cfc6740addbb4b33dc8ea350bd` |
| Place API | `ourspot-place-api:0.6` | [`baeyunsun0619/ourspot-place-api:1.0`](https://hub.docker.com/r/baeyunsun0619/ourspot-place-api/tags) | `6f76904dd352b55db073d78c83da07c3b527186fa7413312cfab76b7799513d5` |

기존 시연 영상과 §4의 2026-11-22 격리 검증은 재게시 전 이미지를 기준으로 한다. 당시 이미지에 고정된 세 다이제스트는 위 표의 최종 게시 값과 다르다. [재게시 전 이미지 목록](https://github.com/baeys0619/ourspot/blob/ecc19fd1729d729b13f9dd82d35837fda98b30e8/infra/images.env#L14-L16)

운영과 게시 이미지는 같은 앱 소스를 각 CPU 아키텍처용으로 빌드한 결과다. Frontend와 API 코드는 각각의 Dockerfile에 의해 이미지에 복사된다. 설치에 필요한 저장소 파일은 초기화 SQL, Nginx 설정, 이미지 목록과 설치 스크립트다.

```bash
set -euo pipefail
source infra/images.env
docker version --format 'Docker server {{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}'
for expected in "$FRONT_HUB" "$USER_HUB" "$PLACE_HUB"; do
  tag="${expected%@*}:1.0"
  docker buildx imagetools inspect "$tag" # Buildx 미설치 시 이 조회 줄은 생략 가능
  docker pull --platform linux/amd64 "$tag"
  docker image inspect -f '{{.Os}}/{{.Architecture}} {{json .RepoDigests}}' "$tag"
  test "$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$expected")" = linux/amd64
  docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$tag" | grep -Fx "$expected"
done
```

### 소스에서 AMD64 이미지 빌드

AMD64 호스트에서는 기본 Buildx 빌더를 사용할 수 있다. ARM64에서 교차 빌드할 때는 AMD64 빌드 명령을 처리하는 원격 빌더 또는 별도의 `docker-container` BuildKit 빌더를 `BUILDX_BUILDER`로 선택한다. 이번 ARM64 검증에서는 BuildKit에 포함된 에뮬레이터로 `npm ci` 단계를 실행했다. BuildKit 에뮬레이션은 빌드 단계에만 적용된다. Docker Hub 설치용 태그에 대한 게시 권한은 필요 없다.

ARM64 검증에 사용한 별도 빌더의 생성 명령이다. 빌더 이름을 지정하고 같은 셸에서 빌드 단계로 진행한다.

```bash
docker buildx create --name ourspot-install-build-113 --driver docker-container \
  --driver-opt memory=1g,cpu-period=100000,cpu-quota=100000,image=moby/buildkit@sha256:59795d5a98a9e12ddf49567fcd1976a30f2d2a60ef469c2f9cedb9e5e3251b25
export BUILDX_BUILDER=ourspot-install-build-113
```

```bash
source infra/images.env
docker buildx build --platform linux/amd64 --load --provenance=false \
  --build-arg "FRONT_BASE=$FRONT_BASE" -f frontend/Dockerfile -t "${FRONT_LOCAL}-amd64" .
docker buildx build --platform linux/amd64 --load --provenance=false \
  --build-arg "NODE_BASE=$NODE_BASE" --build-arg SERVICE=user-api \
  -f services/Dockerfile -t "${USER_LOCAL}-amd64" .
docker buildx build --platform linux/amd64 --load --provenance=false \
  --build-arg "NODE_BASE=$NODE_BASE" --build-arg SERVICE=place-api \
  -f services/Dockerfile -t "${PLACE_LOCAL}-amd64" .
docker image inspect -f '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}}' \
  "${FRONT_LOCAL}-amd64" "${USER_LOCAL}-amd64" "${PLACE_LOCAL}-amd64"
```

`bash scripts/build.sh --amd64`는 위 세 빌드를 실행한다. `bash scripts/build.sh`는 네이티브 태그 `0.4`, `0.2`, `0.6`으로 빌드한다. 운영 호스트에서 네이티브 태그를 다시 빌드하려면 운영 변경 범위를 먼저 확인한다.

## 2. 6개 컨테이너 시작

새 설치 ID를 사용한다. `--isolated`는 `ourspot-install-ID-net`, `ourspot-install-ID-db-data`, `ourspot-install-ID-*` 컨테이너와 전용 `.runtime/ourspot-install-ID/`를 사용한다. Nginx에만 `127.0.0.1` 임의 포트를 할당한다. Bridge 내부 DNS 별칭은 기존 설정과 동일하다. 네이티브 신규 설치의 기본 이름과 포트는 `ourspot-*`, `8080`이다.

```bash
source infra/images.env
host=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
for image in "$MYSQL_IMAGE" "$REDIS_IMAGE" "$NGINX_IMAGE"; do
  docker pull --platform "$host" "$image"
done

# AMD64 Docker 엔진에서 실행. 위에서 선택한 앱 이미지 경로 한 줄을 사용한다.
bash scripts/up.sh --hub --isolated submission-hub
# bash scripts/up.sh --amd64 --isolated submission-source
```

ARM64의 경우 출처와 무결성을 확인한 호스트용 정적 `qemu-x86_64`가 이미 준비돼 있을 때 다음 명령을 사용한다. 절대 경로는 컨테이너를 보존하는 기간 동안 유지한다. 검증에서 사용한 기존 BuildKit 에뮬레이터는 AArch64 정적 ELF였으며, 파일 SHA-256은 `d02e1860d3a9130557e627e11751a7ef82acb985b1db17dc864a9a4cbea79abf`였다. QEMU는 Apache와 Node 실행에만 연결한다. MySQL·Redis·Nginx는 호스트 네이티브이며, Nginx 헬스체크에서 세 앱 HTTP 응답을 검사한다.

```bash
# QEMU에 설치된 정적 실행 파일의 절대 경로를 지정한다.
bash scripts/up.sh --hub --isolated submission-hub --qemu "$QEMU"
# 소스 빌드 이미지 경로는 --hub 대신 --amd64를 사용한다.
```

### 환경 설정과 첫 계정

`scripts/configure.py`가 첫 실행 때 환경 파일을 `0600` 권한으로 생성한다. `seed-users.sh`는 계정이 비어 있을 때 A/B 비밀번호를 각각 두 번 숨김 입력받아 표준입력으로 전달한다. 서로 다른 1~72 UTF-8 바이트를 사용한다. 초기 데이터는 A/B 계정 두 개이며 장소와 코멘트는 0건이다. DB와 Redis까지만 준비된 경우 같은 설치 인자에 `--reuse-dependencies`를 추가하면 계정 초기화 단계부터 이어간다. 기존 볼륨을 사용할 때 원래 `db.env`와 `api.env`를 함께 보존한다.

| 파일 | 환경변수 | 역할 |
| --- | --- | --- |
| `db.env` | `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` | `ourspot` DB와 `ourspot_app` 계정, 앱 DB 암호와 별도 DB 관리자 암호 생성 |
| `api.env` | `NODE_ENV`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | 프로덕션 Node 모드, `ourspot-db:3306` 내부 접속과 같은 앱 DB 암호 |
| `api.env` | `REDIS_URL`, `SESSION_SECRET`, `COOKIE_SECURE` | 두 API가 `redis://ourspot-redis:6379/0`와 하나의 쿠키 서명값 공유. 루프백 HTTP에서는 `COOKIE_SECURE=false` |

### 전체 `docker run` 명령과 실행 순서

아래는 스크립트 없이 실행할 때의 명령이다. 위 스크립트로 설치했다면 §3으로 이동한다. `submission-manual` 자리에 사용 중인 컨테이너·네트워크·볼륨과 겹치지 않는 새 ID를 사용한다. 공식 이미지는 `infra/images.env`에서 고정한 Nginx 1.28.0, MySQL 8.4.13, Redis 7.4.12의 멀티 플랫폼 digest다.

```bash
set -euo pipefail
source infra/images.env
prefix=ourspot-install-submission-manual
net=$prefix-net
vol=$prefix-db-data
runtime=.runtime/$prefix
host=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
front=$FRONT_HUB; user=$USER_HUB; place=$PLACE_HUB
# 소스 AMD64 빌드를 선택한 경우
# front=${FRONT_LOCAL}-amd64; user=${USER_LOCAL}-amd64; place=${PLACE_LOCAL}-amd64
app=(--pull=never --platform linux/amd64)
node_cmd=(); front_cmd=()
if [[ "$host" == linux/arm64 && -x "${QEMU:-}" && "$QEMU" == /* ]]; then
  app+=(--no-healthcheck --mount "type=bind,src=$QEMU,dst=/run/ourspot-qemu-x86_64,readonly"
    --entrypoint /run/ourspot-qemu-x86_64)
  node_cmd=(/usr/local/bin/node server.cjs)
  front_cmd=(/usr/local/apache2/bin/httpd -DFOREGROUND)
elif [[ "$host" == linux/amd64 ]]; then
  QEMU=
else
  echo 'AMD64 엔진 또는 ARM64 격리 QEMU 필요' >&2
  exit 1
fi
for service in db redis user-api place-api front proxy; do
  if docker container inspect "$prefix-$service" >/dev/null 2>&1; then exit 1; fi
done
if docker network inspect "$net" >/dev/null 2>&1 || docker volume inspect "$vol" >/dev/null 2>&1; then exit 1; fi
OURSPOT_RUNTIME_DIR="$runtime" python3 scripts/configure.py
docker network create --driver bridge "$net"
docker volume create "$vol"

docker run -d --name "$prefix-db" --network "$net" --network-alias ourspot-db \
  --restart unless-stopped --platform "$host" --env-file "$runtime/db.env" \
  --mount "source=$vol,target=/var/lib/mysql" \
  --mount "type=bind,src=$PWD/database/init,dst=/docker-entrypoint-initdb.d,readonly" \
  --health-cmd='MYSQL_PWD="$MYSQL_PASSWORD" mysql -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "SELECT COUNT(*) FROM users"' \
  --health-interval=5s --health-timeout=4s --health-start-period=60s --health-retries=30 \
  "$MYSQL_IMAGE" --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --default-time-zone=+00:00

docker run -d --name "$prefix-redis" --network "$net" --network-alias ourspot-redis \
  --restart unless-stopped --platform "$host" --tmpfs /data \
  --health-cmd='redis-cli ping | grep -qx PONG' --health-interval=5s --health-timeout=3s --health-retries=10 \
  "$REDIS_IMAGE" redis-server --save '' --appendonly no

wait_health() {
  for _ in {1..90}; do
    if [[ "$(docker inspect -f '{{.State.Status}} {{.State.Health.Status}}' "$1")" == 'running healthy' ]]; then return; fi
    sleep 2
  done
  return 1
}
wait_health "$prefix-db"
wait_health "$prefix-redis"

# 내부에서 아래 두 초기화 docker run을 수행하고, 이미 두 계정이 있으면 쓰기는 생략한다.
OURSPOT_INSTALL_PREFIX="$prefix" OURSPOT_RUNTIME_DIR="$runtime" OURSPOT_USER_IMAGE="$user" \
  OURSPOT_QEMU="$QEMU" bash scripts/seed-users.sh

docker run -d --name "$prefix-user-api" --network "$net" --network-alias ourspot-user-api \
  --restart unless-stopped "${app[@]}" --env-file "$runtime/api.env" "$user" "${node_cmd[@]}"
docker run -d --name "$prefix-place-api" --network "$net" --network-alias ourspot-place-api \
  --restart unless-stopped "${app[@]}" --env-file "$runtime/api.env" "$place" "${node_cmd[@]}"
docker run -d --name "$prefix-front" --network "$net" --network-alias ourspot-front \
  --restart unless-stopped "${app[@]}" "$front" "${front_cmd[@]}"
docker run -d --name "$prefix-proxy" --network "$net" --network-alias ourspot-proxy \
  --restart unless-stopped --platform "$host" -p 127.0.0.1::80 \
  --mount "type=bind,src=$PWD/infra/nginx/default.conf,dst=/etc/nginx/conf.d/default.conf,readonly" \
  --health-cmd='for path in / /api/auth/health /api/places/health; do curl --fail --silent --max-time 2 "http://127.0.0.1$path" >/dev/null || exit 1; done' \
  --health-interval=5s --health-timeout=8s --health-start-period=20s --health-retries=10 "$NGINX_IMAGE"

if [[ -z "$QEMU" ]]; then
  for service in user-api place-api front; do wait_health "$prefix-$service"; done
fi
wait_health "$prefix-proxy"
docker port "$prefix-proxy" 80/tcp
```

계정 초기화의 실제 내부 명령이다. 이 두 명령은 위 `seed-users.sh` 호출에 포함된다. `$password_a`와 `$password_b`는 스크립트의 `read -rs` 비공개 입력으로 얻은 비수출 Bash 변수다. 스크립트는 셸 추적을 끄고 이후 초기화 명령을 실행한다.

```bash
seed_opts=(); seed_node=node
if [[ -n "$QEMU" ]]; then
  seed_opts=(--platform linux/amd64 --no-healthcheck
    --mount "type=bind,src=$QEMU,dst=/run/ourspot-qemu-x86_64,readonly"
    --entrypoint /run/ourspot-qemu-x86_64)
  seed_node=/usr/local/bin/node
fi
docker run --pull=never --network "$net" --env-file "$runtime/api.env" "${seed_opts[@]}" \
  --name "$prefix-seed-check-$$" "$user" "$seed_node" seed-users.cjs --check
# 상태가 empty일 때만 수행
printf '%s\n%s\n' "$password_a" "$password_b" | \
  docker run --pull=never --network "$net" --env-file "$runtime/api.env" "${seed_opts[@]}" \
    --name "$prefix-seed-write-$$" -i "$user" "$seed_node" seed-users.cjs
```

## 3. 실행과 영속성 확인

```bash
id=submission-hub # 실제 설치 ID로 변경
prefix=ourspot-install-$id
docker ps --filter "network=$prefix-net" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker network inspect -f '{{.Name}} {{.Driver}}{{range .Containers}}{{println}}{{.Name}} {{.IPv4Address}}{{end}}' "$prefix-net"
docker exec -it "$prefix-proxy" bash
# 위 Bash에서 id -un, pwd, exit 입력
endpoint=$(docker port "$prefix-proxy" 80/tcp)
for path in / /login.html /api/auth/health /api/places/health; do
  curl --fail --silent --output /dev/null --write-out "$path %{http_code}\n" "http://$endpoint$path"
done
docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Type}} {{.Name}} -> {{.Destination}}{{end}}{{end}}' "$prefix-db"
python3 scripts/verify-install.py "$id"
```

브라우저에서 `http://` 뒤에 `docker port`가 출력한 주소를 붙여 연다. 다른 컴퓨터에서 브라우저를 쓸 경우 SSH 로컬 포워딩으로 그 Ubuntu 루프백 포트에 연결한다. 같은 로컬 호스트의 다른 포트에 설치된 로그인과 쿠키가 겹치지 않도록 별도 브라우저 프로필을 사용한다.

`verify-install.py`는 두 비밀번호를 다시 숨김 입력받는다. 익명 요청의 401, 로그인과 두 API의 동일 쿠키 200, Redis TTL, A가 등록한 장소와 일정을 B가 읽고 코멘트를 쓰는 과정을 확인한다. 이름이 지정된 격리 MySQL만 재시작하고 같은 API에서 장소·일정·코멘트 전체 응답을 비교한다. 로그아웃 후 Redis 키 부재와 두 API의 401도 검사한다. 화면에는 상태와 합성 레코드 ID만 표시된다.

### 합성 DB 백업 및 복원

백업에는 테스트 계정의 해시가 포함된다. `.runtime`에만 저장한다. 대상은 §2의 MySQL 초기화 명령으로 새 ID와 새 Named Volume에 만든 빈 스키마다. 대상 MySQL이 healthy인 것을 확인하고, **Redis와 계정 seed보다 먼저** 복원한다. 복원된 사용자 비밀번호는 백업 원본의 초기 계정 비밀번호다. 복원 후 Redis를 §2대로 띄우고 `--reuse-dependencies`로 나머지 컨테이너를 설치할 수 있다.

```bash
source_db=ourspot-install-submission-hub-db
target_db=ourspot-install-submission-restore-db
backup=.runtime/ourspot-install-submission-hub/verification-backup.sql
umask 077
test "$source_db" != "$target_db"
docker exec "$source_db" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump -u"$MYSQL_USER" --single-transaction --no-tablespaces --set-gtid-purged=OFF --no-create-info --skip-add-locks --skip-disable-keys "$MYSQL_DATABASE" users places place_comments' > "$backup"
test -s "$backup"
sql() {
  docker exec "$1" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --batch --raw --skip-column-names -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "$1"' sh "$2"
}
counts='SELECT (SELECT COUNT(*) FROM users), (SELECT COUNT(*) FROM places), (SELECT COUNT(*) FROM place_comments)'
test "$(sql "$target_db" "$counts")" = $'0\t0\t0'
docker exec -i "$target_db" sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"' < "$backup"
rows='SELECT id,email,display_name,couple_id FROM users ORDER BY id; SELECT * FROM places ORDER BY id; SELECT * FROM place_comments ORDER BY id'
test "$(sql "$source_db" "$rows")" = "$(sql "$target_db" "$rows")"
sql "$target_db" "$counts"
```

## 4. 2026-11-22 KST 격리 검증 기록

Ubuntu 24.04 `linux/arm64` · Docker 29.1.3 · Bridge `ourspot-install-hub-113-net` · 볼륨 `ourspot-install-hub-113-db-data` · `127.0.0.1:32797 → 80/tcp`. 격리 검증에 합성 비밀번호와 레코드만 사용했다.

| 검사 | 관찰 결과 |
| --- | --- |
| Hub 태그, 원격 digest, 플랫폼 | 3개 공개 매니페스트와 digest 일치. `docker pull --platform linux/amd64` 3개 성공, 로컬은 `Image is up to date`로 기존 캐시 레이어를 재사용. `inspect` 3개 `linux/amd64` |
| 6개 기동 | 모두 `running`. MySQL·Redis·Nginx `healthy`. QEMU의 Frontend·User API·Place API는 자체 헬스체크를 끄고 Nginx에서 `/`, `/api/auth/health`, `/api/places/health` 200 확인 |
| 브라우저 및 런타임 | Firefox에서 `/` 접속 후 로그인 화면으로 이동해 빈 로그인 폼을 표시했다. 정적 파일 6개가 저장소와 바이트 단위로 일치하고, 두 API의 Node가 `linux/x64`를 반환 |
| 인증과 세션 | A/B 로그인 각각 200, 각 쿠키로 User API `/me`와 Place API `/api/places` 각각 200. Redis TTL 각각 86400초, 로그아웃 후 키 부재 및 기존 쿠키 양쪽 401 |
| 저장, 조회와 재시작 | A가 장소 ID 1과 한국 날짜 일정을 저장하고 B가 조회 및 코멘트 ID 1 작성. Named Volume이 `/var/lib/mysql`에 연결됨. MySQL 재시작부터 healthy까지 8.4초, 재시작 후 동일한 장소·일정·코멘트 응답 |
| 설치 소요 | 이미지 및 에뮬레이터 준비 후 기동 24.8초, 전체 API 검증과 DB 재시작까지 35.8초. 비밀번호는 자동 시험 입력으로 측정 |
| 백업 및 복원 | 별도 `ourspot-install-restore-113-db-data`의 빈 스키마에 복원했다. 사용자 2명·장소 1개·코멘트 1개와 선택한 행 값 일치 |
| AMD64 소스 빌드 | 3개 로컬 태그를 새로 빌드해 `linux/amd64` 확인. 복원한 DB에서 `--amd64 --reuse-dependencies`로 이미 설치된 계정을 유지하며 6개 기동, `127.0.0.1:32798`의 `/`, `/login.html`, 두 API 헬스 경로 모두 200 |
| 운영 상태 대조 | 6개 운영 컨테이너 ID·이미지·헬스·시작 시각·재시작 횟수·마운트, 운영 Bridge 및 DB Volume 전후 일치. 격리 리소스와 빌더는 보존 |

별도 AMD64 Docker 호스트에서 게시 이미지 6개의 기본 Docker 헬스체크를 검증하는 작업과, 이미지 레이어가 없는 엔진에서의 다운로드는 남아 있다. 운영 ARM64 6개 및 포트 8080은 기존 [운영 증빙](infrastructure.md)에 기록돼 있다.

## 5. 3분 무편집 시연

촬영 직전에 이미지와 필요한 파일을 준비하고, 새 설치 ID와 테스트 A/B 비밀번호를 정한다. Bash와 브라우저를 나란히 배치하고, 포트가 자동 할당되면 `docker port`가 표시한 루프백 주소를 브라우저에 붙여 넣는다. 다른 컴퓨터에서 녹화할 경우 리허설에서 SSH 포워딩을 준비하고 접속 시간을 포함한다. DB 재시작과 비공개 입력을 포함해 리허설에서 실제 시간을 잰다.

| 예상 구간 | 실행 및 캡처 화면 |
| --- | --- |
| 0:00~0:50 | `bash scripts/up.sh --hub --isolated demo-01` 실행 및 A/B 비공개 입력. ARM64 격리 시 QEMU 인자도 사용. Docker 실행 순서는 §2에 기록돼 있다. 프록시 접속 주소가 표시된 줄을 촬영 |
| 0:50~1:15 | `docker ps --filter network=ourspot-install-demo-01-net`으로 6개와 포트를 보여준다. `docker network inspect`로 Bridge, `docker inspect`로 MySQL 볼륨 이름과 마운트 경로를 보여준다 |
| 1:15~1:45 | 브라우저에서 Nginx 주소로 접속해 A 로그인과 장소·일정 화면을 보여준다 |
| 1:45~2:35 | `python3 scripts/verify-install.py demo-01` 실행 및 A/B 비공개 입력. 두 API 200과 TTL, MySQL 재시작 전후 동일 ID와 결과 줄이 화면에 들어오게 한다 |
| 2:35~3:00 | 재조회된 합성 장소나 일정, 최종 6개 상태를 보여주고 종료 |

보고서용 정지 캡처는 원격 digest와 플랫폼, 6개 이름과 포트, Bridge 멤버, `docker exec -it ... bash`와 `id -un`, Nginx 로그인 화면, Redis TTL과 양 API 200, MySQL 볼륨과 재시작 전후 결과를 담는다. 환경 파일 내용, 쿠키 헤더, 비밀번호, Redis 키, 백업 SQL 본문은 화면에서 제외한다. 최종 보고서와 시연 영상 링크는 촬영 후 첨부한다.
