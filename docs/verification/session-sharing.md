# Redis 서버 간 세션 공유

**목적 및 기준** · 기획서 10.3과 구현 결정서 V10에 따라 한 번의 로그인으로 독립된 두 백엔드가 동일한 Redis 인증 세션을 사용하고 로그아웃이 이를 무효화하는지 확인한다. [기획서](../design/proposal.md) · [구현 결정서](../design/implementation-decisions.md)

**환경** · 최초 공유 출력에 표시된 실행 시각은 2026-11-22 20:06:56 KST다. UTM Ubuntu 24.04 ARM64 운영 Nginx `127.0.0.1:8080`, User API `0.2`(`08a681e17bb9`), Place API `0.6`(`99c047df0831`), Redis 7.4.12(`4f4fbda58d2f`). [운영 라우팅과 컨테이너 증거](infrastructure.md)

## 운영 검증 · PASS (계정 소유자 제공 증거)

계정 소유자가 Ubuntu 대화형 터미널의 저장소 루트에서 다음 명령을 실행했다. 운영 판정은 계정 소유자가 대화에 제공한 최초 출력 발췌와 후속 답변에 근거한다.

```bash
python3 scripts/verify-production-session.py
```

기대 결과는 비로그인 401, 로그인 200, 해당 Redis 키의 TTL 최대 24시간, 같은 쿠키로 두 API 200, 로그아웃 204, 키 삭제 및 기존 쿠키로 두 API 401이다.

### 최초 공유 출력 · 2026-11-22 20:06:56 KST

최초 메시지에 붙여 넣은 출력은 로그아웃 후 User API의 401 줄까지다.

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
```

### 후속 답변 · 별도 시각 미확인

최초 공유에서 빠진 마지막 Place API 줄을 터미널의 기존 출력에서 확인해 달라고 요청했고, 계정 소유자가 다음 한 줄만 별도 답변으로 전달했다.

```text
PASS GET /api/places with old cookie: 401 AUTH_REQUIRED
```

후속 답변에는 시각과 종료 코드가 없었다. 앞선 실행의 누락 줄에 대한 답변으로 기록하며, 터미널 원본을 확보하지 못해 두 발췌가 같은 실행에서 연속해 출력됐는지는 독립 확인할 수 없다. 아래 113건은 별도 격리 실행의 결과다.

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

**촬영** · 기존 Ubuntu 터미널 원본이 남아 있으면 실행 시각과 실제로 함께 표시된 결과를 캡처한다. 마지막 Place API 401이 그 화면에서 확인되지 않으면 계정 소유자의 후속 답변에서 확인한 줄로 따로 표기한다. 프록시 라우팅과 두 컨테이너 ID는 인프라 캡처를 첨부한다.

**보고서 문장** · User API 로그인으로 Redis에 저장된 세션의 TTL은 86,400초였으며, 같은 쿠키로 Place API에서 목록 조회에 성공했다. 최초 공유 출력은 로그아웃 후 Redis 키 삭제와 기존 쿠키의 User API 401까지 보여준다. Place API의 기존 쿠키 401은 계정 소유자의 후속 답변에서 확인했다.
