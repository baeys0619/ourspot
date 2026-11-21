'use strict';

const {randomBytes} = require('node:crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const {start, asyncRoute} = require('./common/server.cjs');
const {requireSession, authRequired, sessionUnavailable, clearSessionCookie,
  SESSION_DURATION} = require('./common/infrastructure.cjs');
const {BCRYPT_COST, validPassword} = require('./common/accounts.cjs');

const userColumns = 'id, email, display_name, couple_id';
const identityFields = ['id', 'userId', 'user_id', 'coupleId', 'couple_id', 'added_by'];

async function registerRoutes(app, {db, issueSessionCookie}) {
  // 존재하지 않는 이메일도 bcrypt 비교를 거쳐 두 실패 경로의 비용을 비슷하게 유지한다.
  const fallbackHash = await bcrypt.hash(randomBytes(32), BCRYPT_COST);
  app.post('/api/auth/login', express.json({limit: '8kb', strict: false}), asyncRoute(async (req, res) => {
    if (process.env.COOKIE_SECURE === 'true' && !req.secure) {
      return res.status(400).json({error: {code: 'BAD_REQUEST', message: 'HTTPS 연결이 필요해요.'}});
    }
    const input = req.body;
    const form = input !== null && typeof input === 'object' && !Array.isArray(input);
    if (form && identityFields.some(key => Object.hasOwn(input, key))) {
      return res.status(403).json({error: {code: 'FORBIDDEN', message: '권한이 없는 작업이에요.'}});
    }
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!form || Object.keys(input).some(key => key !== 'email' && key !== 'password') ||
        email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || !validPassword(input.password)) {
      return res.status(422).json({error: {code: 'VALIDATION_ERROR', message: '입력값을 확인해 주세요.'}});
    }

    const [[row]] = await db.execute(
      `SELECT ${userColumns}, password_hash FROM users WHERE email = ?`, [email]);
    // MySQL collation의 악센트 동등 비교를 로그인 이메일 정규화에 포함하지 않는다.
    const account = row?.email === email ? row : undefined;
    const matches = await bcrypt.compare(input.password, account?.password_hash ?? fallbackHash);
    if (!account || !matches) {
      return res.status(401).json({error: {code: 'AUTH_FAILED', message: '이메일 또는 비밀번호를 확인해 주세요.'}});
    }

    const {password_hash: _hash, ...user} = account;
    try {
      await sessionOperation(req, 'regenerate');
      // 신뢰할 수 있는 DB 값에서만 세션을 만들고 로그인 시점에 만료 시각을 고정한다.
      Object.assign(req.session, {userId: user.id, coupleId: user.couple_id, expiresAt: Date.now() + SESSION_DURATION});
      await sessionOperation(req, 'save');
    } catch {
      // 라이브러리가 실패한 요청의 세션을 자동 저장하거나 쿠키로 보내지 않도록 분리한다.
      delete req.session;
      return sessionUnavailable(res);
    }
    issueSessionCookie(req, res);
    res.json({data: {user}});
  }));

  app.get('/api/auth/me', requireSession, asyncRoute(async (req, res) => {
    const [[user]] = await db.execute(`SELECT ${userColumns} FROM users WHERE id = ? AND couple_id = ?`,
      [req.session.userId, req.session.coupleId]);
    if (!user) return authRequired(res);
    res.json({data: {user}});
  }));

  // 만료되거나 쿠키가 없는 요청도 Redis 삭제 성공을 확인한 뒤 쿠키를 제거한다.
  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    try {
      await sessionOperation(req, 'destroy');
    } catch {
      return sessionUnavailable(res);
    }
    clearSessionCookie(res);
    res.status(204).end();
  }));
}

function sessionOperation(req, operation) {
  return new Promise((resolve, reject) => {
    req.session[operation](error => error ? reject(error) : resolve());
  });
}

start('user-api', '/api/auth', registerRoutes).catch(() => {
  console.error('User API startup failed; check dependencies, private configuration and initial accounts');
  process.exit(1);
});
