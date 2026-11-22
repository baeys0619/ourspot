# OURSPOT 최종 보고서 증빙 인덱스

## 작업 요약

| 항목 | 결과 |
| --- | --- |
| 현행화 기준일 | 2026-11-23 KST |
| 원본 대조 기준 | `main`의 `3993616d2096d48dfea7666e214f0e9e6eac5934`. 현행화 시 조회한 GitHub `origin/main`과 일치 |
| 목표 및 현재 확보 | 웹사이트 **6/6장**, 소스코드 **7/7장**, 합계 **13/13장** |
| 현재 캡처 방식 | Mac Chrome 웹 화면 수동 캡처 6장, VS Code Remote SSH 편집기 화면 수동 캡처 7장. 모두 PNG, 2940×1912 |
| 현재 미확보 / 추가 수동 캡처 필요 | 0장 / 0장 |
| 이전 자동 캡처 이력 | Firefox 자동 캡처 당시 로그인 1장을 확보했다. 인증 세션이 없어 보호 화면 5장은 자동 확보하지 못했다. 현재 웹 화면 6장은 수동 캡처분이다. |
| 현재 웹 캡처의 주소 | 6장 모두 주소창에 표시된 `http://192.168.64.7:8080`. 개별 경로는 아래 표 참조 |
| 개별 촬영 시각 | 현재 PNG에서 확인되지 않음. 화면에 표시된 저장일과 예정일은 애플리케이션 데이터다. |

과제의 기술 증빙은 Nginx, 독립 백엔드, Redis 세션 공유, MySQL, 볼륨 및 이미지 구성을 중심으로 정리했다. 웹 화면에는 OURSPOT 프로젝트 기능 ID를 함께 표기했다. [과제 기준](../docs/design/proposal.md) · [구현 결정서](../docs/design/implementation-decisions.md) · [운영 인프라 검증](../docs/verification/infrastructure.md) · [설치 가이드](../docs/verification/installation.md) · [제출 증빙 목록](../docs/verification/evidence-checklist.md) · [시연 순서](../docs/verification/demo-command-sequence.md)

## 웹사이트 구현 화면

각 행의 페이지 경로는 이미지 주소창에 표시된 값이다. 캡처 방식은 6장 모두 Mac의 Chrome 화면 수동 촬영이며 주소창이 포함되어 있다.

