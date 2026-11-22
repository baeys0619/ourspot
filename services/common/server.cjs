'use strict';
const express = require('express');
const {connectInfrastructure} = require('./infrastructure.cjs');
const {assertAccountsReady} = require('./accounts.cjs');

// 인프라 준비 상태는 실제 MySQL 쿼리와 Redis PING으로 검사한다.
async function start(service, prefix, registerRoutes) {
  const infra = await connectInfrastructure();
  // 필수 저장소 연결과 초기 계정 상태 확인을 마쳐야 요청을 받는다.
  await assertAccountsReady(infra.db);
  const app = express();
  app.disable('x-powered-by');
  // API는 Docker 내부 포트로만 열리고 바로 앞 Nginx가 전달 프로토콜을 덮어쓴다.
  if (process.env.COOKIE_SECURE === 'true') app.set('trust proxy', 1);
  // 컨테이너 내부 /health와 프록시를 거치는 서비스별 경로를 같은 검사에 연결한다. 세션을 읽기 전에 등록해 쿠키 없이 확인할 수 있다.
  app.get(['/health', `${prefix}/health`], async (_req, res) => {
    try {
      await infra.db.query('SELECT 1');
      await infra.redis.ping();
      res.json({data: {service, status: 'ok', mysql: 'ok', redis: 'ok'}});
    } catch {
      res.status(503).json({error: {code: 'DEPENDENCY_UNAVAILABLE', message: '필수 저장소를 사용할 수 없어요.'}});
    }
  });
  // 인증·장소 응답을 캐시에 남기지 않는다. 이하 경로는 Redis 세션을 거친 뒤 서비스별 라우트에서 처리한다.
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(infra.sessionMiddleware);
  await registerRoutes(app, infra);
  // 세션 미들웨어를 지난 요청 중 등록된 서비스 경로와 일치하지 않는 경우에만 아래 404에 도달한다.
  app.use((_req, res) => res.status(404).json({error: {code: 'NOT_FOUND', message: '지원하지 않는 API 경로예요.'}}));
  // 본문을 읽는 단계의 오류는 400 또는 413으로 구분한다. 그 밖의 예외는 내부 SQL과 스택을 빼고 500만 응답한다.
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
  // 종료 신호가 오면 새 연결을 받지 않고 진행 중인 요청을 기다린다. 정상 종료가 지연되면 제한 시간 후 프로세스를 끝낸다.
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(async () => {await infra.close(); process.exit(0);});
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
// Express 4는 async 핸들러의 거부를 자동 전달하지 않으므로 공통 JSON 오류 처리로 보낸다.
const asyncRoute = handler => (req, res, next) => handler(req, res).catch(next);

module.exports = {start, asyncRoute};
