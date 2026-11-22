'use strict';

const {randomBytes} = require('node:crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const {start, asyncRoute} = require('./common/server.cjs');
const {requireSession, authRequired, sessionUnavailable, clearSessionCookie,
  SESSION_DURATION} = require('./common/infrastructure.cjs');
const {BCRYPT_COST, validPassword} = require('./common/accounts.cjs');

// 로그인 성공과 사용자 조회에서 공개할 필드다. 비밀번호 해시는 인증 쿼리에서만 별도로 읽는다.
const userColumns = 'id, email, display_name, couple_id';
const identityFields = ['id', 'userId', 'user_id', 'coupleId', 'couple_id', 'added_by'];

async function registerRoutes(app, {db, issueSessionCookie}) {
  // 존재하지 않는 이메일도 bcrypt 비교를 거쳐 두 실패 경로의 비용을 비슷하게 유지한다.
  const fallbackHash = await bcrypt.hash(randomBytes(32), BCRYPT_COST);
  app.post('/api/auth/login', express.json({limit: '8kb', strict: false}), asyncRoute(async (req, res) => {
    // 보안 쿠키로 설정한 설치에서는 HTTPS 요청만 로그인에 사용한다.
    if (process.env.COOKIE_SECURE === 'true' && !req.secure) {
      return res.status(400).json({error: {code: 'BAD_REQUEST', message: 'HTTPS 연결이 필요해요.'}});
    }
    // 본문에는 이메일과 비밀번호만 받는다. 사용자나 커플을 지정하는 필드는 일반 입력 오류와 구분해 403으로 거부한다.
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

    // 계정 조회는 바인딩한 이메일로 하고, 해시는 이 요청의 비밀번호 비교에만 쓴다. 계정 유무와 비밀번호 불일치는 같은 401로 응답한다.
    const [[row]] = await db.execute(
      `SELECT ${userColumns}, password_hash FROM users WHERE email = ?`, [email]);
    // MySQL의 문자열 비교가 악센트 차이를 무시할 수 있다. 조회된 이메일이 정리한 입력과 정확히 일치해야 인증을 진행한다.
    const account = row?.email === email ? row : undefined;
    const matches = await bcrypt.compare(input.password, account?.password_hash ?? fallbackHash);
    if (!account || !matches) {
      return res.status(401).json({error: {code: 'AUTH_FAILED', message: '이메일 또는 비밀번호를 확인해 주세요.'}});
    }

    // 응답에 해시를 싣지 않는다. 인증에 성공하면 세션을 재생성해 로그인 전의 ID가 계속 쓰이지 않게 한다.
    const {password_hash: _hash, ...user} = account;
    try {
      await sessionOperation(req, 'regenerate');
      // 신뢰할 수 있는 DB 값에서만 세션을 만들고 로그인 시점에 만료 시각을 고정한다.
      Object.assign(req.session, {userId: user.id, coupleId: user.couple_id, expiresAt: Date.now() + SESSION_DURATION});
      // 응답 직후 Place API가 같은 ID로 조회할 수 있도록 Redis 저장 콜백이 끝날 때까지 기다린다.
      await sessionOperation(req, 'save');
    } catch {
      // 라이브러리가 실패한 요청의 세션을 자동 저장하거나 쿠키로 보내지 않도록 분리한다.
      delete req.session;
      return sessionUnavailable(res);
    }
    issueSessionCookie(req, res);
    res.json({data: {user}});
  }));

  // 세션의 사용자와 커플이 DB에 여전히 일치하는지 확인하고, 공개할 사용자 필드만 돌려준다.
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
    // 삭제가 실패하면 위에서 503을 반환하므로 브라우저 쿠키는 여기서 만료시키지 않는다.
    clearSessionCookie(res);
    res.status(204).end();
  }));
}

// Express 세션 작업은 콜백으로 성공 여부를 알린다. Promise로 감싸 저장·삭제 실패를 응답 전에 처리한다.
function sessionOperation(req, operation) {
  return new Promise((resolve, reject) => {
    req.session[operation](error => error ? reject(error) : resolve());
  });
}

// 공통 초기화나 라우트 등록이 실패하면 접속 상세를 출력하지 않고 종료한다.
start('user-api', '/api/auth', registerRoutes).catch(() => {
  console.error('User API startup failed; check dependencies, private configuration and initial accounts');
  process.exit(1);
});
