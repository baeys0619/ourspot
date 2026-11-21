ARG NODE_BASE=node:22-bookworm-slim
FROM ${NODE_BASE}
WORKDIR /app
ENV NODE_ENV=production
# npm ci는 lockfile의 정확한 의존성을 설치하며 실제 비밀 설정은 COPY하지 않는다.
COPY services/package.json services/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/common ./common
ARG SERVICE
COPY services/${SERVICE}/*.cjs ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
