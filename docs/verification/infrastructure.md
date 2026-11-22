# 운영 Docker 인프라 검증

2026-11-22 20:03~20:12 KST · UTM Ubuntu 24.04.5 LTS `aarch64` · Docker Server 29.1.3 `linux/arm64` · Docker context `default`. 소스 기준 커밋은 `39a7bb5d59b1be0d9af011e75488557e98fb9dbb`이다.

## 평가 기준과 판정

기획서 5장과 9~12장, 구현 결정서 1절과 V10·V15·V16을 검증 기준으로 사용했다. 기획서에 링크된 교수 공지 페이지는 접근 시 글이 없다는 응답을 반환했다. 장소·일정·코멘트 세부 기능은 프로젝트가 정한 범위이며 두 Express 서비스의 분리는 필수 백엔드 구성을 충족한다. 이기종 백엔드 가점은 해당하지 않는다. [기획서](../design/proposal.md) · [구현 결정서](../design/implementation-decisions.md) · [교수 공지 링크](https://hull.kr/cloud_native/28)

| 항목 | 기대 결과 | 판정 및 실제 결과 |
| --- | --- | --- |
| 컨테이너·이미지 | 최소 6개 운영 서비스와 ARM64 이미지 | PASS. 운영 6개 모두 `running/healthy`, 이미지 6개 모두 `linux/arm64` |
| 네트워크 | 6개 모두 동일 Bridge에 연결, 이름 해석 및 내부 통신 | PASS. `ourspot-net` 멤버 6개, DNS와 실제 HTTP/TCP 확인 |
| 포트 | 호스트 8080에서 프록시 80으로 진입, 내부 서비스 직접 게시 없음 | PASS. 운영 공개 포트는 프록시 8080 |
| 프록시·독립 백엔드 | 세 경로의 설정과 응답이 일치하고 API별 컨테이너가 다름 | PASS. 정적 파일과 양 API 헬스 200, 익명 보호 요청 401 |
| Redis 세션 | 같은 세션으로 양 API 인증, 로그아웃 후 이전 쿠키 거부 | PASS. [세션 공유 증거](session-sharing.md) |
| MySQL 볼륨·데이터 | 운영 Named Volume 연결, 재시작 전후 같은 장소·코멘트 확인 | PASS. 운영 마운트 조회와 격리 재시작·재생성 실험. [MySQL 증거](mysql-persistence.md) |
| 내부 bash | 지정 컨테이너에서 bash 진입 및 정상 종료 | PASS. 운영 6개 모두 성공 |
| Docker Hub·재설치·제출 | 게시된 태그로 독립 설치, 제출 증거 완성 | 미검증. [제출 체크리스트](evidence-checklist.md) |

## 컨테이너, 이미지와 포트

아래의 이미지 ID와 컨테이너 ID는 Docker 출력의 앞 12자리다. 프록시·DB·Redis의 컨테이너 설정은 [공식 이미지 digest](../../infra/images.env)를 사용하며 괄호 안 버전은 컨테이너에서 확인했다. 전체 ID는 아래 명령으로 확인한다. 모두 `unless-stopped`, `RestartCount=0`이었다.

| 운영 컨테이너 | 역할 | 이미지 태그 / 런타임 버전 | 이미지 ID | 컨테이너 ID | 내부 포트 | 호스트 게시 |
| --- | --- | --- | --- | --- | --- | --- |
| `ourspot-proxy` | Nginx Reverse Proxy | `nginx:1.28-bookworm` (1.28.0) | `552e7481ca93` | `9d568c329b91` | 80/tcp | `0.0.0.0:8080`, `[::]:8080` |
| `ourspot-front` | Apache 정적 프론트엔드 | `ourspot-front:0.4` (Apache 2.4.65) | `3a8861813f9d` | `29f3127e30bd` | 80/tcp | 없음 |
| `ourspot-user-api` | Express 사용자 인증 | `ourspot-user-api:0.2` | `7f68012c6603` | `08a681e17bb9` | 3000/tcp | 없음 |
| `ourspot-place-api` | Express 장소·일정·코멘트 | `ourspot-place-api:0.6` | `11b7004692de` | `99c047df0831` | 3000/tcp | 없음 |
| `ourspot-db` | MySQL 영구 데이터 | `mysql:8.4` (8.4.13) | `a0225d1ea663` | `d829bcf72ef8` | 3306/tcp, 33060/tcp | 없음 |
| `ourspot-redis` | Redis 인증 세션 | `redis:7.4-bookworm` (7.4.12) | `b6b6e3dc0c09` | `4f4fbda58d2f` | 6379/tcp | 없음 |

실행에 사용한 선택 조회 명령이다. 첫 명령의 전체 출력에서 운영·미리보기·중지 상태 보관 컨테이너를 확인했다. 촬영에는 운영 네트워크 필터를 사용한다.

```bash
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker ps --filter network=ourspot-net --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
names=(ourspot-{proxy,front,user-api,place-api,db,redis})
docker inspect -f '{{.Name}} {{.Id}} {{.Config.Image}} {{.Image}} {{.State.Status}} {{.State.Health.Status}} {{.HostConfig.RestartPolicy.Name}} restarts={{.RestartCount}} started={{.State.StartedAt}} {{json .NetworkSettings.Ports}} {{range $n, $_ := .NetworkSettings.Networks}}{{$n}} {{end}}' "${names[@]}"
docker image inspect -f '{{.Id}} {{.Os}}/{{.Architecture}} {{json .RepoTags}} {{json .RepoDigests}}' $(docker inspect -f '{{.Image}}' "${names[@]}")
docker exec ourspot-proxy nginx -v
docker exec ourspot-front httpd -v
docker exec ourspot-redis redis-server --version
```

2026-11-22 20:06:30 KST의 운영 네트워크 필터 출력이다.

```text
NAMES               IMAGE                   STATUS                    PORTS
ourspot-front       ourspot-front:0.4       Up 37 minutes (healthy)   80/tcp
ourspot-place-api   ourspot-place-api:0.6   Up 4 hours (healthy)      3000/tcp
ourspot-user-api    ourspot-user-api:0.2    Up 18 hours (healthy)     3000/tcp
ourspot-proxy       552e7481ca93            Up 19 hours (healthy)     0.0.0.0:8080->80/tcp, [::]:8080->80/tcp
ourspot-redis       b6b6e3dc0c09            Up 19 hours (healthy)     6379/tcp
ourspot-db          a0225d1ea663            Up 19 hours (healthy)     3306/tcp, 33060/tcp
```

`ourspot-auth-1805c06831-*` 6개는 별도 네트워크에서 기존 미리보기를 제공하며 프록시는 `127.0.0.1:8182→80`이다. 보관 컨테이너 8개는 `exited`였다. 프론트 두 개(`before-04`, `failed-04`), User API 한 개(`before-auth`), Place API 다섯 개(`before-auth`, `before-crud`, `before-schedule`, `before-visit`, `before-comments`)이다.

## 네트워크와 요청 흐름

```bash
docker network inspect ourspot-net -f '{{.Name}} {{.Driver}} {{.Scope}} {{range .Containers}}{{.Name}} {{end}}'
docker network inspect ourspot-net -f '{{range .IPAM.Config}}{{.Subnet}} {{.Gateway}}{{end}}'
for dst in ourspot-{proxy,front,user-api,place-api,db,redis}; do
  docker exec ourspot-proxy getent hosts "$dst"
done
for peer in ourspot-front:80 ourspot-user-api:3000 ourspot-place-api:3000; do
  path=/health
  [[ $peer != ourspot-front:80 ]] || path=/
  docker exec ourspot-proxy curl -fsS --max-time 5 -o /dev/null -w "$peer HTTP %{http_code}\n" "http://$peer$path"
done
for api in ourspot-user-api ourspot-place-api; do
  docker exec "$api" node -e 'const net=require("node:net"); for (const [host,port] of [["ourspot-db",3306],["ourspot-redis",6379]]) { const s=net.connect({host,port}); s.on("connect",()=>{console.log(process.env.HOSTNAME,host,port,s.remoteAddress,"TCP OK");s.end()}); s.setTimeout(3000,()=>s.destroy(new Error("timeout")));s.on("error",()=>{console.error(host,port,"TCP FAIL");process.exitCode=1}); }'
done
```

`ourspot-net bridge local`, 서브넷 `172.18.0.0/16`, 게이트웨이 `172.18.0.1`이었다. 아래 주소는 실행 시점의 Docker DNS 결과다. 설정에는 재생성 시 달라질 수 있는 IP 대신 컨테이너 이름을 사용한다.

| 연결 출발점 | 요청과 도착점 | 관찰 |
| --- | --- | --- |
| 브라우저·HTTP 클라이언트 | Ubuntu `192.168.64.7:8080` → `ourspot-proxy:80` | 프록시 DNS `172.18.0.2`, 호스트 주소에서 HTTP 확인 |
| `ourspot-proxy` | `/` 이하 정적 경로 → `ourspot-front:80` | DNS `172.18.0.7`, 내부 GET `/` 200 |
| `ourspot-proxy` | `/api/auth`, `/api/auth/*` → `ourspot-user-api:3000` | DNS `172.18.0.6`, 내부 GET `/health` 200 |
| `ourspot-proxy` | `/api/places`, `/api/places/*` → `ourspot-place-api:3000` | DNS `172.18.0.3`, 내부 GET `/health` 200 |
| 두 Express API | `ourspot-db:3306` | DNS `172.18.0.4`, 두 API에서 TCP OK 및 헬스의 MySQL 조회 성공 |
| 두 Express API | `ourspot-redis:6379` DB 0 | DNS `172.18.0.5`, 두 API에서 TCP OK 및 헬스의 Redis PING 성공. User API가 저장·삭제하고 Place API가 인증에 사용 |
| `ourspot-db` | `ourspot-db-data` → `/var/lib/mysql` | Named Volume 마운트와 MySQL 데이터 경로 일치 |

## Nginx 설정과 HTTP 응답

```bash
docker exec ourspot-proxy nginx -T 2>&1 | awk '/nginx:|^# configuration file |^[[:space:]]*(resolver|listen|location|proxy_pass|proxy_set_header)/'
cmp infra/nginx/default.conf <(docker exec ourspot-proxy cat /etc/nginx/conf.d/default.conf) && echo 'nginx repository and mounted config match'
for dst in 127.0.0.1 192.168.64.7; do
  for path in / /login.html /css/base.css /js/library.js /api/auth/health /api/places/health /api/auth/me /api/places; do
    printf '%s ' "$path"
    curl -sS --noproxy '*' --max-time 5 -o /dev/null -w '%{http_code} %{content_type}\n' "http://$dst:8080$path"
  done
done
for path in /api/auth/health /api/places/health /api/auth/me /api/places; do
  printf '%s ' "$path"; curl -sS --max-time 5 "http://127.0.0.1:8080$path"; printf '\n'
done
```

`nginx -T` 설정 테스트 성공, 설정 파일 읽기 전용 마운트 및 `cmp` 일치를 확인했다. 고정 upstream 그룹 대신 `resolver 127.0.0.11 valid=5s ipv6=off`와 서비스명 변수를 사용하는 `location` 규칙이다. 두 주소의 HTTP 상태와 Content-Type이 동일했다.

```text
/ 200 text/html
/login.html 200 text/html
/css/base.css 200 text/css
/js/library.js 200 text/javascript
/api/auth/health 200 application/json; charset=utf-8
/api/places/health 200 application/json; charset=utf-8
/api/auth/me 401 application/json; charset=utf-8
/api/places 401 application/json; charset=utf-8
/api/auth/health {"data":{"service":"user-api","status":"ok","mysql":"ok","redis":"ok"}}
/api/places/health {"data":{"service":"place-api","status":"ok","mysql":"ok","redis":"ok"}}
/api/auth/me {"error":{"code":"AUTH_REQUIRED","message":"로그인이 필요해요."}}
/api/places {"error":{"code":"AUTH_REQUIRED","message":"로그인이 필요해요."}}
```

프록시 설정의 대상, Docker의 서로 다른 API 컨테이너 ID, 직접 내부 HTTP 응답과 프록시를 통과한 각 서비스 식별자가 서로 일치했다. HTTP 확인은 Ubuntu에서 루프백과 VM 주소로 수행했다. Mac 브라우저 수동 검증과 Firefox 102건은 이전 작업의 결과다.

## 컨테이너 내부 bash

```bash
for name in ourspot-{proxy,front,user-api,place-api,db,redis}; do
  printf '%s ' "$name"
  docker exec -it "$name" bash -c '. /etc/os-release; printf "user=%s cwd=%s os=%s bash=%s\n" "$(id -un)" "$PWD" "$PRETTY_NAME" "$BASH_VERSION"'
  printf 'exit=%s\n' "$?"
done
```

| 컨테이너 | 사용자 / 경로 | OS / bash | 판정 |
| --- | --- | --- | --- |
| `ourspot-proxy` | root / `/` | Debian 12 / 5.2.15(1)-release | PASS, exit 0 |
| `ourspot-front` | root / `/usr/local/apache2` | Debian 12 / 5.2.15(1)-release | PASS, exit 0 |
| `ourspot-user-api` | node / `/app` | Debian 12 / 5.2.15(1)-release | PASS, exit 0 |
| `ourspot-place-api` | node / `/app` | Debian 12 / 5.2.15(1)-release | PASS, exit 0 |
| `ourspot-db` | root / `/` | Oracle Linux Server 9.8 / 5.1.8(1)-release | PASS, exit 0 |
| `ourspot-redis` | root / `/data` | Debian 12 / 5.2.15(1)-release | PASS, exit 0 |

bash 성공 6개, sh만 가능 0개, 접근 실패 0개다. `docker exec -it ourspot-user-api bash`로도 대화형 진입해 사용자·경로·OS를 조회했고 `exit` 후 종료 코드 0을 확인했다. 보고서의 대화형 진입 캡처에는 [체크리스트의 단일 bash 명령](evidence-checklist.md)을 사용한다.

**보고서 문장** · 운영 Docker Bridge에 서비스 6개가 연결되며, Ubuntu 8080의 단일 진입점에서 Nginx가 정적 웹과 독립된 두 Express API로 요청을 전달한다. 각 API가 내부 MySQL·Redis에 연결되고 두 백엔드의 보호 API가 인증 없는 요청을 거부함을 확인했다.