| 실제 파일명과 상태 | 페이지 경로 | 화면에서 확인한 내용과 기능 | 보고서 위치와 설명문 | 한계와 주의사항 |
| --- | --- | --- | --- | --- |
| [01_login.png .png](website/01_login.png%20.png) · 확보 | `/login.html` | OURSPOT 로그인 진입 화면. 빈 이메일·비밀번호 입력란과 로그인 버튼이 보인다. F-01 | **웹사이트 실행 결과 / 로그인**. “사전 등록된 사용자가 이메일과 비밀번호를 입력하는 OURSPOT 로그인 화면이다.” | 초기 폼을 보여준다. 인증 성공 과정은 User API 구현이나 기존 실행 기록과 함께 설명한다. |
| [02_main_places.png](website/02_main_places.png) · 확보 | `/index.html` | 사용자 A로 표시된 장소 보관함. ‘가볼 곳’과 ‘다녀온 곳’이 각각 0건이며 ‘장소 없음’과 ‘장소를 삭제했어요.’가 표시된다. F-05·F-06 관련 UI | **웹사이트 실행 결과 / 장소 보관함**. “장소 보관함에서 미방문·방문 장소가 모두 0건으로 표시되고, 삭제 완료 안내가 표시된 상태다.” | 삭제를 수행한 사람과 시각은 화면만으로 확인할 수 없다. 이 이미지의 목록은 빈 상태다. |
| [03_add_place.png](website/03_add_place.png) · 확보 | `/index.html` | ‘장소 저장’ 모달. 장소명·카테고리는 필수이며 URL·메모는 선택이다. 카테고리는 ‘카페’로 표시된다. F-04 | **웹사이트 실행 결과 / 장소 등록**. “장소 보관함에서 장소명과 카테고리를 선택하고 URL과 메모를 추가할 수 있는 장소 저장 양식이다.” | 양식을 연 상태다. URL 예시는 플레이스홀더이며 배경의 삭제 안내는 보관함 상태다. 저장 결과는 이 화면에서 확인할 수 없다. |
| [04_place_detail.png](website/04_place_detail.png) · 확보 | `/place.html?id=3` | 사용자 A 화면의 ‘메가커피’ 상세. ‘카페’, ‘미방문’, 저장일 2026-11-23, 데이트 ‘예정 없음’, 메모, 수정·삭제·방문 상태 변경 버튼이 보인다. ‘둘의 기록’은 방문 전 빈 상태이며 방문 후 작성 제한이 표시된다. F-05~F-07·F-10·F-11 관련 UI | **웹사이트 실행 결과 / 장소 상세**. “저장된 장소의 카테고리, 방문 상태, 저장일, 예정일 및 메모를 상세 화면에서 조회한다.” | 버튼이 표시된 상태다. 정보 수정, 삭제 또는 방문 상태 변경의 결과는 화면에서 확인할 수 없다. |
| [05_date_plan.png](website/05_date_plan.png) · 확보 | `/plans.html?date=2026-12-02` | 사용자 A 화면의 2026-12-02 일정. ‘방문할 곳’ 1곳과 ‘01 메가커피’가 표시된다. ‘보관함에서 추가’에는 후보가 없다고 표시된다. F-08·F-09 | **웹사이트 실행 결과 / 데이트 계획**. “선택한 날짜에 배정된 장소를 방문 순서와 함께 확인하는 화면이다. 12월 2일 일정에는 메가커피가 첫 번째 장소로 표시된다.” | 한 장소의 순번을 보여준다. 순서 변경과 일정 제외를 실행한 결과는 표시되지 않는다. |
| [06_comments.png](website/06_comments.png) · 확보 | `/place.html?id=3` | 사용자 B 화면에서 사용자 A가 저장한 장소와 두 사람의 방문 전 코멘트가 함께 표시된다. B의 카드에 수정·삭제 버튼, A의 카드에 ‘읽기 전용’ 표시가 있다. 방문 전 저장 안내, 2026-12-02 예정일, 방문 후 작성 제한도 보인다. F-10·F-11·F-13 관련 UI | **웹사이트 실행 결과 / 커플 코멘트**. “사용자 B의 장소 상세에서 두 사람의 방문 전 코멘트를 함께 조회한다. 자신의 기록에는 수정·삭제 버튼이 표시되며 상대방 기록은 읽기 전용으로 표시된다.” | 화면은 권한 UI와 저장 안내를 보여준다. 개별 작업 시각, 서버의 수정 거부 응답, 방문 후 코멘트 저장 결과는 확인할 수 없다. |

### 자동 캡처 이력 및 현재 확보 상태

이전 인덱스의 미확보 5장과 수동 캡처 안내는 Firefox 자동화 당시 상태다. 현재 디렉터리에서 해당 5장과 수동 로그인 화면까지 모두 확인했다. 이전 `OURSPOT_report_evidence.zip`은 웹 1장과 코드 6장이 들어 있는 당시 묶음이며, 현재 13장 목록은 이 인덱스와 두 이미지 폴더를 기준으로 한다.

## 주요 소스코드 이미지

현재 7장은 파일 경로, 코드, 줄 번호가 보이는 **VS Code Remote SSH 편집기 화면 캡처**다. 이전 인덱스에서 설명한 Pillow·Pygments 발췌 이미지는 이전 ZIP에 해당한다. 아래 표의 줄 번호는 편집기 본문에서 읽을 수 있는 범위를 현재 원본과 대조한 결과다. 위아래 가장자리에 일부만 걸린 줄과 상단에 고정된 줄은 따로 명시했다.

