'use strict';

const {start, asyncRoute} = require('./common/server.cjs');
const {requireSession} = require('./common/infrastructure.cjs');

function registerRoutes(app, {db}) {
  // User API를 경유하지 않고 공유 Redis 세션에서 얻은 커플의 장소만 조회한다.
  app.get('/api/places', requireSession, asyncRoute(async (req, res) => {
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
        `SELECT p.id, p.title, p.category, p.source_url, p.memo, p.planned_date,
                p.visit_order, p.is_visited, p.visited_at, p.created_at, p.updated_at,
                p.added_by, u.display_name AS added_by_name
         FROM places AS p JOIN users AS u ON u.id = p.added_by
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${order}`, params);
      const [[counts]] = await connection.execute(
        `SELECT COUNT(CASE WHEN is_visited = FALSE THEN 1 END) AS unvisited,
                COUNT(CASE WHEN is_visited = TRUE THEN 1 END) AS visited
         FROM places WHERE couple_id = ?`, [coupleId]);
      await connection.commit();

      const places = rows.map(row => ({
        ...row, is_visited: Boolean(row.is_visited), visited_at: asUtc(row.visited_at),
        created_at: asUtc(row.created_at), updated_at: asUtc(row.updated_at),
      }));
      res.json({data: {places, counts}});
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }));
}

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// mysql2가 dateStrings로 반환한 UTC DATETIME(3)을 밀리초까지 보존한다.
const asUtc = value => value === null ? null : new Date(value.replace(' ', 'T') + 'Z').toISOString();

start('place-api', '/api/places', registerRoutes).catch(() => {
  console.error('Place API startup failed; check dependencies, private configuration and initial accounts');
  process.exit(1);
});
