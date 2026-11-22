# Redis 서버 간 세션 공유

**목적 및 기준** · 기획서 10.3과 구현 결정서 V10에 따라 한 번의 로그인으로 독립된 두 백엔드가 동일한 Redis 인증 세션을 사용하고 로그아웃이 이를 무효화하는지 확인한다. [기획서](../design/proposal.md) · [구현 결정서](../design/implementation-decisions.md)

**환경** · 2026-11-22 20:06:56 KST, UTM Ubuntu 24.04 ARM64 운영 Nginx `127.0.0.1:8080`, User API `0.2`(`08a681e17bb9`), Place API `0.6`(`99c047df0831`), Redis 7.4.12(`4f4fbda58d2f`). [운영 라우팅과 컨테이너 증거](infrastructure.md)

## 운영 검증 · PASS

계정 소유자가 Ubuntu 대화형 터미널의 저장소 루트에서 실행하고 아래 정제된 출력을 전달했다.

```bash
python3 scripts/verify-production-session.py
```

기대 결과는 비로그인 401, 로그인 200, 해당 Redis 키의 TTL 최대 24시간, 같은 쿠키로 두 API 200, 로그아웃 204, 키 삭제 및 기존 쿠키로 두 API 401이다.

```text
2026-11-22T20:06:56+09:00
PASS GET /api/auth/me without cookie: 401 AUTH_REQUIRED
PASS GET /api/places without cookie: 401 AUTH_REQUIRED
PASS POST /api/auth/login: 200
PASS signed session cookie received (value omitted)
PASS Redis session TTL: 86400s
PASS GET /api/auth/me with same cookie: 200, login identity matches
PASS GET /api/places with same cookie: 200, place list returned
PASS POST /api/auth/logout: 204
PASS Redis session TTL after logout: -2 (key absent)
PASS GET /api/auth/me with old cookie: 401 AUTH_REQUIRED
PASS GET /api/places with old cookie: 401 AUTH_REQUIRED
```

스크립트는 로그인 응답의 세션 쿠키를 메모리에서 두 API 요청에 재사용한다. 서명 쿠키의 ID에 해당하는 Redis 키를 표준입력으로 전달해 TTL만 읽고, 로그아웃 후에도 같은 키와 기존 쿠키를 확인한다. `/api/auth/me`가 로그인 응답과 같은 사용자임을 비교하며, `/api/places`는 인증 성공 및 목록 형식만 확인한다. Redis 키·값, 사용자 응답 원문, 비밀번호와 쿠키는 출력 자료에 포함하지 않는다. 운영 확인은 계정 한 개로 수행했다. [검증 스크립트](../../scripts/verify-production-session.py)

## 현재 이미지 격리 테스트 · PASS 113건

2026-11-22 20:05 KST, 같은 Ubuntu 호스트의 별도 Bridge, 임시 MySQL·Redis, 임의 루프백 포트에서 실행했다. 운영과 같은 Frontend `0.4`, User API `0.2`, Place API `0.6`을 사용했다.

```bash
OURSPOT_PLACE_TEST_IMAGE=ourspot-place-api:0.6 python3 -B -c 'import sys; sys.path.insert(0, "tests"); from auth import run_isolated; run_isolated(front_image="ourspot-front:0.4")'
```

종료 상태 0, `PASS` 113줄이었다. 아래는 실제 관련 출력이다.

```text
PASS two independently routed APIs
PASS A/B login via proxy (0.37s/auth HTTP mean)
PASS only one Redis SET per successful login
PASS Redis stores real user with a 24-hour TTL before first API read
PASS same cookies authenticate in both API containers
PASS real MySQL list, shared visibility, filters, ordering, independent counts and UTC milliseconds
PASS reads do not extend TTL
PASS logout removes Redis session, clears cookie, and B stays authenticated
PASS both APIs reject expired session with remaining Redis TTL
PASS passwords, session secret, cookie values and session IDs absent from service logs
```

동일 계정의 Redis 저장·만료와 두 계정의 공동 조회, 한 계정 로그아웃 시 다른 세션 유지까지 격리 환경에서 확인했다. 운영 DB에는 읽기 전용 집계 결과 사용자 2명, 커플 1개가 있었다. [기존 테스트 코드](../../tests/auth.py) · [운영 DB 증거](mysql-persistence.md)

**촬영** · Ubuntu 터미널에서 운영 검증의 시각과 PASS 줄을 캡처한다. 한 화면에 담을 줄은 로그인 200, Redis TTL, 같은 쿠키의 두 200, 로그아웃 204, TTL -2와 기존 쿠키의 두 401이다. 프록시 라우팅·두 컨테이너 ID는 인프라 캡처와 함께 첨부한다. 기존 터미널 출력으로 촬영할 수 있다.

**보고서 문장** · User API 로그인으로 Redis에 저장된 세션의 TTL은 86,400초였으며, 같은 쿠키로 Place API에서 목록 조회에 성공했다. 로그아웃 후 해당 Redis 키가 사라졌고 기존 쿠키는 두 API 모두에서 401로 거부됐다.
