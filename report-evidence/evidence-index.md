# OURSPOT 최종 보고서 증빙 인덱스

## 작업 요약

| 항목 | 결과 |
| --- | --- |
| 현행화 기준일 | 2026-11-23 KST |
| 원본 대조 기준 | `main`의 `0ac72c4aec92d2d9bd02bd3606e32a90c80de36e`. 소스코드 캡처 대조 시 조회한 GitHub `origin/main`과 일치 |
| 목표 및 현재 확보 | 웹사이트 **6/6장**, 소스코드 **10/10장**, 합계 **16/16장** |
| 현재 캡처 방식 | Mac Chrome 웹 화면 수동 캡처 6장(PNG, 2940×1912), VS Code Remote SSH 편집기 수동 캡처 10장(PNG, 크기는 이미지별로 다름) |
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

이전 인덱스의 미확보 5장과 수동 캡처 안내는 Firefox 자동화 당시 상태다. 현재 디렉터리에서 해당 5장과 수동 로그인 화면까지 모두 확인했다. 이전 `OURSPOT_report_evidence.zip`은 웹 1장과 코드 6장이 들어 있는 당시 묶음이며, 현재 16장 목록은 이 인덱스와 두 이미지 폴더를 기준으로 한다.

## 주요 소스코드 이미지

새 캡처 10장은 VS Code Remote SSH 편집기 화면이다. 아래 줄 번호는 화면 본문을 원본과 대조한 결과다. 상단에 고정된 줄과 화면 가장자리에 일부만 보이는 줄은 따로 표시했다.

