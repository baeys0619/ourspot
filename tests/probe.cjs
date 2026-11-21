'use strict';
// docker exec로만 실행하는 검증 harness. 운영 API/이미지에는 테스트 라우트를 추가하지 않는다.
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const {connectInfrastructure, requireSession} = require('/app/common/infrastructure.cjs');
(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const infra = await connectInfrastructure();
  let result;
  if (input.action === 'session') {
    const app = express();
    app.use(infra.sessionMiddleware);
    app.get('/create', (req, res, next) => req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = 123;
      req.session.coupleId = 'infra-probe';
      req.session.expiresAt = Date.now() + 86400000;
      req.session.save(error => error ? next(error) : res.json({userId: req.session.userId}));
    }));
    app.get('/read', requireSession, (req, res) => res.json({userId: req.session.userId, coupleId: req.session.coupleId}));
    app.get('/logout', (req, res, next) => req.session.destroy(error => error ? next(error) : res.sendStatus(204)));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${input.route}`, {
      headers: input.cookie ? {cookie: input.cookie} : {},
    });
    result = {status: response.status, body: await response.text(), cookie: response.headers.get('set-cookie')};
    await new Promise(resolve => server.close(resolve));
  } else if (input.action === 'ttl') {
    // 세션 키와 원문 ID는 부모 프로세스에서도 출력하지 않는다.
    const keys = await infra.redis.keys('ourspot:sess:*');
    const ours = [];
    for (const key of keys) {
      const value = JSON.parse(await infra.redis.get(key));
      if (value.coupleId === 'infra-probe') ours.push({key, value});
    }
    assert.equal(ours.length, 1);
    if (input.expire) {
      ours[0].value.expiresAt = Date.now() - 1;
      await infra.redis.set(ours[0].key, JSON.stringify(ours[0].value), {EX: 60});
    }
    result = {ttl: await infra.redis.ttl(ours[0].key)};
  } else if (input.action === 'seed') {
    const db = await infra.db.getConnection();
    try {
      await db.beginTransaction();
      const [u] = await db.execute('INSERT INTO users(email,password_hash,display_name,couple_id) VALUES(?,?,?,?)',
        [`${input.marker}@example.test`, 'infra-test-no-login', '인프라 검증용', input.marker]);
      const [p] = await db.execute('INSERT INTO places(couple_id,added_by,title,category) VALUES(?,?,?,?)',
        [input.marker, u.insertId, '영속성 확인 장소', '카페']);
      const [c] = await db.execute('INSERT INTO place_comments(place_id,user_id,phase,content) VALUES(?,?,?,?)',
        [p.insertId, u.insertId, 'before', '재시작 전후 동일한 코멘트']);
      await db.commit();
      result = {userId: u.insertId, placeId: p.insertId, commentId: c.insertId};
    } catch (error) {await db.rollback(); throw error;} finally {db.release();}
  } else if (input.action === 'snapshot') {
    const [rows] = await infra.db.execute(`SELECT p.id,p.title,p.created_at,p.updated_at,c.id AS comment_id,c.content
      FROM places p JOIN place_comments c ON c.place_id=p.id WHERE p.couple_id=?`, [input.marker]);
    result = rows;
  } else if (input.action === 'cleanup') {
    // 이번 실행이 생성한 고유 marker의 fixture만 제거한다. 기존 행/볼륨은 건드리지 않는다.
    await infra.db.execute('DELETE FROM places WHERE couple_id=?', [input.marker]);
    await infra.db.execute('DELETE FROM users WHERE couple_id=?', [input.marker]);
    result = {cleaned: true};
  } else if (input.action === 'schema') {
    const [tables] = await infra.db.query('SHOW TABLES');
    const [zone] = await infra.db.query('SELECT @@session.time_zone AS timezone');
    const [counts] = await infra.db.query('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM places) AS places, (SELECT COUNT(*) FROM place_comments) AS comments');
    result = {tables, zone, counts};
  } else throw new Error('Unknown test action');
  await infra.close();
  process.stdout.write(JSON.stringify(result));
})().catch(error => {console.error('Infrastructure probe failed:', error.code || error.name, error.message); process.exit(1);});