| 실제 파일명과 상태 | 원본 경로와 화면에 보이는 범위 | 주요 구현과 과제 요구사항 | 보고서 위치와 설명문 |
| --- | --- | --- | --- |
| [01_dockerfile.png](source-code/01_dockerfile.png) · 확보 | [services/Dockerfile](../services/Dockerfile) 1–14행. 13행 `HEALTHCHECK`의 오른쪽 끝은 잘림. | Node 22 Bookworm Slim 기본 이미지, lockfile 기반 설치, 공통·서비스별 소스 복사, `USER node`, 포트 3000, `CMD ["node", "server.cjs"]`. 독립 백엔드 이미지 구성 및 재현 절차 | **Docker 이미지 구성**. “백엔드 Dockerfile은 빌드 인자로 선택한 서비스 소스를 포함하고 비루트 사용자로 Node.js 서버를 실행한다.” |
| [02_nginx_routing.png](source-code/02_nginx_routing.png) · 확보 | [infra/nginx/default.conf](../infra/nginx/default.conf) 1–20행. 핵심 라우팅 14–19행. | Docker DNS를 사용하며 `/api/auth`는 `ourspot-user-api:3000`, `/api/places`는 `ourspot-place-api:3000`, `/`는 `ourspot-front:80`으로 전달한다. Nginx Reverse Proxy 및 역할 분리 | **Nginx Reverse Proxy**. “Nginx는 요청 경로에 따라 인증 API, 장소 API, 정적 프론트엔드로 요청을 전달한다.” |
| [03_user_auth.png](source-code/03_user_auth.png) · 확보 | [services/user-api/server.cjs](../services/user-api/server.cjs) 14–66행. 로그인 처리 14–54행, 사용자 조회 56–61행, 로그아웃 시작부 63–66행. | `POST /api/auth/login`의 입력 검증, MySQL 계정 조회와 bcrypt 확인, 세션 재생성·저장 및 쿠키 발급 호출. `GET /api/auth/me`는 세션의 사용자·커플 식별자를 사용한다. 독립 User API와 MySQL·Redis 연동 | **마이크로서비스 구현 / User API**. “User API는 등록된 계정을 검증하고 로그인 세션을 저장한다. 이후 인증 상태 조회 요청에서 세션을 기준으로 사용자 정보를 조회한다.” |
| [04_redis_session.png](source-code/04_redis_session.png) · 확보 | [services/common/infrastructure.cjs](../services/common/infrastructure.cjs) 상단 고정 13행, 편집기 본문 14–65행. MySQL 풀 19–29행, Redis·세션 31–54행, 서명 쿠키 56–62행. | MySQL 연결 풀과 UTC 설정, Redis 연결, 공통 접두어와 TTL 계산 콜백을 둔 RedisStore, Express 세션 미들웨어, 서명 쿠키 발급. 두 독립 백엔드의 공통 연결 및 Redis 세션 구성 | **Redis 세션 공유**. “공통 인프라 모듈은 MySQL 연결 풀을 구성하고, 두 API가 공유하는 RedisStore와 세션 미들웨어를 초기화한다.” |
| [05(1)_place_mysql.png .png](source-code/05%281%29_place_mysql.png%20.png) · 확보 | [services/place-api/server.cjs](../services/place-api/server.cjs) 10–63행. `GET` 32행, 세션·필터·정렬 41–54행, 읽기 트랜잭션과 SELECT 시작부 56–63행. 63행은 하단 경계에 걸리며 쿼리의 나머지는 화면 밖이다. | `GET /api/places`는 Redis 세션의 커플 식별자로 조회 범위를 정한다. 방문 상태·예정일 필터와 순서를 구성한 뒤 MySQL에서 읽기 전용 일관 스냅샷을 시작한다. 독립 Place API와 MySQL 조회 | **마이크로서비스 구현 / Place API 조회**. “Place API는 인증된 커플에 한해 방문 상태와 일정 날짜로 장소를 필터링하고 MySQL에서 목록을 조회한다.” |
| [05(2)_place_mysql.png .png](source-code/05%282%29_place_mysql.png%20.png) · 확보 | [services/place-api/server.cjs](../services/place-api/server.cjs) 상단 고정 27행과 32행, 본문 76–126행. 75행과 127행은 가장자리 일부만 보임. 등록 82–94행, 상세 조회 96–101행, 수정 핵심 103–126행. | `POST /api/places`의 매개변수 바인딩 `INSERT`, `GET /api/places/:id`의 커플 범위 조회, `PATCH /api/places/:id`의 버전 확인·행 잠금·수정 호출 및 일정 순서 재조정. 독립 Place API와 MySQL 쓰기 | **마이크로서비스 구현 / Place API 등록·수정**. “Place API는 검증된 입력을 MySQL에 등록하며, 수정 요청에서는 세션의 커플 범위 내에서 대상 행을 잠그고 버전을 확인한 뒤 변경사항을 반영한다.” |
| [06_mysql_volume.png .png](source-code/06_mysql_volume.png%20.png) · 확보 | [scripts/up.sh](../scripts/up.sh) 48–101행. `docker run`과 재시작 정책 69–75행, 볼륨과 MySQL 실행 93–101행. | Named Volume 확인·생성, MySQL 데이터 경로 `/var/lib/mysql`에 마운트, 초기화 SQL의 읽기 전용 bind mount와 MySQL 헬스체크. 과제의 볼륨 마운트 및 재현 가능한 실행 절차 | **MySQL 데이터 저장 및 영속성**. “설치 스크립트는 MySQL 데이터 디렉터리를 Named Volume에 연결하고 초기화 SQL을 읽기 전용으로 제공한다.” |

