'use strict';

const express = require('express');
const {start, asyncRoute} = require('./common/server.cjs');
const {requireSession} = require('./common/infrastructure.cjs');
const {PlaceRequestError, invalid, rejectIdentityFields, requireEmptyQuery, validatePlaceFields,
  requireEmptyBody, validateCommentRequest, requireCommentContent, validDate, requireExpectedTimestamp,
  requirePlaceId, placeNotFound} = require('./validation.cjs');

const base = '/api/places';
const placeColumns = `p.id, p.title, p.category, p.source_url, p.memo, p.planned_date,
  p.visit_order, p.is_visited, p.visited_at, p.created_at, p.updated_at, p.added_by,
  u.display_name AS added_by_name`;
// DB의 현재 시각과 기존 버전에 1ms를 더한 값 중 더 늦은 시각을 쓴다.
// 같은 밀리초에 여러 번 저장해도 버전이 증가한다.
const advanceVersion = 'GREATEST(UTC_TIMESTAMP(3), TIMESTAMPADD(MICROSECOND, 1000, updated_at))';
const commentColumns = 'c.id, c.place_id, c.user_id, u.display_name, c.phase, c.content, c.created_at, c.updated_at';

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
    // 조회 조건의 값은 바인딩하고, 정렬 구문은 아래 고정 선택지에서 고른다. 날짜를 지정하면 등록 시각보다 방문 순서가 우선이다.
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

  // 새 장소는 장소명·분류·링크·메모만 받아 저장한다. 등록자와 커플은 세션에서 가져오고 일정과 방문 상태는 DB의 초기값을 따른다.
  app.post(base, requireSession, json, placeRoute(async (req, res) => {
    rejectIdentityFields(req.body, req.query);
    requireEmptyQuery(req.query);
    const {title, category, source_url = null, memo = null} = validatePlaceFields(req.body, true);
    const {coupleId, userId} = req.session;
    const place = await withCoupleWrite(db, coupleId, async connection => {
      const [result] = await connection.execute(
        'INSERT INTO places (couple_id, added_by, title, category, source_url, memo) VALUES (?, ?, ?, ?, ?, ?)',
        [coupleId, userId, title, category, source_url, memo]);
      // 같은 연결에서 방금 넣은 장소를 다시 읽어 DB 기본값과 최초 버전을 응답에 포함한다.
      return getPlace(connection, coupleId, result.insertId);
    });
    res.status(201).json({data: {place}});
  }));

  // 주소에서 받은 ID를 검사한 뒤 세션 커플 범위 안에서 상세를 조회한다.
  app.get(`${base}/:id`, requireSession, placeRoute(async (req, res) => {
    rejectIdentityFields(req.query);
    requireEmptyQuery(req.query);
    const place = await getPlace(db, req.session.coupleId, requirePlaceId(req.params.id));
    res.json({data: {place}});
  }));

  // 본문과 비교값 형식을 먼저 검사한다. 최신 버전과 일정 상태처럼 테이블을 읽어야 하는 검사는 행을 잠근 뒤 진행한다.
  app.patch(`${base}/:id`, requireSession, json, placeRoute(async (req, res) => {
    rejectIdentityFields(req.body, req.query);
    requireEmptyQuery(req.query);
    const expected = requireExpectedTimestamp(req.body?.expected_updated_at);
    const {planned_date: date, visit_order: order, is_visited: visited, ...changes} = validatePlaceFields(req.body, false);
    const id = requirePlaceId(req.params.id);
    const {coupleId} = req.session;
    const place = await withCoupleWrite(db, coupleId, async connection => {
      const current = await lockPlace(connection, coupleId, id);
      requirePlaceVersion(current, expected);
      // 버전이 맞는 행에서 실제로 달라진 기본 정보만 고른다.
      // 방문 상태도 달라질 때만 바꾸고, 미방문으로 돌아가기 전에는 방문 후 기록을 확인한다.
      const fields = Object.fromEntries(Object.entries(changes).filter(([field, value]) => value !== current[field]));
      if (visited !== undefined && visited !== Boolean(current.is_visited)) {
        if (!visited) await requireNoAfterComments(connection, id);
        fields.is_visited = visited;
      }
      // 대상 장소의 날짜와 순서를 먼저 쓰고, 영향받은 날짜의 나머지 번호도 같은 트랜잭션에서 다시 매긴다.
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
      // 저장된 값을 다시 읽어 새 버전을 반환한다. 이 콜백의 결과는 커밋이 성공한 뒤에만 응답에 사용한다.
      return getPlace(connection, coupleId, id);
    });
    res.json({data: {place}});
  }));

  // 삭제에는 본문 대신 비교값 헤더를 받는다. 버전 확인부터 코멘트 연쇄 삭제와 남은 일정 재정렬까지 한 번에 커밋한다.
  app.delete(`${base}/:id`, requireSession, json, placeRoute(async (req, res) => {
    rejectIdentityFields(req.body, req.query);
    requireEmptyQuery(req.query);
    requireEmptyBody(req, '장소 삭제에는 요청 본문이 필요하지 않아요.');
    const expected = requireExpectedTimestamp(req.get('X-Expected-Updated-At'));
    const id = requirePlaceId(req.params.id);
    const {coupleId} = req.session;
    await withCoupleWrite(db, coupleId, async connection => {
      const current = await lockPlace(connection, coupleId, id);
      requirePlaceVersion(current, expected);
      const remaining = current.planned_date === null ? [] :
        await lockScheduleRows(connection, coupleId, [current.planned_date], id);
      // FK가 코멘트를 함께 삭제한다. 일정에 있던 장소라면 남은 장소의 순서와 버전도 함께 갱신한다.
      await connection.execute('DELETE FROM places WHERE couple_id = ? AND id = ?', [coupleId, id]);
      await reindexDate(connection, coupleId, remaining, id);
    });
    res.status(204).end();
  }));

  const comments = `${base}/:id/comments`;
  app.get(comments, requireSession, json, placeRoute(async (req, res) => {
    validateCommentRequest(req);
    requireEmptyBody(req, '코멘트 조회에는 요청 본문이 필요하지 않아요.');
    const id = requirePlaceId(req.params.id);
    // 장소를 기준으로 외부 조인해 두 사람의 기록을 읽는다.
    // 조회 가능한 장소에 기록만 없으면 빈 배열이고, 세션의 커플 범위에 장소가 없으면 404다.
    const [rows] = await db.execute(
      `SELECT ${commentColumns}
       FROM places AS p
       LEFT JOIN (place_comments AS c JOIN users AS u ON u.id = c.user_id)
         ON c.place_id = p.id AND u.couple_id = p.couple_id
       WHERE p.couple_id = ? AND p.id = ?
       ORDER BY c.phase, c.user_id`, [req.session.coupleId, id]);
    if (rows.length === 0) throw placeNotFound();
    res.json({data: {comments: rows[0].id === null ? [] : rows.map(serializeComment)}});
  }));

  // 경로에서 단계, 세션에서 작성자를 정한다. 같은 장소·작성자·단계의 기록 하나를 새로 쓰거나 수정한다.
  app.put(`${comments}/:phase`, requireSession, json, placeRoute(async (req, res) => {
    const phase = validateCommentRequest(req);
    const content = requireCommentContent(req.body);
    const id = requirePlaceId(req.params.id);
    const {coupleId, userId} = req.session;
    const comment = await withCoupleWrite(db, coupleId, async connection => {
      const place = await lockPlace(connection, coupleId, id);
      requireEditablePhase(place, phase);
      // 같은 장소·작성자·단계의 행이 있다면 수정한다. 기존 내용과 바이트가 다를 때만 그 행의 버전을 올린다.
      await connection.execute(
        `INSERT INTO place_comments (place_id, user_id, phase, content) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           updated_at = IF(CAST(content AS BINARY) <> CAST(? AS BINARY), ${advanceVersion}, updated_at),
           content = ?`, [id, userId, phase, content, content, content]);
      const [[row]] = await connection.execute(
        `SELECT ${commentColumns} FROM place_comments AS c JOIN users AS u ON u.id = c.user_id
         WHERE c.place_id = ? AND c.user_id = ? AND c.phase = ?`, [id, userId, phase]);
      return serializeComment(row);
    });
    res.json({data: {comment}});
  }));

  // 세션 사용자의 코멘트가 있는지 먼저 읽는다. 본인 행이 있을 때만 방문 단계에 따른 삭제 제한을 적용한다.
  app.delete(`${comments}/:phase`, requireSession, json, placeRoute(async (req, res) => {
    const phase = validateCommentRequest(req);
    requireEmptyBody(req, '코멘트 삭제에는 요청 본문이 필요하지 않아요.');
    const id = requirePlaceId(req.params.id);
    const {coupleId, userId} = req.session;
    await withCoupleWrite(db, coupleId, async connection => {
      const place = await lockPlace(connection, coupleId, id);
      const key = [id, userId, phase];
      const [[own]] = await connection.execute(
        'SELECT id FROM place_comments WHERE place_id = ? AND user_id = ? AND phase = ? FOR UPDATE', key);
      // 본인 기록이 없다면 단계가 잠긴 상태에서도 204로 처리하고 상대의 기록은 건드리지 않는다.
      if (!own) return;
      requireEditablePhase(place, phase);
      await connection.execute('DELETE FROM place_comments WHERE id = ?', [own.id]);
    });
    res.status(204).end();
  }));
}

