'use strict';

const express = require('express');
const {start, asyncRoute} = require('./common/server.cjs');
const {requireSession} = require('./common/infrastructure.cjs');
const {PlaceRequestError, invalid, rejectIdentityFields, requireEmptyQuery, validatePlaceFields,
  validDate, requireExpectedTimestamp, requirePlaceId, placeNotFound} = require('./validation.cjs');

const base = '/api/places';
const placeColumns = `p.id, p.title, p.category, p.source_url, p.memo, p.planned_date,
  p.visit_order, p.is_visited, p.visited_at, p.created_at, p.updated_at, p.added_by,
  u.display_name AS added_by_name`;
const advanceVersion = 'GREATEST(UTC_TIMESTAMP(3), TIMESTAMPADD(MICROSECOND, 1000, updated_at))';

// 앱 오류만 계약의 JSON으로 반환한다. JSON 파싱과 예상 밖 DB 오류는 공통 핸들러가 처리한다.
const placeRoute = handler => asyncRoute(async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (!(error instanceof PlaceRequestError)) throw error;
    res.status(error.status).json(error.body);
  }
});

function registerRoutes(app, {db}) {
  // 인증을 먼저 확인하고 유효한 JSON 스칼라는 입력 검증 단계에서 거절한다.
  const json = express.json({limit: '32kb', strict: false});

  // User API를 경유하지 않고 공유 Redis 세션에서 얻은 커플의 장소만 조회한다.
  app.get(base, requireSession, placeRoute(async (req, res) => {
    rejectIdentityFields(req.query);
    const {status, planned_date: date, sort} = req.query;
    const unknownField = Object.keys(req.query).some(key => !['status', 'planned_date', 'sort'].includes(key));
    if (unknownField || (status !== undefined && !['unvisited', 'visited'].includes(status)) ||
        (date !== undefined && !validDate(date)) || (sort !== undefined && sort !== 'oldest')) {
      return res.status(422).json({error: {code: 'VALIDATION_ERROR', message: '조회 조건을 확인해 주세요.'}});
    }

    const {coupleId} = req.session;
    const conditions = ['p.couple_id = ?'];
    const params = [coupleId];
    if (status !== undefined) {
      conditions.push('p.is_visited = ?');
      params.push(status === 'visited');
    }
    if (date !== undefined) {
      conditions.push('p.planned_date = ?');
      params.push(date);
    }
    let order = 'p.created_at DESC, p.id DESC';
    if (date !== undefined) order = 'p.visit_order ASC, p.id ASC';
    else if (sort === 'oldest') order = 'p.created_at ASC, p.id ASC';

    const connection = await db.getConnection();
    try {
      // 필터가 적용된 목록과 커플 전체 집계가 같은 스냅샷을 사용하도록 읽기 트랜잭션으로 묶는다.
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const [rows] = await connection.execute(
        `SELECT ${placeColumns}
         FROM places AS p JOIN users AS u ON u.id = p.added_by
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${order}`, params);
      const [[counts]] = await connection.execute(
        `SELECT COUNT(CASE WHEN is_visited = FALSE THEN 1 END) AS unvisited,
                COUNT(CASE WHEN is_visited = TRUE THEN 1 END) AS visited
         FROM places WHERE couple_id = ?`, [coupleId]);
      await connection.commit();

      const places = rows.map(serializePlace);
      res.json({data: {places, counts}});
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }));

  app.post(base, requireSession, json, placeRoute(async (req, res) => {
    rejectIdentityFields(req.body, req.query);
    requireEmptyQuery(req.query);
    const {title, category, source_url = null, memo = null} = validatePlaceFields(req.body, true);
    const {coupleId, userId} = req.session;
    const place = await withCoupleWrite(db, coupleId, async connection => {
      const [result] = await connection.execute(
        'INSERT INTO places (couple_id, added_by, title, category, source_url, memo) VALUES (?, ?, ?, ?, ?, ?)',
        [coupleId, userId, title, category, source_url, memo]);
      return getPlace(connection, coupleId, result.insertId);
    });
    res.status(201).json({data: {place}});
  }));

  app.get(`${base}/:id`, requireSession, placeRoute(async (req, res) => {
    rejectIdentityFields(req.query);
    requireEmptyQuery(req.query);
    const place = await getPlace(db, req.session.coupleId, requirePlaceId(req.params.id));
    res.json({data: {place}});
  }));

  app.patch(`${base}/:id`, requireSession, json, placeRoute(async (req, res) => {
    rejectIdentityFields(req.body, req.query);
    requireEmptyQuery(req.query);
    const expected = requireExpectedTimestamp(req.body?.expected_updated_at);
    const changes = validatePlaceFields(req.body, false);
    const id = requirePlaceId(req.params.id);
    const {coupleId} = req.session;
    const place = await withCoupleWrite(db, coupleId, async connection => {
      const current = await lockPlace(connection, coupleId, id, expected);
      // 필드 이름은 검증된 네 가지 컬럼에서만 가져오고 값은 바인딩한다.
      const fields = Object.keys(changes).filter(field => changes[field] !== current[field]);
      if (fields.length > 0) {
        const assignments = fields.map(field => `${field} = ?`).join(', ');
        await connection.execute(
          `UPDATE places SET ${assignments}, updated_at = ${advanceVersion} WHERE couple_id = ? AND id = ?`,
          [...fields.map(field => changes[field]), coupleId, id]);
      }
      return getPlace(connection, coupleId, id);
    });
    res.json({data: {place}});
  }));

  app.delete(`${base}/:id`, requireSession, json, placeRoute(async (req, res) => {
    rejectIdentityFields(req.body, req.query);
    requireEmptyQuery(req.query);
    if (Number(req.get('Content-Length')) > 0 || req.get('Transfer-Encoding') !== undefined) {
      invalid({body: '장소 삭제에는 요청 본문이 필요하지 않아요.'});
    }
    const expected = requireExpectedTimestamp(req.get('X-Expected-Updated-At'));
    const id = requirePlaceId(req.params.id);
    const {coupleId} = req.session;
    await withCoupleWrite(db, coupleId, async connection => {
      const current = await lockPlace(connection, coupleId, id, expected);
      const remaining = current.planned_date === null ? [] :
        await lockDate(connection, coupleId, current.planned_date, id);
      // FK가 코멘트를 함께 삭제한다. 일정에 있던 장소라면 남은 장소의 순서와 버전도 함께 갱신한다.
      await connection.execute('DELETE FROM places WHERE couple_id = ? AND id = ?', [coupleId, id]);
      for (const [index, place] of remaining.entries()) {
        await connection.execute(
          `UPDATE places SET visit_order = ?, updated_at = ${advanceVersion} WHERE couple_id = ? AND id = ?`,
          [index + 1, coupleId, place.id]);
      }
    });
    res.status(204).end();
  }));
}

async function getPlace(connection, coupleId, id) {
  const [[row]] = await connection.execute(
    `SELECT ${placeColumns} FROM places AS p JOIN users AS u ON u.id = p.added_by
     WHERE p.couple_id = ? AND p.id = ?`, [coupleId, id]);
  if (!row) throw placeNotFound();
  return serializePlace(row);
}

function serializePlace(row) {
  return {...row, is_visited: Boolean(row.is_visited), visited_at: asUtc(row.visited_at),
    created_at: asUtc(row.created_at), updated_at: asUtc(row.updated_at)};
}

// mysql2의 UTC DATETIME 문자열을 정확히 세 자리 밀리초로 표기해 그대로 비교한다.
function asUtc(value) {
  if (value === null) return null;
  const [seconds, fraction = ''] = value.split('.');
  return `${seconds.replace(' ', 'T')}.${fraction.padEnd(3, '0')}Z`;
}

async function withCoupleWrite(db, coupleId, write) {
  const connection = await db.getConnection();
  try {
    // 프록시의 응답 제한 전에 DB 잠금 대기 오류를 반환할 수 있게 한다.
    await connection.query('SET SESSION innodb_lock_wait_timeout = 3');
    await connection.beginTransaction();
    // 모든 장소 쓰기가 커플의 최소 사용자 ID 행부터 잠가 빈 일정에서도 쓰기를 직렬화한다.
    const [[owner]] = await connection.execute(
      'SELECT id FROM users WHERE couple_id = ? ORDER BY id LIMIT 1 FOR UPDATE', [coupleId]);
    if (!owner) throw new Error('Couple write lock is missing');
    const result = await write(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      connection.destroy();
    }
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
      throw new PlaceRequestError(503, 'WRITE_BUSY', '다른 변경을 처리 중이에요. 잠시 후 다시 시도해 주세요.');
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function lockPlace(connection, coupleId, id, expected) {
  const [[row]] = await connection.execute(
    `SELECT title, category, source_url, memo, planned_date, updated_at
     FROM places WHERE couple_id = ? AND id = ? FOR UPDATE`, [coupleId, id]);
  if (!row) throw placeNotFound();
  const actual = asUtc(row.updated_at);
  if (expected !== actual) {
    throw new PlaceRequestError(409, 'UPDATE_CONFLICT', '장소가 변경됐어요. 최신 내용을 확인해 주세요.',
      {details: {current_updated_at: actual}});
  }
  return row;
}

async function lockDate(connection, coupleId, date, deletedId) {
  const [rows] = await connection.execute(
    `SELECT id, visit_order FROM places WHERE couple_id = ? AND planned_date = ? AND id <> ?
     ORDER BY id FOR UPDATE`, [coupleId, date, deletedId]);
  return rows.sort((a, b) => a.visit_order - b.visit_order || a.id - b.id);
}

start('place-api', base, registerRoutes).catch(() => {
  console.error('Place API startup failed; check dependencies, private configuration and initial accounts');
  process.exit(1);
});
