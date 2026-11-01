# OURSPOT — Codex Project Instructions

## Project

OURSPOT은 2026-2학기 클라우드네이티브 기말고사
대체과제로 개발하는 커플 데이트 장소 공유 웹 서비스다.

프로젝트의 최우선 목표는 교수님의 필수 요구사항을
충족하는 Docker 기반 마이크로서비스 구현이다.

## Source of Truth

### 서비스 기획서
docs/design/proposal.md

- 기능, 비즈니스 규칙, DB, API를 구현하기 전에 확인한다.
- 파일이 실제로 존재하는지 확인하고 내용을 읽는다.
- 기획서에 없는 기능을 임의로 추가하지 않는다.

### 구현 규칙 확정 문서
docs/design/implementation-decisions.md

- 기능·DB·API·인증 구현 전에 기획서와 함께 실제 내용을 읽는다.
- 이 문서가 명시적으로 해결한 모호성·충돌은 해당 문서의 확정 규칙을 따른다.
- 교수님의 필수 요구사항이 최우선이며, 확정 문서가 다루지 않은 기능·범위는 기획서를 따른다.
- Figma 개발 인계의 우선 노드는 74:120, 75:120, 76:120이다. 58:19는 이전 참고 메모다.
- 새로운 충돌은 임의로 해석하거나 기능을 추가하지 말고 보고한다.

### Figma 디자인
https://www.figma.com/design/RJUp9mnBERMYSg2rnpR6GO/

File Key: RJUp9mnBERMYSg2rnpR6GO

Pages:
- 35:32 — 최종 웹 화면
- 35:33 — 반응형 웹
- 35:34 — UI 디자인 시스템
- 35:35 — 개발 인계 및 QA

UI 작업 전에는 Figma MCP를 통해 관련 프레임의
실제 디자인 정보를 조회한다.

프레임 이름과 메타데이터만으로 시각적 세부사항을
추측하지 않는다. 가능한 경우 디자인 컨텍스트와
스크린샷도 확인한다.

### 과제 요구사항

기획서에 기록된 교수님의 과제 요구사항을 우선한다.
관련 설계가 충돌하면 임의로 변경하지 말고 보고한다.

## Technology Constraints

- Ubuntu 24.04 ARM64
- Docker
- Nginx Reverse Proxy
- HTML / CSS / Vanilla JavaScript
- Node.js Express User API
- Node.js Express Place API
- MySQL
- Redis

React와 Vue 사용 금지.

최소 6개 컨테이너 구성.
2개 이상의 독립된 백엔드 서비스 구성.
서버 간 Redis 세션 공유 필수.
MySQL Volume Mount 및 데이터 영속성 검증 필수.

## Development Rules

- 작업 전 관련 기획서와 Figma 정보를 확인한다.
- 기능을 임의로 추가하지 않는다.
- 교수님 요구에 따라 코드에 상세한 설명 주석을 작성한다.
- 실제 비밀번호와 토큰을 Git에 커밋하지 않는다.
- 구현 후 테스트를 수행하고 결과를 보고한다.
- Docker 실행 명령어를 재현 가능하게 기록한다.
- 사용자 승인 없이 Docker Volume, Git 이력,
  기존 데이터를 파괴적으로 변경하지 않는다.
- 외부 배포 및 Git push는 사용자 확인 후 수행한다.
- 검증하지 않은 항목을 완료로 보고하지 않는다.

## Workflow

1. 관련 문서 및 현재 코드 확인
2. 구현 범위와 계획 제시
3. 최소 단위로 구현
4. 실제 실행 및 테스트
5. 결과와 미완료 항목 보고
6. 검증 성공 후 다음 단계 진행

## Submission Restrictions

교수님 제출용 시스템 구성도는 학생이 직접 작성한다.
AI로 최종 시스템 구성도를 생성하지 않는다.

과제 제출에 필요한 컨테이너, 네트워크, 세션 공유,
DB 영속성 증거를 실제 실행 결과로 확보한다.