// 상세 조회에서는 연결 풀을, 쓰기 직후에는 작업 중인 연결을 받는다. 둘 다 같은 커플 조건으로 장소를 읽는다.
async function getPlace(connection, coupleId, id) {
  const [[row]] = await connection.execute(
    `SELECT ${placeColumns} FROM places AS p JOIN users AS u ON u.id = p.added_by
     WHERE p.couple_id = ? AND p.id = ?`, [coupleId, id]);
  if (!row) throw placeNotFound();
  return serializePlace(row);
}

// DB의 방문 상태를 JSON 불리언으로 바꾸고 시각 필드만 UTC 형식으로 보낸다. 예정일은 YYYY-MM-DD 그대로 전달한다.
function serializePlace(row) {
  return {...row, is_visited: Boolean(row.is_visited), visited_at: asUtc(row.visited_at),
    created_at: asUtc(row.created_at), updated_at: asUtc(row.updated_at)};
}

function serializeComment(row) {
  return {...row, created_at: asUtc(row.created_at), updated_at: asUtc(row.updated_at)};
}

// 미방문이면 방문 전, 방문 완료면 방문 후 기록만 변경할 수 있다. 조회에는 이 제한을 적용하지 않는다.
function requireEditablePhase(place, phase) {
  if (Boolean(place.is_visited) !== (phase === 'after')) {
    throw new PlaceRequestError(409, 'COMMENT_PHASE_LOCKED', '현재 방문 상태에서는 이 코멘트를 변경할 수 없어요.');
  }
}