### 원본과 기존 실행 증빙 참고

- Dockerfile의 13행 전문과 베이스 다이제스트 전달은 원본과 빌드 스크립트에서 확인할 수 있다. Docker Hub 게시 및 설치는 별도의 기존 실행 기록을 사용한다. [Dockerfile](../services/Dockerfile) · [빌드 스크립트](../scripts/build.sh) · [이미지 목록](../infra/images.env) · [설치 가이드](../docs/verification/installation.md)
- 두 API는 공통 시작 모듈에서 라우트 등록 전에 세션 미들웨어를 적용한다. 이 연결부는 편집기 캡처 바깥의 보충 근거다. 같은 세션으로 양 API가 인증된 결과는 기존 검증 기록을 사용한다. [공통 시작 모듈](../services/common/server.cjs) · [Redis 세션 공유 실행 결과](../docs/verification/session-sharing.md)
- Place API 목록 조회의 나머지 SQL·집계는 64–80행, 수정 후 재조회와 응답은 128–131행, 실제 `UPDATE`는 354–366행에서 확인할 수 있다. 보고서에서 이 부분을 설명할 때에는 원본을 함께 인용한다. [Place API 원본](../services/place-api/server.cjs)
- 볼륨 이름을 구성하는 47행은 현재 캡처 바로 위에 있다. 코드 이미지는 마운트 구성을 보여주며, 재시작·재생성 전후의 데이터 일치는 기존 실행 증빙이 뒷받침한다. [설치 스크립트](../scripts/up.sh) · [MySQL 마운트 및 영속성 결과](../docs/verification/mysql-persistence.md)

## 보고서 삽입 우선순위

| 순서 | 본문 | 별첨 또는 함께 배치할 실행 증거 |
| --- | --- | --- |
| 1. 웹사이트 구현 결과 | 장소 상세(04), 데이트 계획(05), 커플 코멘트(06)로 저장된 장소·일정·공유 흐름을 설명한다. | 로그인(01), 보관함 빈 상태(02), 장소 저장 모달(03)을 배치한다. |
| 2. Nginx Reverse Proxy | Nginx 설정(코드 02)으로 세 요청 경로와 서비스 내부 포트를 보여준다. | 기존 컨테이너 목록과 프록시 경유 HTTP 응답을 연결한다. |
| 3. User API와 Place API 분리 | User API 인증(코드 03)과 Place API 장소 조회(코드 05(1))를 각 서비스 설명 옆에 배치한다. | Place API 등록·수정(코드 05(2))은 별첨에서 쓰기 처리의 세부 근거로 사용한다. |
| 4. Redis 기반 세션 공유 | RedisStore 구성(코드 04)과 같은 로그인 세션으로 두 API가 인증된 기존 실행 결과를 함께 배치한다. | 검증 절차와 상세 응답 기록을 연결한다. |
| 5. MySQL 데이터 저장 및 영속성 | MySQL Volume(코드 06)과 마운트 및 재시작 전후 데이터 일치 화면을 함께 배치한다. | 쓰기 SQL은 코드 05(2)를 참조하고 재생성 검증은 별첨에 배치한다. |
| 6. Dockerfile 및 이미지 구성 | 백엔드 Dockerfile(코드 01)로 빌드와 실행을 설명한다. | 잘린 헬스체크는 원본 13행을 인용하고 Docker Hub 다이제스트와 설치 증빙을 연결한다. |
