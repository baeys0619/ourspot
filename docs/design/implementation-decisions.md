# OURSPOT Implementation Decision Record

- 상태: 구현 기준 확정, 실제 실행 검증 전
- 결정일: 2026-11-01
- 범위: 기획서 v2.0과 Figma 인계 계약의 모호성 해소. 코드·Docker·실제 DB 변경은 이 문서 작성 범위 밖이다.
- 승인 근거: 사용자가 요청한 10개 구현 규칙과 최소 구현 원칙.

## 1. 근거와 적용 우선순위

실제로 다시 읽은 자료:

- [프로젝트 지침](../../AGENTS.md)
- [기획서 v2.0](proposal.md): 특히 2~3장, 5~10장, 12장
- [Figma 개발 인계 및 QA 페이지 35:35](https://www.figma.com/design/RJUp9mnBERMYSg2rnpR6GO/?node-id=35-35): MCP로 다음 프레임의 실제 TEXT 본문을 재조회했다.
  - [74:120 구현 계약](https://www.figma.com/design/RJUp9mnBERMYSg2rnpR6GO/?node-id=74-120)
  - [75:120 화면 상태·이벤트 계약](https://www.figma.com/design/RJUp9mnBERMYSg2rnpR6GO/?node-id=75-120)
  - [76:120 DB·Docker·과제 QA](https://www.figma.com/design/RJUp9mnBERMYSg2rnpR6GO/?node-id=76-120)

개발 시 교수님의 필수 요구사항을 최우선으로 한다. 본 문서가 명시적으로 조정한 사항은 본 문서를 따르고, 나머지 기능·DB·API 범위는 기획서를 따른다. Figma는 나머지 상세 구현 계약과 시각 디자인의 기준이다. 58:19는 이전 참고 메모로 우선 계약이 아니다. 새로운 충돌은 보고하고 기록을 갱신한다. 원본 기획서와 Figma는 이번 결정으로 수정하지 않았다.

### 요구사항의 출처 구분

| 구분 | 유지할 내용 |
| --- | --- |
| 기획서에 기록된 교수 필수 평가요건 | 최소 6개 컨테이너, 역방향 프록시, 정적 프론트, 독립 백엔드 2개 이상, Redis 서버 간 세션 공유, DB 및 Volume 영속성, React/Vue 금지, 실행 명령·네트워크·내부 bash 접근 증거, 이미지 배포·설치 가이드, 3분 이내 무편집 시연, 학생 직접 작성 구성도 |
| 프로젝트 선택 및 AGENTS.md 제약 | Ubuntu 24.04 ARM64, Nginx/Apache/Express User API/Express Place API/MySQL/Redis, 2계정·1커플, 기존 3테이블과 API, 장소·일정·코멘트 기능 |
| Figma의 추가 설계 | 파일 구성, dialog, 응답 envelope, 세부 오류코드, 입력 길이, 인덱스, bcrypt, 쿠키명, 화면별 이벤트·반응형 QA |
| 이번 확정 결정 | 아래 날짜 충돌 범위, 필수 낙관적 잠금, 트랜잭션 잠금 범위, 기록 상태별 권한, 빈 seed, 24시간 세션, 시간대·집계 규칙 |

교수 공지 원문은 이번 작업에서 별도로 재검증하지 않았다. 위 교수 요건은 기획서 기록에 근거하며, 기능 F-01~F-13 모두가 교수의 개별 요구라는 뜻은 아니다. 이기종 백엔드 가점은 현 Express 두 서비스로 확보하지 않는다.

## 2. 공통 불변 조건과 최소 범위

- `users`, `places`, `place_comments` 3개 테이블을 유지한다. 일정·버전·잠금 테이블을 추가하지 않는다.
- 계정 두 개가 `couple_001`을 공유한다. 가입·초대·다중 커플 관리 기능은 없다.
- 장소와 일정은 A/B 모두 수정·삭제 가능하다. 개별 코멘트 수정·삭제는 본인에게만 허용한다. 장소 전체 삭제는 확인 후 관련 코멘트까지 CASCADE 삭제하는 별도 동작이다.
- 모든 장소 접근·변경은 세션의 coupleId로 제한하고 코멘트도 부모 장소의 접근권한을 확인한다. 다른 커플/없는 장소는 404로 처리한다.
- 요청의 사용자·커플·등록자 값을 권한 근거로 사용하지 않는다. SQL은 파라미터 바인딩한다.
- 기존 필드·FK·코멘트 UNIQUE(place_id,user_id,phase)를 유지한다. Figma 76:126~130의 길이·인덱스를 기본으로 하되 시각 정밀도는 4절로 조정한다.
- 카테고리는 카페/맛집/놀거리/기타. title trim 후 1~120자, memo 최대 1000자, comment trim 후 1~1000자, URL은 비어 있거나 http(s) 2048자 이하다. 선택 입력의 빈 문자열은 null로 정규화한다.
- HTML/CSS/Vanilla JS/Fetch를 사용한다. 외부 서비스 연동이나 새 제품 기능은 추가하지 않는다.

## 3. IDR-01 날짜 배정·이동·제외

근거: 기획서 3.4·8.2, Figma 74:161, 75:145~149. 기존 `PATCH /api/places/:id`로 처리한다. 아래 모든 PATCH에는 4절의 expected_updated_at이 필수다.

| 현재 → 요청 날짜 | 동작 |
| --- | --- |
| null → 날짜 | 미방문이면 허용, 대상 날짜 끝에 추가 |
| 날짜 A → 다른 날짜 B | confirm_move가 true가 아니면 409 DATE_CONFLICT. 확인 후 최신 비교값과 confirm_move:true로 재요청 |
| 날짜 A → null | 일정 제외 허용, visit_order도 null. DATE_CONFLICT 아님 |
| 날짜 A → 날짜 A | 날짜 이동 아님. 순서 변경 또는 변경 없음으로 처리 |
| 날짜 필드 생략 | 날짜 유지. 일반 수정·순서 변경에 DATE_CONFLICT를 적용하지 않음 |

confirm_move는 날짜 이동 확인만 의미한다. 낙관적 잠금·권한·방문 상태 검증을 우회하지 않는다. 확인창을 띄운 뒤 데이터가 바뀌면 수정 충돌부터 반환하고 재조회 후 다시 확인한다.

날짜 변경과 방문 순서 지정은 한 요청에 결합하지 않는다. 신규 배정·이동은 끝에 추가한 뒤 별도 PATCH로 순서를 바꾼다. 날짜 변경과 visit_order의 숫자 값을 함께 보내면 422. 제외의 `{planned_date:null,visit_order:null}`은 허용한다. 상태 전환과 일정 변경의 결합도 422로 제한한다. 일반 장소 필드와 상태 또는 일정 중 한 종류는 함께 수정 가능하며 전체가 원자적으로 성공/실패한다.

**기존 계약 차이:** 74:161의 ‘기존 예정일이 있으면 PATCH 충돌’을 서로 다른 실제 날짜 간 이동으로 한정한다. 75:149의 일정 제외와 모순되지 않게 한다.

## 4. IDR-02 동시 수정과 MySQL 잠금

### 장소 단위 낙관적 잠금

- 모든 장소 PATCH는 본문에 `expected_updated_at`을 필수로 받는다. 장소 DELETE는 본문 대신 `X-Expected-Updated-At` 헤더를 필수로 받는다. 누락·잘못된 형식은 422다. 새 엔드포인트는 만들지 않는다.
- 값은 마지막 GET/변경 응답에서 받은 updated_at 문자열을 그대로 사용한다. 비교는 JS Date의 반올림이나 문자열 임의 변환 없이 동일 정밀도로 수행한다.
- places.updated_at은 UTC `DATETIME(3)`로 저장하고 API는 밀리초 3자리 ISO8601 Z로 반환한다. 예: `2026-11-01T08:00:00.123Z`.
- 잠금 안에서 비교하고, 다르면 409 UPDATE_CONFLICT와 현재 updated_at을 반환한다. 기존 ORDER_CONFLICT 명칭은 사용하지 않고 수정 충돌을 UPDATE_CONFLICT로 통일한다.
- 성공한 실제 변경의 새 updated_at은 DB UTC 현재 시각과 이전 값+1밀리초 중 큰 값으로 명시적으로 설정한다. 초 단위 자동 갱신만으로는 같은 초 수정 충돌을 막지 못하므로 사용하지 않는다. 변경 없는 PATCH도 비교값은 검증하되 시각을 증가시키지 않는다.
- 새 응답에 변경된 updated_at을 포함한다. 409 시 입력은 보존하고 최신 목록/상세를 다시 조회한다. 변경 요청을 자동 재전송하거나 무조건 덮어쓰지 않는다.

### 쓰기 직렬화와 잠금 범위

단일 커플·두 사용자라는 범위에서 잠금 테이블 없이 정확성을 확보하기 위해 **커플 전체 쓰기를 직렬화**한다. 날짜별 최대 병렬성보다 구현 단순성을 우선한다.

1. MySQL InnoDB 트랜잭션을 시작한다.
2. 해당 couple_id의 사용자 중 최소 id인 기존 users 행을 `SELECT ... FOR UPDATE`로 잠근다. 설치 후 고정된 이 행을 커플 쓰기의 공통 잠금으로 사용한다. 정상 초기 계정 두 개가 없으면 서비스 준비 실패로 처리한다.
3. 대상 장소를 couple_id와 id로 조회·잠그고 비교값 및 비즈니스 규칙을 검사한다. 잠금 획득 이전에 읽은 값으로 처리하지 않는다. 잠금 후 current read를 사용한다.
4. 일정 작업은 원래 날짜와 목적 날짜의 모든 장소 행을 id 오름차순으로 잠근다. 방문 완료 행도 기존 일정의 구성원이므로 포함한다. 삭제도 원래 날짜의 재정렬을 포함한다.
5. 변경·재정렬·시각 갱신을 수행하고 커밋한다. 실패하면 전체 롤백한다.

장소 생성·일반 수정·삭제·상태 전환·코멘트 쓰기 모두 같은 users 잠금을 먼저 얻는다. 서로 다른 코드 경로가 이 규약을 우회하면 보장은 성립하지 않는다. 코멘트 쓰기는 이어서 부모 places 행을 잠가 상태 확인과 쓰기를 원자적으로 한다. 이렇게 방문 후 코멘트 생성과 미방문 복귀의 경합도 직렬화한다. 요청마다 별도 DB 연결의 동일 트랜잭션을 끝까지 사용한다.

빈 날짜에는 잠글 places 행이 없어도 공통 users 행 잠금으로 동시 추가를 직렬화한다. 원본·목적 날짜는 논리적 영향 범위이고, 실제 상호배제 범위는 커플 전체다. 프로세스 메모리 잠금이나 Redis 세션 잠금을 DB 정렬 잠금으로 대체하지 않는다. 교착·잠금 시간 초과는 롤백 후 503 WRITE_BUSY로 안내하며 클라이언트 변경을 자동 재전송하지 않는다.

### 날짜 전체 충돌 감지의 정확한 보장 범위

- 배정·이동·제외·순서 변경·예정일 있는 장소 삭제가 실제 일정 구성을 바꾸면 영향받은 날짜의 **모든 남은 장소**와 이동한 대상의 updated_at을 증가시킨다. 순서 숫자가 그대로인 행도 포함한다.
- 따라서 같은 날짜의 기존 장소를 오래된 updated_at으로 수정하면 409가 된다. 최신 상태를 읽고 순차 처리하는 경우 결과는 일관된 1..N이다.
- 별도 날짜 버전은 없다. 목적 날짜를 과거에 보았는지, 빈 날짜가 중간에 바뀌었다 다시 비었는지, 미배정 장소를 추가하는 사용자가 목적 날짜의 최신 구성을 보았는지는 감지하지 않는다. 이 경우 최신 DB 상태의 끝에 추가하고 재조회한다.
- 날짜 전체 스냅샷에 대한 낙관적 잠금을 보장한다고 보고하지 않는다. **장소 비교값에 의한 오래된 요청 차단 + 날짜 구성 쓰기의 원자성**이 최소 보장이다.
- 코멘트 내용 수정에는 별도 버전 잠금을 추가하지 않는다. 같은 사용자의 다중 탭 PUT은 직렬 처리된 마지막 성공 쓰기가 적용된다. 코멘트 쓰기로 부모 updated_at을 바꾸지 않는다. 상태 관련 검사는 언제나 잠금 안에서 수행한다.

**기존 계약 차이:** Figma 74:159의 선택적 비교값을 모든 장소 PATCH·DELETE에 필수로 확장한다. 75:147의 PATCH 예시는 비교값을 추가해야 한다. 75:150의 ‘다른 계정 변경이면 항상 ORDER_CONFLICT’를 위 보장 범위와 UPDATE_CONFLICT로 대체한다. 76:127의 초 정밀도 updated_at 자동 갱신을 밀리초 단조 증가 규칙으로 대체한다. 이 절은 향후 DDL 구현 지침이며 현재 DB는 변경하지 않았다.

## 5. IDR-03 코멘트 작성자와 QA 권한 계약

- GET은 해당 공유 장소의 양쪽 사용자 코멘트를 반환한다.
- PUT `/api/places/:id/comments/:phase`는 세션 userId의 기록만 upsert한다. DELETE 같은 경로도 세션 userId의 기록만 삭제한다. phase는 before/after만 허용한다.
- 클라이언트는 사용자·커플·코멘트 ID를 지정하지 않는다. 요청에 userId/user_id/coupleId/couple_id/added_by/comment_id/id 등 권한·대상 위조 필드를 넣으면 403 FORBIDDEN으로 거부한다. 그 외 알 수 없는 본문 필드는 422다. DELETE는 본문 없이 호출하며 위조 쿼리 필드도 거부한다.
- 본인 기록이 없어도 DELETE는 204로 처리한다. 상대방만 기록이 있는 상태에서 A가 본인 경로를 DELETE하면 B의 기록은 그대로 남는다.
- UNIQUE(place_id,user_id,phase)로 최대 한 개를 보장한다. UI도 실제 정수 user_id로 본인을 판별한다.

**기존 계약 차이:** Figma 75:158·76:160의 ‘상대방 삭제 요청 403’은 상대방 직접 지정 API가 있다는 의미로 구현하지 않는다. QA는 (1) 상대 편집 UI 없음 (2) 위조 작성자 요청 403 (3) 본인 경로 호출이 상대 기록을 변경하지 않음 (4) DB 결과의 작성자가 세션 사용자와 같음으로 검증한다.

## 6. IDR-04 방문 상태와 코멘트 생명주기

| 장소 상태 | before | after |
| --- | --- | --- |
| 미방문 | 본인 작성·수정·삭제 가능 | 작성·수정 불가 |
| 방문 완료 | 기존 기록 조회만 가능. 본인도 수정·삭제 불가 | 본인 작성·수정·삭제 가능 |

상태가 맞지 않는 코멘트 PUT/DELETE는 409 COMMENT_PHASE_LOCKED다. 없는 본인 기록 DELETE는 204로 유지한다. 상대방 기록은 항상 읽기 전용이다.

방문 완료 PATCH는 visited_at을 서버 UTC 시각으로 저장하고 기존 예정일·순서·before를 보존한다. 이미 완료인 장소에 true를 다시 보내도 완료 시각을 덮어쓰지 않는다. 미방문으로 바꾸려면 양쪽 사용자의 after가 모두 없어야 하며, 하나라도 있으면 409 AFTER_COMMENTS_EXIST다. 각 작성자가 자기 after를 삭제한 뒤 재시도한다. 성공하면 visited_at=null, before는 보존되고 미방문 규칙에 따라 다시 편집할 수 있다. 이미 미방문인 false 요청은 변경 없음이다.

장소 전체 삭제는 상태와 무관하게 기존 공유 CRUD 정책대로 허용하되 장소·모든 코멘트 영구 삭제를 명시적으로 확인한다.

**기존 계약 차이:** 기획서 3.6과 Figma 74:163의 신규 작성 중심 설명을 수정까지 명확히 한다. 사용자가 요청한 ‘방문 완료 후 before 읽기 전용’을 삭제에도 적용하므로, Figma의 포괄적인 ‘본인 삭제 가능’보다 제한적이다. after 존재 시 복귀 차단은 그대로 유지한다.

## 7. IDR-05 초기 계정과 초기 데이터

- 빈 DB 최초 초기화 시 사용자 두 명만 생성한다. places와 place_comments는 0건으로 시작한다.
- user_a/user_b는 논리적 계정명이며 INT PK 자체가 아니다. 로그인 이메일은 `user_a@example.test`, `user_b@example.test`, 표시 이름은 사용자 A/사용자 B, couple_id는 couple_001로 고정한다. UI의 지우/도윤은 seed 기준이 아니다.
- 설치 시 계정별 비밀번호를 비공개 입력으로 받아 서로 다른 salt의 bcrypt 해시로 저장한다. bcrypt 비용은 12를 기본으로 하고 실제 ARM64 실행 시간을 검증한다. bcrypt 입력은 UTF-8 72바이트 이하로 검증하여 조용한 잘림을 막는다.
- 비밀번호·DB 암호·SESSION_SECRET·세션 ID는 Git·공개 이미지·로그에 포함하지 않는다. 비공개 설정은 Git 제외 대상이며 예시는 빈 placeholder만 제공한다. 설치 비밀번호를 코드나 고정 SQL 평문으로 제공하지 않는다.
- 기존 볼륨 재사용 시 사용자 암호/기록을 재초기화하지 않는다. 계정 변경·데이터 제거는 별도 승인 범위다.

**기존 계약 차이:** 기획서 2.2의 ‘계정만 사전 등록’을 채택하고 9.5의 ‘최소 예제 데이터’는 두 사용자로 충족한다. 시연 장소와 코멘트는 실제 UI/API로 생성한다. Figma 76:131의 표시명·미정 이메일을 위 값으로 확정한다.

## 8. IDR-06 Redis 세션

| 설정 | 확정 규칙 |
| --- | --- |
| 저장소 | 양쪽 API가 ourspot-redis:6379, Redis DB 0 사용 |
| 쿠키명·키 prefix | ourspot.sid / ourspot:sess: |
| 서명·직렬화 | 동일 SESSION_SECRET과 호환 express-session/connect-redis 버전·직렬화 |
| 쿠키 | HttpOnly=true, SameSite=Lax, Path=/, Domain 미설정, 로컬 HTTP Secure=false, HTTPS Secure=true |
| 유효기간 | 로그인 성공 시부터 절대 24시간. 활동에 따른 연장 없음 |

성공한 로그인은 기존 세션을 폐기하고 regenerate 후 userId/coupleId와 서버 생성 expiresAt(UTC 만료 시각)을 저장한다. Redis 저장 성공을 확인한 뒤 200과 쿠키를 응답한다. 쿠키 maxAge는 86,400,000ms, 최초 Redis TTL은 86,400초다. TTL touch/rolling 연장을 비활성화하고 재저장 시에도 남은 절대 시간만 사용한다. 양 API는 expiresAt을 확인하므로 Redis TTL이나 쿠키가 남아도 24시간 이후 인증하지 않는다. 일반 읽기 요청은 세션을 다시 저장하지 않는다. 양 API는 resave=false/saveUninitialized=false를 기본으로 한다.

로그아웃은 Redis 세션 삭제 성공 후 같은 쿠키 옵션으로 쿠키를 제거하고 204다. 정상 Redis 상태에서 세션 없는 로그아웃도 쿠키 제거 후 204다. 삭제 실패를 로그아웃 성공으로 보고하지 않는다.

Redis 읽기·저장·삭제 장애 시 503 SESSION_UNAVAILABLE이며 로그인·보호 API·로그아웃을 성공 처리하지 않는다. 메모리 세션이나 익명 접근으로 우회하지 않는다. 정상 저장소에서 쿠키 없음·서명 오류·세션 없음·만료는 401 AUTH_REQUIRED다. 이미 인증 검사를 통과한 진행 중 요청을 장애 발생 시 소급 취소하는 보장은 없다. 장애 복구 시 서버에 남은 미만료 세션이 유효할 수 있으므로 실패한 로그아웃은 재시도한다.

**기존 계약 차이:** 기획서 6.4·Figma 76:138~141의 공통 설정을 24시간 절대 만료·고정 prefix·장애 응답으로 구체화했다. secret 실제 값은 설치 시 생성한다.

## 9. IDR-07 UTC 시각과 한국 달력 날짜

- created_at/updated_at/visited_at 및 세션 시각은 UTC다. DB 연결 세션 time_zone은 +00:00으로 고정한다. 시각 컬럼은 DATETIME(3), API는 ISO8601 UTC Z로 전달한다. updated_at의 버전 정밀도를 보존한다.
- planned_date는 Asia/Seoul 기준 달력 날짜를 나타내는 DATE이며 YYYY-MM-DD 문자열 그대로 저장·전달한다. 자정 UTC timestamp로 변환하지 않는다. 실제 존재하는 날짜인지 서버에서 검증한다.
- 기본 선택 날짜·표시 시각은 브라우저 OS 시간대와 무관하게 Asia/Seoul 기준이다.
- 오래된 미방문 판정은 `서울 기준 오늘 날짜 - created_at을 서울 날짜로 변환한 날짜 >= 30`이다. 720시간 경과와 다르며 수정일·예정일·방문 복귀일로 기준을 바꾸지 않는다.
- 예: 2026-10-01T15:30:00.000Z는 한국 10월 2일 저장이므로 한국 11월 1일 00:00부터 라벨 대상이다. 방문 완료면 오래되어도 라벨을 붙이지 않는다.
- DB 타임존 테이블 설치에 의존하지 않도록 한국 날짜 계산은 명시적 +09:00 또는 애플리케이션 Asia/Seoul 변환으로 구현하고 결과를 일치시킨다.

**기존 계약 차이:** 기획서 3.7의 ‘30일 예시’를 Figma 기준대로 확정하고, Figma 74:154·75:142에서 미정이던 판정 경계를 한국 달력 날짜로 구체화한다.

## 10. IDR-08 방문 완료 장소와 일정

방문 완료는 기존 planned_date/visit_order를 유지한다. 날짜별 계획 GET에는 해당 날짜의 방문 완료 장소도 포함한다. 미방문 후보 GET(status=unvisited)에서는 제외한다.

서버도 방문 완료 장소의 신규 날짜 배정·다른 날짜 이동은 409 PLACE_ALREADY_VISITED로 거부한다. 같은 날짜의 순서 수정·일정 제외·일반 정보 수정은 허용한다. 기존 날짜 기록은 완료 동작으로 자동 제거하지 않는다는 의미이며 사용자의 명시적 제외까지 금지하지 않는다. 방문 상태를 미방문으로 복귀한 뒤에는 일반 배정 규칙이 적용된다.

근거: 기획서의 기록 보존과 Figma 75:144의 미방문 후보. 방문 완료 후 일정 조작 범위는 이번 추가 결정이다.

## 11. IDR-09 순서 불변 조건

- 같은 couple_id·planned_date의 모든 장소(방문 완료 포함)는 visit_order=1..N을 중복·누락 없이 가진다. 미배정이면 planned_date/visit_order 모두 null이다.
- 신규 배정·다른 날짜 이동은 목적 날짜 N+1로 추가한다. 출발 날짜는 빈 번호 없이 재정렬한다.
- 기존 장소의 순서 변경은 1..N 정수만 허용한다. 해당 장소를 뺀 목록의 요청 위치에 삽입하고 다른 번호를 이동한다. 범위 밖·미배정 상태의 숫자 순서 변경은 422다.
- 이동·제외·삭제·순서 변경은 4절의 단일 트랜잭션에서 수행한다. 마지막 장소 제외 후 빈 일정은 정상이다. 예정일 유지 + 숫자 순서 null은 422다.
- UI ↑↓는 첫/마지막 버튼을 비활성화하고 성공·충돌 후 해당 날짜를 재조회한다. 클라이언트가 여러 PATCH로 두 행을 교환하지 않는다.

**기존 계약 차이:** 기획서 3.4의 ‘추가할 때 방문 순서 지정’을 기본 끝 추가 후 별도 순서 변경으로 단순화한다. Figma 74:144·159~160의 연속 순서를 유지한다.

## 12. IDR-10 공통 API 계약

### 유지하는 엔드포인트

| Method | 경로 | 정상 응답 |
| --- | --- | --- |
| POST | /api/auth/login | 200 data.user + 세션 쿠키 |
| POST | /api/auth/logout | 204 |
| GET | /api/auth/me | 200 data.user |
| GET | /api/places | 200 data.places, data.counts |
| POST | /api/places | 201 data.place |
| GET | /api/places/:id | 200 data.place |
| PATCH | /api/places/:id | 200 data.place |
| DELETE | /api/places/:id | 204 |
| GET | /api/places/:id/comments | 200 data.comments |
| PUT | /api/places/:id/comments/:phase | 200 data.comment |
| DELETE | /api/places/:id/comments/:phase | 204 |

204는 본문이 없으며 JSON을 파싱하지 않는다.

POST 장소는 title/category/source_url/memo만 받으며 미방문·미배정으로 생성한다. PATCH 변경 가능 필드는 title/category/source_url/memo/planned_date/visit_order/is_visited이며 expected_updated_at·confirm_move는 제어 필드다. 빈 변경 요청은 422다. created_at/updated_at/visited_at을 직접 지정하면 422, 권한·등록자 위조 필드는 403이다. confirm_move는 boolean만 허용한다. 모든 예시의 장소 ID와 시각은 설명용 값이며 실제 실행 결과가 아니다.

user 응답은 `{id,email,display_name,couple_id}`이며 password_hash·세션 ID·비밀키·Redis 키를 반환하지 않는다. 장소·코멘트 반환 필드는 Figma 74:154~155를 따른다. is_visited는 JSON boolean, nullable 값은 null, 시각은 9절 형식이다.

counts는 **세션 커플 전체 장소** 기준 `{unvisited,visited}`다. 목록의 status/planned_date/sort 필터와 무관하다. 목록과 counts는 같은 읽기 트랜잭션 스냅샷에서 산출한다. 다른 계정의 등록 장소도 포함한다.

쿼리는 기획서의 status=unvisited|visited, planned_date=YYYY-MM-DD, sort=oldest를 지원하며 status와 날짜는 AND다. 잘못된 값은 422. 날짜 필터가 있으면 visit_order ASC, id ASC가 우선이다. 날짜 없는 oldest는 created_at ASC,id ASC, 그 외는 created_at DESC,id DESC다. 오래된 라벨을 위한 새 필터 엔드포인트는 만들지 않는다.

로그인은 `{email,password}`다. 이메일은 trim·소문자 정규화하고 비밀번호는 원문을 유지한다. 빈 필드·형식 오류는 서버에서도 422, 존재하지 않는 계정·틀린 비밀번호는 동일한 401 AUTH_FAILED 메시지다. 프론트는 로그인 실패 401을 만료 리다이렉트와 구분한다.

| HTTP | error.code | 의미 |
| --- | --- | --- |
| 400 | BAD_REQUEST | 파싱 불가능한 JSON |
| 401 | AUTH_FAILED | 이메일 또는 비밀번호 오류 |
| 401 | AUTH_REQUIRED | 보호 API에 유효한 세션 없음 |
| 403 | FORBIDDEN | 사용자·권한·대상 위조 필드 등 금지된 요청 |
| 404 | NOT_FOUND | 없는/접근 불가능한 장소, 지원하지 않는 API 경로 |
| 409 | UPDATE_CONFLICT | 장소 비교값 불일치 |
| 409 | DATE_CONFLICT | 확인하지 않은 다른 날짜 이동 |
| 409 | AFTER_COMMENTS_EXIST | after가 남아 있어 미방문 복귀 불가 |
| 409 | COMMENT_PHASE_LOCKED | 현재 상태에서 코멘트 변경 불가 |
| 409 | PLACE_ALREADY_VISITED | 방문 완료 장소 신규 배정·날짜 이동 불가 |
| 422 | VALIDATION_ERROR | 입력값·필수 비교값·필드 조합 오류 |
| 500 | INTERNAL_ERROR | 예상하지 못한 서버 오류 |
| 503 | SESSION_UNAVAILABLE | Redis 세션 작업 장애 |
| 503 | WRITE_BUSY | DB 교착·잠금 대기 시간 초과 |

오류 형식은 `{error:{code,message,fieldErrors?,details?}}`다. 서버 내부 SQL·스택·비밀정보를 노출하지 않는다. 인증 후 권한/입력 검사, 장소 접근 확인, 잠금 안의 비교값 검사, 현재 상태·날짜 확인 순으로 처리한다. 인증 실패 시 객체 존재 정보를 반환하지 않는다. 재조회가 필요한 details는 UI 갱신 참고이며 자동 덮어쓰기 근거가 아니다.

### JSON 예시

로그인 성공 (200):

```json
{"data":{"user":{"id":1,"email":"user_a@example.test","display_name":"사용자 A","couple_id":"couple_001"}}}
```

날짜 이동 요청:

```json
{"planned_date":"2026-11-14","expected_updated_at":"2026-11-01T08:00:00.123Z","confirm_move":true}
```

확인 없는 이동 (409):

```json
{"error":{"code":"DATE_CONFLICT","message":"다른 날짜로 이동할까요?","details":{"current_planned_date":"2026-11-13","requested_planned_date":"2026-11-14","current_updated_at":"2026-11-01T08:00:00.123Z"}}}
```

오래된 장소 수정·삭제·순서 변경 (409):

```json
{"error":{"code":"UPDATE_CONFLICT","message":"장소가 변경됐어요. 최신 내용을 확인해 주세요.","details":{"current_updated_at":"2026-11-01T08:00:00.124Z"}}}
```

인증 실패·권한 오류·검증 오류:

```json
{"error":{"code":"AUTH_FAILED","message":"이메일 또는 비밀번호를 확인해 주세요."}}
```

```json
{"error":{"code":"AUTH_REQUIRED","message":"로그인이 필요해요."}}
```

```json
{"error":{"code":"FORBIDDEN","message":"권한이 없는 작업이에요."}}
```

```json
{"error":{"code":"VALIDATION_ERROR","message":"입력값을 확인해 주세요.","fieldErrors":{"expected_updated_at":"최신 장소 정보가 필요해요."}}}
```

**기존 계약 차이:** 74:153의 envelope를 유지하면서 AUTH_FAILED를 공통 목록에 포함한다. UPDATE_CONFLICT·상태 충돌·503을 추가하고 ORDER_CONFLICT를 대체한다. 75:167의 전역 401 이동은 로그인 요청의 AUTH_FAILED에 적용하지 않는다. counts 범위는 이번 확정 사항이다.

## 13. 구현 후 검증 조건 — 현재 전부 미실시

아래는 승인 기준이며 이번 문서 작성으로 통과한 테스트가 아니다.

| ID | 검증 시나리오와 기대 결과 |
| --- | --- |
| V01 | 미배정 추가 성공, 다른 날짜 미확인 이동 409, 확인 이동 성공, 같은 날짜 순서 변경·일정 제외에 DATE_CONFLICT 없음 |
| V02 | A/B가 같은 updated_at으로 장소 수정: 첫 성공, 다음 409. 같은 밀리초 연속 쓰기에서도 비교값 증가. 삭제에도 오래된 비교값 차단 |
| V03 | 같은 날짜의 서로 다른 장소를 오래된 화면에서 재정렬: 먼저 성공한 일정 작업이 전 행 비교값을 바꿔 다음 요청 409 |
| V04 | 빈 날짜 동시 추가·양방향 이동·삭제와 순서 변경 경합: 중복/누락 없이 1..N, 모든 변경 원자적. 목적 날짜 스냅샷 충돌은 보장하지 않음을 확인 |
| V05 | 중간 실패·잠금 시간 초과 시 장소 날짜·양 날짜 순서·updated_at 전체 롤백. 다른 DB 연결로 경합을 재현 |
| V06 | A/B 상호 코멘트 조회, 본인 upsert 한 개 유지, 위조 사용자 403, 본인 DELETE가 상대 기록을 지우지 않음 |
| V07 | 완료 후 before PUT/기존 기록 DELETE 409, 조회 보존. after 존재 시 복귀 409. 작성자들이 삭제 후 복귀 성공 |
| V08 | after 생성과 복귀 동시 요청은 한 순서로 직렬화되어 미방문+after 조합이 생기지 않음 |
| V09 | 최초 설치 두 사용자·장소/코멘트 0건, 해시 검증 로그인, 기존 볼륨 재사용 데이터 유지, 비밀값 Git/이미지/로그 미포함 |
| V10 | 로그인 시 세션 ID 변경, Redis 저장 후 응답, 서로 다른 API에서 동일 사용자 확인, 로그아웃 후 이전 쿠키 401 |
| V11 | 요청을 반복해도 로그인 기준 24시간 후 양 API에서 만료. Redis 읽기/저장/삭제 장애 시 503, 메모리 대체 없음 |
| V12 | 한국 자정·UTC 전날·29/30일 경계·브라우저 다른 시간대에서 동일 판정, DATE 문자열 왕복 변형 없음 |
| V13 | 방문 완료 시 기존 날짜·순서 유지, 계획 조회에는 포함·미방문 후보에는 제외, 서버의 완료 장소 신규 배정 거부 |
| V14 | 상태/날짜 필터와 무관한 커플 전체 counts, 로그인 실패 코드와 만료 코드 분기, 204 JSON 파싱 없음 |
| V15 | 6개 컨테이너·네트워크·포트·bash·Redis 공유 증거, MySQL 재시작 전후 동일 장소/코멘트 ID·내용과 Volume 연결 증거 |
| V16 | ARM64 이미지 호환, COPY 포함 배포 이미지 독립 실행, 백업·복원·재설치, 실제 명령·태그와 보고서 일치, 3분 이내 무편집 시연 |

SQL·HTTP·브라우저 검증을 실제 수행한 뒤 결과를 별도 기록한다. Figma 클릭 전환이나 본 문서 검토는 실행 증거가 아니다. 제출 구성도는 학생이 직접 작성한다. 외부 배포·Git push와 파괴적 데이터 변경은 별도 사용자 확인을 따른다.

## 14. 남은 설치 값과 실행 검증

기능·API 모호성은 이 문서의 범위에서 확정했다. 남은 것은 실제 환경에서 정할 값과 검증이다.

- 설치 시 비밀번호·DB 암호·SESSION_SECRET 생성 및 비공개 전달 방법.
- Docker Hub 사용자/태그 확정과 배포 승인, Ubuntu 호스트 주소·8080 포트 사용 가능 여부.
- ARM64 호환 MySQL·Node·Redis·Nginx·Apache 및 세션 라이브러리 버전 고정, bcrypt 비용 12 실행 시간 확인.
- MySQL 밀리초 왕복 정밀도·잠금 규약·트랜잭션 롤백·절대 세션 만료가 위 조건을 실제로 만족하는지 검증.

검증 과정에서 호환성 문제가 드러나면 보장 범위를 조용히 낮추지 말고 본 기록의 변경 근거와 재검증 결과를 남긴다.
