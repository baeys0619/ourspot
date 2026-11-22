# MySQL Volume Mount와 데이터 영속성

**기준** · 기획서 9.4·10.4 및 구현 결정서 V15에 따라 운영 데이터 디렉터리와 Named Volume 연결을 조회하고, 별도 MySQL에서 재시작 전후의 장소·코멘트 ID와 내용이 일치하는지 검사한다. Ubuntu 24.04 ARM64, Docker 29.1.3, MySQL 8.4.13 환경이다. [기획서](../design/proposal.md) · [구현 결정서](../design/implementation-decisions.md)

## 운영 MySQL · PASS

2026-11-22 20:03~20:12 KST. 기대 결과는 `ourspot-db`의 healthy 상태, `ourspot-db-data`에서 `/var/lib/mysql`로의 마운트, 읽기 전용 점검 전후 행 수 일치다.

```bash
docker inspect ourspot-db -f '{{.State.Status}} {{.State.Health.Status}} {{.State.StartedAt}} {{.RestartCount}}{{range .Mounts}}{{if eq .Type "volume"}} {{.Name}}:{{.Destination}} rw={{.RW}}{{end}}{{end}}'
docker volume inspect ourspot-db-data --format '{{.Name}} {{.Driver}} {{.Scope}} {{.Mountpoint}}'
docker exec ourspot-db bash -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" --batch --raw --execute "SELECT @@datadir AS datadir, @@version AS version; START TRANSACTION READ ONLY; SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(DISTINCT couple_id) FROM users) AS couples, (SELECT COUNT(*) FROM places) AS places, (SELECT COUNT(*) FROM place_comments) AS comments; COMMIT;"'
```

실제 조회 결과를 발췌했다.

```text
ourspot-db-data local local /var/lib/docker/volumes/ourspot-db-data/_data
datadir         version
/var/lib/mysql/ 8.4.13
users   couples places  comments
2       1       0       0
```

컨테이너 ID 앞 12자리는 `d829bcf72ef8`이며 `ourspot-db-data:/var/lib/mysql:rw=true`로 마운트됐다. `running/healthy`, `StartedAt=2026-11-21T15:37:17.743717294Z`, `RestartCount=0`이 점검 전후 일치했다. 집계도 사용자 2, 커플 1, 장소 0, 코멘트 0으로 일치했다. 운영 DB 검증은 읽기 전용 조회를 수행했으며, 집계는 해당 시점의 행 수를 보여준다.

## 격리 MySQL 재시작 · PASS

2026-11-22 20:05 KST. 별도 내부 Bridge, 새 Named Volume, 실험 전용 접속 정보, 호스트 게시 포트 없이 실행했다. 스크립트는 배포와 같은 MySQL 이미지 digest와 저장소의 초기화 SQL로 실험 DB를 만든다. 테스트 사용자·장소·코멘트 각 1개를 넣고, 동일한 컨테이너와 볼륨으로 `docker stop` 후 `docker start`를 실행한다. 기대 결과는 새 시작 시각과 같은 컨테이너 ID, 같은 볼륨, 동일한 장소·코멘트 행이다.

```bash
bash scripts/verify-mysql-persistence.sh
```

| 생성된 실험 자원 | 실제 구성 |
| --- | --- |
| 네트워크 | `ourspot-persist-20261122110516-16bb878f-net`, Bridge, `internal=true` |
| 볼륨 | `ourspot-persist-20261122110516-16bb878f-data`, local, `/var/lib/mysql` |
| 컨테이너 | `ourspot-persist-20261122110516-16bb878f-db`, ID 앞 12자리 `6ee3aab46bd1` |
| 이미지 | `a0225d1ea663`, `linux/arm64` |
| 게시 포트 | 없음. `{"3306/tcp":null,"33060/tcp":null}` |

실제 출력 발췌이며 DB 레코드와 Docker 시작 시각은 UTC다.

```text
BEFORE
place_id  title                place_created_at         comment_id  content                     comment_created_at
1         Persistence fixture  2026-11-22 11:05:26.807  1           Same content after restart  2026-11-22 11:05:26.807
docker stop (isolated)
ourspot-persist-20261122110516-16bb878f-db
state=exited
docker start (isolated)
ourspot-persist-20261122110516-16bb878f-db
AFTER
place_id  title                place_created_at         comment_id  content                     comment_created_at
1         Persistence fixture  2026-11-22 11:05:26.807  1           Same content after restart  2026-11-22 11:05:26.807
PASS identical place/comment IDs, content and timestamps after restart
retained=/ourspot-persist-20261122110516-16bb878f-db state=exited
```

