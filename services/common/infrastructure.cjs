'use strict';
const mysql = require('mysql2/promise');
const { createClient } = require('redis');
const session = require('express-session');
const RedisStore = require('connect-redis').default;

const SESSION_COOKIE = 'ourspot.sid';
const SESSION_DURATION = 86_400_000;
const cookieOptions = {
  httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/',
};

function requireConfig(keys) {
  for (const key of keys) {
    if (!process.env[key]) throw new Error(`Missing configuration: ${key}`);
  }
}

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

// 두 API는 Redis 저장 형식, 서명 키와 만료 기준을 공유한다.
async function connectInfrastructure() {
  requireConfig(['REDIS_URL', 'SESSION_SECRET']);
  const secret = process.env.SESSION_SECRET;
  if (secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  const db = createDatabasePool();
  const redis = createClient({url: process.env.REDIS_URL,
    disableOfflineQueue: true, socket: {connectTimeout: 3000, reconnectStrategy: retries => Math.min(200 * retries, 2000)}});
  // 접속 정보/세션 ID를 기록하지 않고 장애 종류만 표시한다.
  redis.on('error', () => console.error('Redis connection unavailable'));
  await redis.connect();
  await db.query('SELECT 1');
  const store = new RedisStore({client: redis, prefix: 'ourspot:sess:', disableTouch: true, ttl: sessionTtl});
  const middleware = session({store, name: SESSION_COOKIE, secret, unset: 'keep',
    resave: false, saveUninitialized: false, rolling: false,
    cookie: {...cookieOptions, maxAge: SESSION_DURATION}});

  function sessionMiddleware(req, res, next) {
    if (!redis.isReady) return sessionUnavailable(res);
    middleware(req, res, error => {
      if (error || !req.session) return sessionUnavailable(res);
      next();
    });
  }

  function issueSessionCookie(req, res) {
    const {id, expiresAt} = req.session;
    // 저장을 확인한 뒤 Express로 동일하게 서명한다. 응답 종료 시 재저장과 자동 쿠키 발급을 막는다.
    delete req.session;
    req.secret = secret;
    res.cookie(SESSION_COOKIE, id, {...cookieOptions, signed: true, expires: new Date(expiresAt)});
  }
  async function close() { await db.end(); if (redis.isOpen) await redis.quit(); }
  return {db, redis, store, sessionMiddleware, issueSessionCookie, close};
}

function sessionTtl({expiresAt}) {
  // TTL 0은 connect-redis에서 키 삭제를 의미한다. NaN이나 음수는 Redis에 전달하지 않는다.
  if (!Number.isSafeInteger(expiresAt)) return 0;
  return Math.max(0, Math.min(SESSION_DURATION / 1000, Math.ceil((expiresAt - Date.now()) / 1000)));
}

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
const clearSessionCookie = res => res.clearCookie(SESSION_COOKIE, cookieOptions);

module.exports = {createDatabasePool, connectInfrastructure, requireSession, sessionTtl,
  authRequired, sessionUnavailable, clearSessionCookie, SESSION_DURATION};
