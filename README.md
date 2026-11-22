# OURSPOT — 우리 여기 가자

2026-2학기 클라우드네이티브 기말고사 대체과제

## 프로젝트 개요

커플이 함께 가고 싶은 장소를 저장하고,
날짜별 데이트 계획을 만들며,
방문 전후 코멘트를 공유하는 웹 서비스.

## 기술 스택

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js Express (2개 서비스)
- Reverse Proxy: Nginx
- Database: MySQL
- Session Store: Redis
- Infrastructure: Docker

## 개발 환경

- MacBook Air M3
- UTM Ubuntu 24.04 ARM64
- VS Code Remote - SSH

## Figma

https://www.figma.com/design/RJUp9mnBERMYSg2rnpR6GO/

## 개발 진행 상태

- [x] OURSPOT 전용 Ubuntu 환경 구축
- [x] VS Code Remote - SSH 연결
- [x] 기존 Docker 실습 환경 정리
- [ ] 프로젝트 구조 및 Git 초기화
- [ ] Docker 컨테이너 6개 구성
- [ ] Redis 세션 공유 구현
- [ ] 웹 서비스 개발
- [ ] Docker Hub 배포
- [ ] 최종 검증 및 제출

## 인증 빌드와 격리 테스트

```bash
bash scripts/build.sh
source infra/images.env
docker build --build-arg "NODE_BASE=$NODE_BASE" --build-arg SERVICE=place-api \
  -f services/Dockerfile -t ourspot-place-api:stage5-test .
OURSPOT_PLACE_TEST_IMAGE=ourspot-place-api:stage5-test python3 tests/auth.py
```

`tests/auth.py`는 별도 Docker 네트워크, 임시 MySQL·Redis, 임의 루프백 포트에
테스트 환경을 띄우고 테스트 리소스만 정리한다. 운영 계정과 운영 설정은 사용하지 않는다.
코멘트 검증은 격리 MySQL의 임시 파일시스템에서 A/B 권한, 방문 상태 경합,
DB 오류 직후의 롤백을 검사하며 기존 인증·장소·일정·방문 상태 검증도 함께 실행한다.

## 새 설치의 초기 계정

이미지를 빌드한 뒤 `bash scripts/up.sh`를 실행하면 MySQL·Redis가 준비된 후
사용자 A/B의 서로 다른 비밀번호를 터미널에서 비공개 입력으로 받는다.
이미 초기 계정 두 명이 있으면 기존 행과 암호를 그대로 사용한다.
터미널 입력이 중단되어 DB와 Redis만 준비된 상태라면
`bash scripts/up.sh --reuse-dependencies`로 이어서 실행한다.

## 실행 중인 0.1 환경에 인증 적용

다음 명령은 운영 적용 승인을 받은 뒤 Ubuntu 프로젝트 루트에서 실행한다.
먼저 계정만 설치한다. 기존 MySQL 볼륨에서 `users`가 비어 있을 때 두 행이 생성된다.

```bash
bash scripts/seed-users.sh
```

두 API만 순서대로 교체한다. `.runtime/api.env`를 계속 사용하며, 0.1 컨테이너는 복구를 위해
중지 상태로 보관한다. DB·Redis·웹 서버는 계속 실행된다.

```bash
(
  set -e
  for service in user-api place-api; do
    name="ourspot-$service"
    if docker container inspect "$name-before-auth" >/dev/null 2>&1; then
      echo "Backup name already exists: $name-before-auth" >&2
      exit 1
    fi
  done
  for service in user-api place-api; do
    name="ourspot-$service"
    docker stop "$name"
    docker rename "$name" "$name-before-auth"
    docker run -d --name "$name" --network ourspot-net --restart unless-stopped \
      --env-file .runtime/api.env "$name:0.2"
    for attempt in {1..30}; do
      if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" == healthy ]]; then
        break
      fi
      sleep 2
    done
    if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" != healthy ]]; then
      echo "API health check failed: $name" >&2
      exit 1
    fi
  done
)
```

`docker ps`에서 두 API가 healthy임을 확인한 후 두 계정의 로그인, `GET /api/auth/me`,
`GET /api/places`, `POST /api/auth/logout`을 한 세션으로 차례로 확인한다. 로컬 HTTP
검증은 Ubuntu의 루프백 주소나 SSH 터널을 사용하며 비밀번호·쿠키를 화면과 로그에 남기지 않는다.
적용 중 오류가 발생하면 해당 0.2 API 컨테이너만 정리하고 보관한 0.1 컨테이너를
원래 이름으로 돌린 뒤 시작한다. 설치한 계정과 MySQL 볼륨은 그대로 유지된다.
