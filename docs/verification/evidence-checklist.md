# 제출 증빙 체크리스트

**기준일** · 2026-11-22 KST. 기획서 11~12장과 구현 결정서 V15~V16의 증빙을 준비한다. 실제 Ubuntu ARM64 실행 결과는 아래 문서에 기록했다. 캡처 파일, 최종 보고서, 전체 환경 재설치, 이미지 게시와 시연 녹화는 아직 미완료다. [기획서](../design/proposal.md) · [구현 결정서](../design/implementation-decisions.md)

## 캡처 순서

| 증거 | 상태 | 촬영 위치와 화면에 담을 부분 |
| --- | --- | --- |
| 운영 6개 실행·포트 | 실행 PASS · 캡처 미확보 | Ubuntu 저장소 루트의 Bash에서 [운영 인프라](infrastructure.md)의 `docker ps --filter network=ourspot-net ...` 실행. 명령, 6개 이름과 healthy, 프록시의 8080 매핑까지 촬영 |
| 이미지·네트워크·내부 통신 | 실행 PASS · 캡처 미확보 | 같은 터미널에서 인프라 문서의 선택 `docker inspect`, `docker image inspect`, `docker network inspect` 실행. `linux/arm64`, Bridge와 멤버 6개, DNS 및 양 API의 TCP OK가 보이게 촬영 |
| Nginx 라우팅·정적 응답 | 실행 PASS · 캡처 미확보 | Ubuntu에서 인프라 문서의 `nginx -T` 필터와 HTTP 루프 실행. `location`의 3개 대상과 각 HTTP 상태를 촬영. 브라우저 화면은 Mac에서 운영 주소 `http://192.168.64.7:8080/`로 접속해 주소 표시줄과 서비스 화면을 촬영 |
| 대화형 bash | 6개 bash 실행·User API 대화형 진입 PASS · 캡처 미확보 | Ubuntu 터미널에서 아래 예시의 `docker exec -it`부터 종료 상태까지 한 화면에 촬영. API별 증거가 필요하면 `ourspot-place-api`에서도 반복 |
| Redis 공유·로그아웃 | 운영 PASS · 캡처 미확보 | 계정 소유자의 Ubuntu 터미널에서 [세션 증빙](session-sharing.md)의 기존 정제 출력 사용. 시각·키 TTL·두 API 응답·로그아웃 전후 확인 줄을 촬영 |
| 운영 MySQL Volume | 조회 PASS · 캡처 미확보 | Ubuntu에서 [MySQL 증빙](mysql-persistence.md) 운영 명령 실행. Named Volume, 대상 경로, 건수 집계까지 촬영 |
| 격리 MySQL 재시작·재생성 | 두 실험 PASS · 캡처 미확보 | Ubuntu에서 MySQL 증빙의 재현 스크립트 실행 또는 이전 실행 화면 사용. 격리 자원명, 재시작 전후 같은 레코드와 PASS 확인. 추가 재생성 증빙은 기존 결과의 두 컨테이너 ID, 볼륨과 PASS를 사용 |
| 설치·이미지·시연 | 미검증 | 최종 태그를 게시한 뒤 깨끗한 ARM64 환경에서 설치 화면 확보. 학생이 작성한 구성도, 편집 가능한 보고서, 3분 이내 무편집 시연을 제출용으로 정리 |

대화형 진입 촬영용 명령이다. 대화형 진입에서 확인한 실제 관찰값은 `node`, `/app`, `Debian GNU/Linux 12 (bookworm)`, 종료 코드 `0`이다.

```bash
docker exec -it ourspot-user-api bash
id -un
pwd
. /etc/os-release
printf '%s\n' "$PRETTY_NAME"
exit
echo "$?"
```

캡처 전 터미널에 환경 파일·쉘 이력·서비스 원본 로그가 표시되지 않는지 확인한다. 브라우저는 개발자 도구의 Cookie·Network 헤더와 계정 이메일이 표시된 화면을 피한다. 운영 주소, 스크린샷 및 시연에는 캡처 시점의 컨테이너 이름과 태그를 표와 일치시킨다.

## Docker Hub 및 독립 설치 준비

2026-11-22 운영에서 확인한 로컬 이미지와 기획서의 제출 태그 후보는 다음과 같다. 실제 Docker Hub 계정명과 태그는 게시 전에 확정한다. Frontend 및 API Dockerfile은 소스를 이미지로 복사하며 운영 세 컨테이너에 소스 바인드 마운트가 없었다.

| 직접 빌드 이미지 | 검증한 로컬 태그 | 제출 태그 후보 |
| --- | --- | --- |
| Frontend | `ourspot-front:0.4` | `<DockerHubID>/ourspot-front:1.0` |
| User API | `ourspot-user-api:0.2` | `<DockerHubID>/ourspot-user-api:1.0` |
| Place API | `ourspot-place-api:0.6` | `<DockerHubID>/ourspot-place-api:1.0` |

운영에는 영향이 없으나, 현재 기본 빌드·설치 스크립트를 그대로 이용하면 Frontend `0.1`, Place API `0.2`를 사용한다. 제출용 설치 전에 스크립트와 가이드가 검증한 최종 버전 또는 게시 태그를 참조하도록 맞출 작업이 남아 있다. 현재 로컬 태그의 빌드 예시는 README에 있다. [빌드 스크립트](../../scripts/build.sh) · [실행 스크립트](../../scripts/up.sh) · [README](../../README.md)

깨끗한 ARM64 환경에서 최종 태그의 pull·실행, 초기 사용자 2명과 빈 장소·코멘트, 초기화 SQL, 네트워크·볼륨·8080, Nginx 설정 마운트, 로그인 및 Redis 공유를 검증한다. 기존 볼륨 재사용과 합성 데이터의 백업·복원 결과도 설치 가이드에 기록한다. 실제 운영 환경 파일과 운영 DB 덤프는 제출 자료에서 제외한다.

**보고서 문장** · 컨테이너 실행 상태, 브리지 연결, 프록시 라우팅, 공유 세션 및 MySQL 영속성은 각각 실제 Docker·HTTP·SQL 결과로 확인했다. 학생은 [컨테이너와 연결 표](infrastructure.md)를 참고해 구성도를 직접 작성하고, 터미널 캡처·설치 가이드·게시된 태그·시연 영상 주소를 최종 보고서에 첨부한다.