// mysql2의 UTC DATETIME 문자열을 정확히 세 자리 밀리초로 표기해 그대로 비교한다.
function asUtc(value) {
  if (value === null) return null;
  const [seconds, fraction = ''] = value.split('.');
  return `${seconds.replace(' ', 'T')}.${fraction.padEnd(3, '0')}Z`;
}

// 장소와 코멘트 쓰기는 모두 같은 커플 잠금부터 시작한다.
// 대상 장소가 서로 다르거나 일정이 비어 있어도 같은 커플의 쓰기는 차례로 처리된다.
async function withCoupleWrite(db, coupleId, write) {
  const connection = await db.getConnection();
  try {
    // 프록시의 응답 제한 전에 DB 잠금 대기 오류를 반환할 수 있게 한다.
    await connection.query('SET SESSION innodb_lock_wait_timeout = 3');
    await connection.beginTransaction();
    // 커플에서 ID가 가장 작은 사용자 행을 공통 잠금 지점으로 쓴다.
    const [[owner]] = await connection.execute(
      'SELECT id FROM users WHERE couple_id = ? ORDER BY id LIMIT 1 FOR UPDATE', [coupleId]);
    if (!owner) throw new Error('Couple write lock is missing');
    const result = await write(connection);
    await connection.commit();
    return result;
  } catch (error) {
    // 일정 일부만 반영되지 않도록 전체 변경을 되돌린다. 롤백에 실패한 연결은 풀에서 재사용하지 않도록 닫는다.
    try {
      await connection.rollback();
    } catch {
      connection.destroy();
    }
    // 교착이나 잠금 대기 시간 초과는 재시도가 가능한 503으로 구분한다. 다른 오류는 공통 오류 처리에 맡긴다.
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
      throw new PlaceRequestError(503, 'WRITE_BUSY', '다른 변경을 처리 중이에요. 잠시 후 다시 시도해 주세요.');
    }
    throw error;
  } finally {
    connection.release();
  }
}

