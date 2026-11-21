'use strict';
const express = require('express');
const {connectInfrastructure} = require('./infrastructure.cjs');
const {assertAccountsReady} = require('./accounts.cjs');

// 인프라 준비 상태는 실제 MySQL 쿼리와 Redis PING으로 검사한다.
async function start(service, prefix, registerRoutes) {
  const infra = await connectInfrastructure();
  await assertAccountsReady(infra.db);
  const app = express();
  app.disable('x-powered-by');
  // API는 Docker 내부 포트로만 열리고 바로 앞 Nginx가 전달 프로토콜을 덮어쓴다.
  if (process.env.COOKIE_SECURE === 'true') app.set('trust proxy', 1);
  app.get(['/health', `${prefix}/health`], async (_req, res) => {
    try {
      await infra.db.query('SELECT 1');
      await infra.redis.ping();
      res.json({data: {service, status: 'ok', mysql: 'ok', redis: 'ok'}});
    } catch {
      res.status(503).json({error: {code: 'DEPENDENCY_UNAVAILABLE', message: '필수 저장소를 사용할 수 없어요.'}});
    }
  });
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(infra.sessionMiddleware);
  await registerRoutes(app, infra);
  app.use((_req, res) => res.status(404).json({error: {code: 'NOT_FOUND', message: '지원하지 않는 API 경로예요.'}}));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(new Error('API response failed'));
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({error: {code: 'BAD_REQUEST', message: 'JSON 요청을 읽을 수 없어요.'}});
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({error: {code: 'BAD_REQUEST', message: '요청 본문이 너무 커요.'}});
    }
    res.status(500).json({error: {code: 'INTERNAL_ERROR', message: '요청을 처리할 수 없어요.'}});
  });
  const server = app.listen(3000, '0.0.0.0', () => console.log(`${service} listening on 3000`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(async () => {await infra.close(); process.exit(0);});
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
// Express 4는 async 핸들러의 거부를 자동 전달하지 않으므로 공통 JSON 오류 처리로 보낸다.
const asyncRoute = handler => (req, res, next) => handler(req, res).catch(next);

module.exports = {start, asyncRoute};