동일 컨테이너 ID에서 시작 시각이 `11:05:16.466900669Z`에서 `11:05:28.479161565Z`로 바뀌었고, 양쪽 마운트가 일치했으며 재시작 후 healthy였다. 재시작 실험 종료 시점에 컨테이너를 중지하고 격리 자원을 보존했다. [실험 코드](../../scripts/verify-mysql-persistence.sh)

## 격리 MySQL 컨테이너 재생성 · PASS

2026-11-22 20:12:33 KST에 사용자가 승인한 위 격리 컨테이너 한 개를 대상으로 실험했다. 기존 ID와 격리 네트워크·마운트를 확인하고 같은 조회로 재생성 전 스냅샷을 메모리에 보관했다. 실행한 핵심 명령은 아래와 같다. `db`, `network`, `volume`은 위 표의 값이며 `old_id`는 삭제 전 컨테이너 ID다. `MYSQL_IMAGE`는 고정 이미지 digest이며 `private_env`는 격리 컨테이너에서 선택한 DB 환경 변수 네 개를 담은 임시 파일 경로다. 임시 파일은 `mktemp`로 생성해 재생성 직후 삭제했다.

```bash
docker start "$old_id"
docker stop "$old_id"
docker rm "$old_id"
docker volume inspect "$volume" -f 'retained volume={{.Name}} driver={{.Driver}}'
docker run -d --pull=never --name "$db" --network "$network" \
  --env-file "$private_env" --mount "type=volume,src=$volume,dst=/var/lib/mysql" \
  --mount "type=bind,src=$PWD/database/init,dst=/docker-entrypoint-initdb.d,readonly" \
  --health-cmd='MYSQL_PWD="$MYSQL_PASSWORD" mysql -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "SELECT COUNT(*) FROM places"' \
  --health-interval=2s --health-timeout=3s --health-retries=45 \
  "$MYSQL_IMAGE" --character-set-server=utf8mb4 --default-time-zone=+00:00
```

재생성 전후 `places`와 `place_comments`를 같은 SQL로 조회했다. 기대한 대로 새 ID의 컨테이너가 healthy였고, 같은 Named Volume이 같은 경로에 연결됐으며 장소·코멘트를 조인한 조회 결과가 일치했다. 실제 출력에서 식별자와 판정 줄을 발췌했다.

```text
BEFORE container=6ee3aab46bd14a01935de19112725b36bc6651937aa9576bc37b03d7ffcc94ce
retained volume=ourspot-persist-20261122110516-16bb878f-data driver=local
container=f1d0bbed1646c82f31ed58ff4cd00aea7f3813e6650f201c890b76bd7dcb37be health=healthy started=2026-11-22T11:12:39.501417756Z mount=ourspot-persist-20261122110516-16bb878f-data:/var/lib/mysql ports={"3306/tcp":null,"33060/tcp":null}
AFTER container=f1d0bbed1646c82f31ed58ff4cd00aea7f3813e6650f201c890b76bd7dcb37be
PASS identical place/comment IDs, content and timestamps after container recreation
retained=/ourspot-persist-20261122110516-16bb878f-db state=exited
```

재생성 전후 장소·코멘트의 ID는 각각 `1`과 `1`이고 내용과 UTC 시각은 위 재시작 실험에서 기록한 행과 같았다. `docker rm`에는 볼륨 삭제 옵션을 사용하지 않았으며, 새 컨테이너를 중지한 상태에서 격리 네트워크와 볼륨을 보존했다. 운영 MySQL의 재시작·재생성에 관한 실험 결과는 없다. 20:12:55 KST에 운영 컨테이너의 시작 시각, 재시작 횟수와 DB 집계를 다시 조회해 이전 관측값과 일치함을 확인했다.

**촬영** · Ubuntu 터미널에서 운영 `docker inspect`와 `docker volume inspect`의 마운트 출력, 읽기 전용 집계를 촬영한다. 격리 증거는 스크립트의 리소스명, `BEFORE`, stop/start, `AFTER`, PASS가 보이게 캡처한다. 스크립트를 다시 실행하면 새 이름으로 독립 실험이 생성되므로 제출에 사용하는 캡처의 리소스명과 시각을 함께 적는다.

**보고서 문장** · 운영 MySQL은 `ourspot-db-data`를 `/var/lib/mysql`에 연결한다. 동일 MySQL 이미지의 격리 실험에서 별도 볼륨을 연결한 채 컨테이너를 재시작했으며, 이후 같은 장소와 코멘트의 ID·내용·생성 시각이 유지됐다. 승인된 격리 컨테이너 재생성 후에도 같은 볼륨에서 동일한 결과를 조회했다.