| 실제 파일명과 상태 | 원본 경로와 화면에 보이는 범위 | 주요 구현과 과제 요구사항 | 보고서 위치와 설명문 |
| --- | --- | --- | --- |
| [01_dockerfile.png](source-code/01_dockerfile.png) · 확보 | [services/Dockerfile](../services/Dockerfile#L1-L17) 1–17행. 16행 `HEALTHCHECK`의 오른쪽 끝은 잘림. | Node 22 Bookworm Slim 기본 이미지, lockfile 기반 설치, 공통 모듈과 서비스별 소스 복사, 비루트 사용자 실행, 포트 3000 및 실행 명령. | **Docker 이미지 구성**. “공통 Dockerfile은 빌드 인자로 선택한 API의 소스를 이미지에 포함하고 비루트 사용자로 Node.js 서버를 실행한다.” |
| [02_nginx_routing.png](source-code/02_nginx_routing.png) · 확보 | [infra/nginx/default.conf](../infra/nginx/default.conf#L1-L23) 1–23행. API 라우팅 16–19행의 오른쪽 끝은 잘림. | Docker DNS로 내부 서비스를 찾고, 인증 경로는 User API의 3000번 포트, 장소 경로는 Place API의 3000번 포트, 일반 웹 경로는 프론트엔드의 80번 포트로 전달한다. 미정의 API 경로는 404를 반환한다. | **Nginx Reverse Proxy**. “Nginx는 요청 경로에 따라 인증 API, 장소 API, 정적 프론트엔드로 요청을 전달한다.” |
| [03(1)_user_auth.png](source-code/03%281%29_user_auth.png) · 확보 | [services/user-api/server.cjs](../services/user-api/server.cjs#L1-L35) 1–35행. 36행은 하단 일부만 보임. | `POST /api/auth/login` 등록과 입력 검증. 보안 쿠키 설정 시 HTTPS를 요구하고, 요청 본문의 사용자·커플 식별자와 잘못된 로그인 입력을 거부한다. 계정 조회와 bcrypt 비교는 원본 36–45행에서 확인할 수 있다. | **마이크로서비스 구현 / User API 로그인 입력 검증**. “User API는 로그인 요청에서 이메일과 비밀번호를 검증하고 사용자나 커플을 지정하는 필드를 거부한다.” |
| [03(2)_user_auth.png](source-code/03%282%29_user_auth.png) · 확보 | [services/user-api/server.cjs](../services/user-api/server.cjs#L48-L84) 상단 고정 15·18행, 본문 49–84행. 48·85행은 가장자리 일부만 보임. | 세션 재생성과 저장 이후 쿠키 발급, `GET /api/auth/me`의 사용자·커플 일치 확인, `POST /api/auth/logout`의 Redis 세션 삭제 및 쿠키 제거. | **마이크로서비스 구현 / User API 세션 처리**. “User API는 로그인 세션의 Redis 저장을 기다린 뒤 쿠키를 발급한다. 로그아웃에서는 세션 삭제가 성공한 뒤 쿠키를 제거한다.” |
| [04(1)_redis_session.png](source-code/04%281%29_redis_session.png) · 확보 | [services/common/infrastructure.cjs](../services/common/infrastructure.cjs#L20-L54) 20–54행. 19행은 상단 일부만 보임. | MySQL 연결 풀과 UTC 설정, Redis 연결, 공통 키 접두어와 TTL 계산을 사용하는 RedisStore, 자동 TTL 연장을 끈 Express 세션 구성. | **Redis 세션 공유 / 공통 저장소 설정**. “두 API는 공통 인프라 모듈을 사용해 같은 Redis DB와 키 접두어, 쿠키 서명 설정으로 세션을 처리한다.” |
| [04(2)_redis_session.png](source-code/04%282%29_redis_session.png) · 확보 | [services/common/infrastructure.cjs](../services/common/infrastructure.cjs#L55-L90) 상단 고정 37행, 본문 55–90행. 54·91행은 가장자리 일부만 보임. | Redis 세션 조회 장애 시 503 처리, 서명 쿠키 발급, 남은 절대 만료 시간에 따른 TTL 계산, 보호 경로의 세션 검증 시작부. | **Redis 세션 공유 / 쿠키와 만료**. “서명된 세션 ID와 만료 시각은 쿠키로 전달하고, 사용자와 커플 정보는 Redis에 저장한다.” |
| [05(1)_place_mysql.png .png](source-code/05%281%29_place_mysql.png%20.png) · 확보 | [services/place-api/server.cjs](../services/place-api/server.cjs#L19-L55) 19–55행. 56행은 하단 일부만 보임. | `GET /api/places`의 세션 확인, 방문 상태·예정일·정렬 입력 검증, 세션의 커플 ID를 사용한 MySQL 조회 조건과 바인딩 값 구성. | **마이크로서비스 구현 / Place API 목록 조회**. “Place API는 공유 세션의 커플 ID로 조회 범위를 제한하고 방문 상태와 예정일에 따른 목록 조회 조건을 구성한다.” |
| [05(2)_place_mysql.png .png](source-code/05%282%29_place_mysql.png%20.png) · 확보 | [services/place-api/server.cjs](../services/place-api/server.cjs#L83-L117) 상단 고정 29·34행, 본문 83–117행. 82·118행은 가장자리 일부만 보임. | `POST /api/places`의 매개변수 바인딩 `INSERT`와 재조회, `GET /api/places/:id`의 커플 범위 상세 조회, `PATCH /api/places/:id`의 입력·버전 비교값 형식 검증과 쓰기 트랜잭션 진입부. | **마이크로서비스 구현 / Place API 등록·상세 조회**. “Place API는 세션의 커플과 등록자 정보로 장소를 MySQL에 저장하고, 등록한 행을 다시 조회해 응답한다.” |
| [06(1)_mysql_volume.png .png](source-code/06%281%29_mysql_volume.png%20.png) · 확보 | [scripts/up.sh](../scripts/up.sh#L25-L59) 상단 고정 17·18·20행, 본문 25–59행. 60행 일부는 하단에 걸림. | 설치 모드별 앱 이미지와 플랫폼 선택, 설치 접두어로 네트워크와 MySQL 볼륨 이름 구성, 기존 컨테이너 이름 검사. | **MySQL 데이터 저장 및 영속성 / 리소스 이름**. “설치 스크립트는 설치 접두어로 네트워크와 DB 볼륨의 이름을 정한다. DB 볼륨 이름은 49행에서 확인할 수 있다.” |
| [06(2)_mysql_volume.png .png](source-code/06%282%29_mysql_volume.png%20.png) · 확보 | [scripts/up.sh](../scripts/up.sh#L78-L114) 상단 고정 72행, 본문 78–114행. 115행은 하단 일부만 보임. MySQL 헬스체크 명령의 오른쪽 끝은 잘림. | 컨테이너 헬스체크 대기, 브리지 네트워크와 Named Volume 확인·생성, MySQL의 `/var/lib/mysql` 마운트와 읽기 전용 초기화 SQL 연결, Redis의 임시 `tmpfs` 설정. | **MySQL 데이터 저장 및 영속성 / 볼륨 마운트**. “설치 스크립트는 같은 이름의 Named Volume을 재사용하고 MySQL의 데이터 디렉터리인 `/var/lib/mysql`에 연결한다.” |

### 원본과 기존 실행 증빙 참고

- Dockerfile의 헬스체크 명령은 원본 16행에 있다. 베이스 이미지 다이제스트 전달, Docker Hub 이미지 목록과 설치 결과는 기존 자료에서 확인할 수 있다. [Dockerfile](../services/Dockerfile#L16) · [빌드 스크립트](../scripts/build.sh) · [이미지 목록](../infra/images.env) · [설치 가이드](../docs/verification/installation.md)
- User API의 MySQL 계정 조회와 bcrypt 비교는 두 인증 캡처 사이의 원본 36–45행에 있다. 공통 시작 모듈은 두 API에 세션 미들웨어를 라우트 등록 전에 적용한다. 동일 세션으로 두 API에 요청한 결과는 기존 검증 기록에 있다. [User API](../services/user-api/server.cjs#L36-L45) · [공통 시작 모듈](../services/common/server.cjs#L30-L31) · [Redis 세션 공유 실행 결과](../docs/verification/session-sharing.md)
- Place API의 목록 조회·집계 SQL은 62–83행, 수정 시 행 잠금·버전 비교와 응답은 118행부터, 실제 `UPDATE` SQL은 395–397행에서 확인할 수 있다. [목록 조회](../services/place-api/server.cjs#L62-L83) · [수정 처리](../services/place-api/server.cjs#L118-L143) · [UPDATE SQL](../services/place-api/server.cjs#L395-L397)
- MySQL 볼륨 마운트는 코드 06(2)에서 확인할 수 있다. 컨테이너 재시작과 재생성 전후에 데이터가 유지된 결과는 기존 실행 기록에 있다. [MySQL 마운트 및 영속성 결과](../docs/verification/mysql-persistence.md)

## 보고서 삽입 우선순위

| 순서 | 본문 | 별첨 또는 함께 배치할 실행 증거 |
| --- | --- | --- |
| 1. 웹사이트 구현 결과 | 장소 상세(04), 데이트 계획(05), 커플 코멘트(06)로 저장된 장소·일정·공유 흐름을 설명한다. | 로그인(01), 보관함 빈 상태(02), 장소 저장 모달(03)을 배치한다. |
| 2. Nginx Reverse Proxy | 코드 02로 인증 API, 장소 API, 프론트엔드의 요청 분기를 보여준다. | 기존 컨테이너 목록과 프록시 경유 HTTP 응답을 연결한다. |
| 3. User API와 Place API 분리 | 코드 03(1)·03(2)로 로그인 입력 검증과 세션 처리를, 코드 05(1)로 Place API 목록 조회 조건을 보여준다. | 코드 05(2)로 장소 등록 `INSERT`와 상세 조회를 보여준다. |
| 4. Redis 기반 세션 공유 | 코드 04(1)·04(2)로 RedisStore 설정과 서명 쿠키·만료 처리를 보여준다. | 같은 로그인 세션으로 두 API가 인증된 기존 실행 결과를 함께 배치한다. |
| 5. MySQL 데이터 저장 및 영속성 | 코드 06(2)의 볼륨 마운트와 데이터가 유지된 기존 실행 결과를 함께 배치한다. | 코드 06(1)로 볼륨 이름 구성, 코드 05(2)로 MySQL 등록 SQL을 보여준다. |
| 6. Dockerfile 및 이미지 구성 | 코드 01로 빌드 인자에 따른 API별 이미지와 실행 설정을 설명한다. | 헬스체크 명령 전문은 원본 16행을 참조하고, Docker Hub 다이제스트와 설치 증빙을 연결한다. |
