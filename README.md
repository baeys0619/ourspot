cat > README.md <<'EOF'
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
EOF
