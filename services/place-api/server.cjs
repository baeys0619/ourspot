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
    const {planned_date: date, visit_order: order, is_visited: visited, ...changes} = validatePlaceFields(req.body, false);
    const id = requirePlaceId(req.params.id);
    const {coupleId} = req.session;
    const place = await withCoupleWrite(db, coupleId, async connection => {
      const current = await lockPlace(connection, coupleId, id, expected);
      const fields = Object.fromEntries(Object.entries(changes).filter(([field, value]) => value !== current[field]));
      if (visited !== undefined && visited !== Boolean(current.is_visited)) {
        if (!visited) await requireNoAfterComments(connection, id);
        fields.is_visited = visited;
      }
      const schedule = await planScheduleChange(connection, coupleId, current, {date, order, confirm: req.body.confirm_move});
      if (schedule) {
        fields.planned_date = schedule.date;
        fields.visit_order = schedule.order;
      }
      // 기본 정보와 일정 또는 상태가 함께 바뀌어도 대상 장소의 버전은 한 번만 증가시킨다.
      await updatePlace(connection, coupleId, id, fields);
      if (schedule) {
        for (const group of schedule.groups) await reindexDate(connection, coupleId, group, id);
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
        await lockScheduleRows(connection, coupleId, [current.planned_date], id);
      // FK가 코멘트를 함께 삭제한다. 일정에 있던 장소라면 남은 장소의 순서와 버전도 함께 갱신한다.
      await connection.execute('DELETE FROM places WHERE couple_id = ? AND id = ?', [coupleId, id]);
      await reindexDate(connection, coupleId, remaining, id);
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
    `SELECT id, title, category, source_url, memo, planned_date, visit_order, is_visited, updated_at
     FROM places WHERE couple_id = ? AND id = ? FOR UPDATE`, [coupleId, id]);
  if (!row) throw placeNotFound();
  const actual = asUtc(row.updated_at);
  if (expected !== actual) {
    throw new PlaceRequestError(409, 'UPDATE_CONFLICT', '장소가 변경됐어요. 최신 내용을 확인해 주세요.',
      {details: {current_updated_at: actual}});
  }
  return row;
}

async function requireNoAfterComments(connection, placeId) {
  // 커플과 부모 장소를 잠근 뒤 최신 After 기록을 확인한다. 코멘트 쓰기도 같은 잠금 순서를 따른다.
  const [[comment]] = await connection.execute(
    "SELECT id FROM place_comments WHERE place_id = ? AND phase = 'after' LIMIT 1 FOR UPDATE", [placeId]);
  if (comment) {
    throw new PlaceRequestError(409, 'AFTER_COMMENTS_EXIST', '작성자가 방문 후 기록을 먼저 삭제해야 해요.');
  }
}

async function planScheduleChange(connection, coupleId, current, {date, order, confirm}) {
  const originalDate = current.planned_date;
  const targetDate = date === undefined ? originalDate : date;
  const dateChanged = targetDate !== originalDate;
  if (!dateChanged && (order === undefined || order === null)) return null;

  if (dateChanged) {
    if (typeof order === 'number') invalid({visit_order: '날짜 변경 후 방문 순서를 별도로 지정해 주세요.'});
    if (targetDate !== null && current.is_visited) {
      throw new PlaceRequestError(409, 'PLACE_ALREADY_VISITED', '방문한 장소는 새 날짜에 배정할 수 없어요.');
    }
    if (targetDate !== null && originalDate !== null && confirm !== true) {
      throw new PlaceRequestError(409, 'DATE_CONFLICT', '다른 날짜로 이동할까요?', {details: {
        current_planned_date: originalDate, requested_planned_date: targetDate,
        current_updated_at: asUtc(current.updated_at),
      }});
    }
  } else if (targetDate === null) {
    invalid({visit_order: '날짜를 지정한 장소만 방문 순서를 바꿀 수 있어요.'});
  }

  const dates = [...new Set([originalDate, targetDate].filter(value => value !== null))];
  const rows = await lockScheduleRows(connection, coupleId, dates, current.id);
  const source = rows.filter(row => row.planned_date === originalDate);
  if (!dateChanged) {
    if (order > source.length + 1) invalid({visit_order: '해당 날짜의 방문 순서 범위를 확인해 주세요.'});
    if (order === current.visit_order) return null;
    source.splice(order - 1, 0, current);
    return {date: targetDate, order, groups: [source]};
  }

  const destination = rows.filter(row => row.planned_date === targetDate);
  return {date: targetDate, order: targetDate === null ? null : destination.length + 1,
    groups: [source, destination]};
}

async function lockScheduleRows(connection, coupleId, dates, targetId) {
  // 커플 잠금 이후 첫 일반 읽기로 ID만 구한다. 실제 검증과 정렬에는 각 행을 잠근 뒤 읽은 값을 쓴다.
  // 날짜 인덱스의 방문 순서와 무관하게 두 날짜의 행을 합쳐 PK 오름차순으로 잠근다.
  const placeholders = dates.map(() => '?').join(', ');
  const [candidates] = await connection.execute(
    `SELECT id FROM places WHERE couple_id = ? AND planned_date IN (${placeholders}) AND id <> ? ORDER BY id`,
    [coupleId, ...dates, targetId]);
  const rows = [];
  for (const {id} of candidates) {
    const [[row]] = await connection.execute(
      'SELECT id, planned_date, visit_order FROM places WHERE id = ? AND couple_id = ? FOR UPDATE',
      [id, coupleId]);
    if (!row || !dates.includes(row.planned_date)) throw new Error('Schedule changed outside the couple lock');
    rows.push(row);
  }
  return rows.sort((a, b) => a.visit_order - b.visit_order || a.id - b.id);
}

async function reindexDate(connection, coupleId, rows, targetId) {
  for (const [index, row] of rows.entries()) {
    // 순서가 그대로인 행도 날짜 구성 변경을 알 수 있도록 버전을 갱신한다.
    if (row.id !== targetId) await updatePlace(connection, coupleId, row.id, {visit_order: index + 1});
  }
}

async function updatePlace(connection, coupleId, id, fields) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  // 컬럼은 검증한 필드와 서버가 계산한 일정 필드로 제한하고, 값은 바인딩한다.
  const assignments = entries.map(([column]) => `${column} = ?`);
  // 실제 상태 전환 때만 DB UTC 시각을 저장하거나 지운다. 버전과 시간은 같은 UPDATE에서 갱신한다.
  if (Object.hasOwn(fields, 'is_visited')) {
    assignments.push(fields.is_visited ? 'visited_at = UTC_TIMESTAMP(3)' : 'visited_at = NULL');
  }
  await connection.execute(
    `UPDATE places SET ${assignments.join(', ')}, updated_at = ${advanceVersion} WHERE couple_id = ? AND id = ?`,
    [...entries.map(([, value]) => value), coupleId, id]);
}

start('place-api', base, registerRoutes).catch(() => {
  console.error('Place API startup failed; check dependencies, private configuration and initial accounts');
  process.exit(1);
});
