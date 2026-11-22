# build.sh가 넘긴 베이스 이미지로 두 API를 빌드한다. SERVICE에 따라 실행 파일이 달라지고, 각 이미지가 자체 Node.js 프로세스를 띄운다.
ARG NODE_BASE=node:22-bookworm-slim
FROM ${NODE_BASE}
WORKDIR /app
ENV NODE_ENV=production
# npm ci는 lockfile의 정확한 의존성을 설치하며 실제 비밀 설정은 COPY하지 않는다.
COPY services/package.json services/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/common ./common
# 공통 모듈은 같은 위치에 두고 SERVICE로 고른 API 소스만 이미지에 추가한다.
ARG SERVICE
COPY services/${SERVICE}/*.cjs ./
USER node
EXPOSE 3000
# 컨테이너 내부 /health로 API와 두 저장소의 준비 상태를 확인한다.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