// 커플 잠금을 얻은 뒤 대상 장소를 잠근다. 다른 커플의 장소에는 없는 ID와 같은 404를 돌려준다.
async function lockPlace(connection, coupleId, id) {
  const [[row]] = await connection.execute(
    `SELECT id, title, category, source_url, memo, planned_date, visit_order, is_visited, updated_at
     FROM places WHERE couple_id = ? AND id = ? FOR UPDATE`, [coupleId, id]);
  if (!row) throw placeNotFound();
  return row;
}

// 화면에서 본 밀리초 값과 잠근 행의 최신 값을 비교한다. 다르면 현재 버전을 알려 주고 변경을 중단한다.
function requirePlaceVersion(row, expected) {
  const actual = asUtc(row.updated_at);
  if (expected !== actual) {
    throw new PlaceRequestError(409, 'UPDATE_CONFLICT', '장소가 변경됐어요. 최신 내용을 확인해 주세요.',
      {details: {current_updated_at: actual}});
  }
}

async function requireNoAfterComments(connection, placeId) {
  // 장소를 잠근 뒤 두 사람의 방문 후 기록을 확인한다. 코멘트 쓰기도 같은 순서로 잠그므로 확인과 상태 변경 사이에 기록이 추가될 수 없다.
  const [[comment]] = await connection.execute(
    "SELECT id FROM place_comments WHERE place_id = ? AND phase = 'after' LIMIT 1 FOR UPDATE", [placeId]);
  if (comment) {
    throw new PlaceRequestError(409, 'AFTER_COMMENTS_EXIST', '작성자가 방문 후 기록을 먼저 삭제해야 해요.');
  }
}

// 날짜 필드가 없으면 기존 날짜를 유지하고, null은 일정에서 제외한다.
// 새 날짜 배정이나 이동은 끝에 추가하며, 기존 날짜에서 다른 날짜로 옮길 때만 이동 확인을 받는다.
async function planScheduleChange(connection, coupleId, current, {date, order, confirm}) {
  const originalDate = current.planned_date;
  const targetDate = date === undefined ? originalDate : date;
  const dateChanged = targetDate !== originalDate;
  if (!dateChanged && (order === undefined || order === null)) return null;

  if (dateChanged) {
    if (typeof order === 'number') invalid({visit_order: '날짜 변경 후 방문 순서를 별도로 지정해 주세요.'});
    // 방문 완료 상태에서는 기존 일정을 비우거나 같은 날짜에서 순서를 바꿀 수 있다. 새 날짜에 배정하는 요청만 막는다.
    if (targetDate !== null && current.is_visited) {
      throw new PlaceRequestError(409, 'PLACE_ALREADY_VISITED', '방문한 장소는 새 날짜에 배정할 수 없어요.');
    }
    // 장소 버전을 먼저 검사한 요청만 여기까지 온다. 이동을 확인한 재요청도 이전 버전이면 409에서 멈춘다.
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
    // 대상 행을 뺀 목록의 요청 위치에 다시 끼운다. 표시 번호는 1부터, 배열 위치는 0부터 시작한다.
    source.splice(order - 1, 0, current);
    return {date: targetDate, order, groups: [source]};
  }

  // 빠져나온 날짜와 들어갈 날짜를 모두 재정렬 대상으로 돌려준다. 일정 제외에는 목적 날짜와 방문 순서가 없다.
  const destination = rows.filter(row => row.planned_date === targetDate);
  return {date: targetDate, order: targetDate === null ? null : destination.length + 1,
    groups: [source, destination]};
}

async function lockScheduleRows(connection, coupleId, dates, targetId) {
  // 커플 잠금 이후 첫 일반 읽기로 ID만 구한다. 실제 검증과 정렬에는 각 행을 잠근 뒤 읽은 값을 쓴다.
  // 날짜 인덱스의 방문 순서와 무관하게 두 날짜의 행을 합쳐 PK 오름차순으로 잠근다.
  // 대상 장소는 앞에서 이미 잠갔다. 나머지 날짜 구성원은 방문 완료 여부와 관계없이 잠근다.
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
    // 번호가 그대로인 행도 버전을 올린다. 같은 날짜의 다른 장소를 오래된 화면에서 재정렬할 때도 충돌을 확인할 수 있다.
    if (row.id !== targetId) await updatePlace(connection, coupleId, row.id, {visit_order: index + 1});
  }
}

async function updatePlace(connection, coupleId, id, fields) {
  // 변경할 내용이 없다면 버전과 방문 시각을 그대로 둔다. 일정의 다른 구성원은 재정렬에서 별도로 갱신한다.
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
