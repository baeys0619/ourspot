'use strict';
const mysql = require('mysql2/promise');
const { createClient } = require('redis');
const session = require('express-session');
const RedisStore = require('connect-redis').default;

const SESSION_COOKIE = 'ourspot.sid';
const SESSION_DURATION = 86_400_000;
// 쿠키는 브라우저에서 API 두 경로에 함께 보내도록 Path를 /로 둔다. HttpOnly로 스크립트 접근을 막고 Secure는 설치 설정을 따른다.
const cookieOptions = {
  httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/',
};

// 필수 환경변수가 비어 있으면 초기화를 중단한다. 오류에는 값 대신 항목 이름만 넣는다.
function requireConfig(keys) {
  for (const key of keys) {
    if (!process.env[key]) throw new Error(`Missing configuration: ${key}`);
  }
}

// API 요청마다 연결을 새로 만드는 대신 프로세스별로 최대 다섯 연결을 재사용한다.
// dateStrings로 DATE는 달력 문자열로, DATETIME은 소수점 이하를 포함한 문자열로 읽는다.
function createDatabasePool() {
  requireConfig(['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']);
  const db = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    connectionLimit: 5, connectTimeout: 3000, charset: 'utf8mb4_unicode_ci', timezone: 'Z', dateStrings: true,
  });
  // MySQL 서버의 default-time-zone도 +00:00으로 설정한다. 연결별 설정을 함께 고정한다.
  db.pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));
  return db;
}

// 각 API가 같은 Redis DB와 키 접두어, 서명 키를 사용한다.
// User API가 발급한 쿠키를 Place API도 검증한 뒤 같은 세션 ID로 Redis에서 사용자와 커플 정보를 읽는다.
async function connectInfrastructure() {
  requireConfig(['REDIS_URL', 'SESSION_SECRET']);
  const secret = process.env.SESSION_SECRET;
  if (secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  const db = createDatabasePool();
  // 연결이 끊겼을 때 명령을 대기열에 쌓지 않는다. 클라이언트는 간격을 두고 재접속한다.
  const redis = createClient({url: process.env.REDIS_URL,
    disableOfflineQueue: true, socket: {connectTimeout: 3000, reconnectStrategy: retries => Math.min(200 * retries, 2000)}});
  // 접속 정보/세션 ID를 기록하지 않고 장애 종류만 표시한다.
  redis.on('error', () => console.error('Redis connection unavailable'));
  await redis.connect();
  await db.query('SELECT 1');
  // 읽기 요청으로는 Redis TTL과 쿠키가 연장되지 않는다.
  // 변경 없는 새 세션은 저장하지 않으며, 저장할 때는 절대 만료 시각까지 남은 시간을 쓴다.
  const store = new RedisStore({client: redis, prefix: 'ourspot:sess:', disableTouch: true, ttl: sessionTtl});
  const middleware = session({store, name: SESSION_COOKIE, secret, unset: 'keep',
    resave: false, saveUninitialized: false, rolling: false,
    cookie: {...cookieOptions, maxAge: SESSION_DURATION}});

  // Redis가 준비되지 않았거나 세션 조회가 실패하면 503이다.
  // 저장소는 정상인데 유효한 인증 정보가 없는 경우에는 보호 경로의 requireSession이 401을 반환한다.
  function sessionMiddleware(req, res, next) {
    if (!redis.isReady) return sessionUnavailable(res);
    middleware(req, res, error => {
      if (error || !req.session) return sessionUnavailable(res);
      next();
    });
  }

  // 브라우저에는 서명된 세션 ID와 만료 시각을 보낸다. 사용자와 커플 정보는 Redis에 남는다.
  function issueSessionCookie(req, res) {
    const {id, expiresAt} = req.session;
    // Redis 저장을 마친 세션 ID를 같은 비밀키로 서명해 쿠키에 담는다.
    // req.session을 분리해 응답을 끝낼 때 미들웨어가 세션 저장이나 쿠키 발급을 다시 하지 않게 한다.
    delete req.session;
    req.secret = secret;
    res.cookie(SESSION_COOKIE, id, {...cookieOptions, signed: true, expires: new Date(expiresAt)});
  }
  // 공통 서버가 종료될 때 MySQL 풀과 열려 있는 Redis 연결을 닫는다.
  async function close() { await db.end(); if (redis.isOpen) await redis.quit(); }
  return {db, redis, store, sessionMiddleware, issueSessionCookie, close};
}

// Redis TTL은 초 단위로 계산한다. 남은 시간이 1초보다 짧아도 절대 만료 검사는 밀리초 값으로 수행한다.
function sessionTtl({expiresAt}) {
  // TTL 0은 connect-redis에서 키 삭제를 의미한다. NaN이나 음수는 Redis에 전달하지 않는다.
  if (!Number.isSafeInteger(expiresAt)) return 0;
  return Math.max(0, Math.min(SESSION_DURATION / 1000, Math.ceil((expiresAt - Date.now()) / 1000)));
}

// Redis 키의 TTL 이외에 세션에 기록한 절대 만료 시각을 확인한다. 반올림 때문에 키가 잠시 남아 있어도 24시간을 넘겨 인증하지 않는다.
function requireSession(req, res, next) {
  const {userId, coupleId, expiresAt} = req.session;
  if (!Number.isInteger(userId) || userId <= 0 || typeof coupleId !== 'string' || !coupleId ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    return authRequired(res);
  }
  next();
}

const authRequired = res => res.status(401).json({error: {code: 'AUTH_REQUIRED', message: '로그인이 필요해요.'}});
const sessionUnavailable = res => res.status(503).json({error: {code: 'SESSION_UNAVAILABLE', message: '세션 저장소를 사용할 수 없어요.'}});
// 발급에 쓴 이름과 경로 옵션으로 쿠키를 만료시킨다. 호출 시점은 Redis 삭제가 성공한 뒤다.
const clearSessionCookie = res => res.clearCookie(SESSION_COOKIE, cookieOptions);

module.exports = {createDatabasePool, connectInfrastructure, requireSession, sessionTtl,
  authRequired, sessionUnavailable, clearSessionCookie, SESSION_DURATION};
