"""실제 격리 API와 MySQL의 기존 코멘트로 방문 상태 계약을 검증한다."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier


def verify_visits(http, sql, check, is_error, other_cookie, a_cookie, b_cookie, users):
    base = '/api/places'
    date = '2028-04-01'

    def place(response):
        return response[1]['data']['place']

    def create(title):
        response = http(base, 'POST', a_cookie, {'title': title, 'category': '카페'})
        assert response[0] == 201, 'could not create a visit fixture'
        return place(response)

    def path(row):
        return f'{base}/{row["id"]}'

    def detail(row, cookie=a_cookie):
        return place(http(path(row), cookie=cookie))

    def patch(row, cookie=a_cookie, **fields):
        return http(path(row), 'PATCH', cookie, {'expected_updated_at': row['updated_at'], **fields})

    def listing(cookie, filters=''):
        response = http(f'{base}?planned_date={date}{filters}', cookie=cookie)
        assert response[0] == 200, 'could not read the visit fixture schedule'
        return response[1]['data']

    def conflict(response, latest):
        return (is_error(response, 409, 'UPDATE_CONFLICT') and
                response[1]['error']['details'] == {'current_updated_at': latest['updated_at']})

    def add_comment(user_id, phase, content):
        # 코멘트 API 없이 격리된 기존 테이블에 테스트 기록만 준비한다.
        sql(f"INSERT INTO place_comments (place_id, user_id, phase, content) "
            f"VALUES ({target['id']}, {user_id}, '{phase}', '{content}')")

    def comments():
        return sql(f"SELECT id, user_id, phase, content, created_at, updated_at FROM place_comments "
                   f"WHERE place_id = {target['id']} ORDER BY id")

    def db_time():
        return sql('SELECT UTC_TIMESTAMP(3)').replace(' ', 'T') + 'Z'

    sibling = place(patch(create('같은 날의 다른 장소'), planned_date=date))
    target = place(patch(create('방문 상태 검증'), planned_date=date))
    # DB 현재 시각이 이전 버전보다 작아도 실제 수정 한 번당 정확히 1ms 전진해야 한다.
    sql(f"UPDATE places SET updated_at = '2099-04-01 00:00:00.000' WHERE id = {target['id']}")
    target, sibling = detail(target), detail(sibling)
    a_id, b_id = (user['id'] for user in users)
    add_comment(a_id, 'before', 'A visit expectation')
    add_comment(b_id, 'before', 'B visit expectation')
    before = comments()
    original_counts = listing(a_cookie)['counts']

    check('visit requests reject invalid values, combined schedule fields and client-supplied timestamps', all(
        is_error(patch(target, **fields), 422, 'VALIDATION_ERROR') for fields in (
            *({'is_visited': value} for value in (1, 0, 'true', None, [])),
            {'is_visited': True, 'planned_date': date}, {'is_visited': True, 'visit_order': 2},
            {'is_visited': True, 'visited_at': None}, {'is_visited': True, 'updated_at': target['updated_at']},
            {'is_visited': True, 'expected_updated_at': 'invalid'},
        )) and is_error(http(path(target), 'PATCH', a_cookie, {'is_visited': True}), 422, 'VALIDATION_ERROR') and
        is_error(http(base, 'POST', a_cookie, {'title': '신규 장소', 'category': '카페', 'is_visited': True}),
                 422, 'VALIDATION_ERROR') and detail(target) == target)
    check('visit requests reject forged identity fields and isolate other couples', all(
        is_error(patch(target, is_visited=True, **{field: b_id}), 403, 'FORBIDDEN')
        for field in ('user_id', 'coupleId', 'added_by', 'id', 'comment_id')) and
        is_error(http(path(target) + '?couple_id=couple_001', 'PATCH', other_cookie,
                      {'is_visited': True, 'expected_updated_at': target['updated_at']}), 403, 'FORBIDDEN') and
        is_error(patch(target, other_cookie, is_visited=True), 404, 'NOT_FOUND') and detail(target) == target)
    check('already-unvisited patch preserves timestamp and version',
          patch(target, b_cookie, is_visited=False)[:2] == (200, {'data': {'place': target}}))

    started = db_time()
    response = patch(target, b_cookie, is_visited=True, memo='완료와 함께 수정')
    check('visit completion returns HTTP 200', response[0] == 200)
    visited = place(response)
    check('completion uses DB UTC milliseconds and updates the visit and general fields together exactly once',
          started <= visited['visited_at'] <= db_time() and len(visited['visited_at']) == 24 and
          visited == {**target, 'is_visited': True, 'visited_at': visited['visited_at'],
                      'updated_at': '2099-04-01T00:00:00.001Z', 'memo': '완료와 함께 수정'})
    check('A and B see the same completed place, unchanged schedule order, status filters and counts',
          detail(target) == detail(target, b_cookie) == visited and
          all(listing(cookie)['places'] == [sibling, visited] for cookie in (a_cookie, b_cookie)) and
          listing(a_cookie, '&status=unvisited') == {'places': [sibling], 'counts': {
              'unvisited': original_counts['unvisited'] - 1, 'visited': original_counts['visited'] + 1}} and
          listing(b_cookie, '&status=visited')['places'] == [visited] and comments() == before)
    check('same-status completion preserves visit time and version, while a stale no-op conflicts',
          patch(visited, is_visited=True)[:2] == (200, {'data': {'place': visited}}) and
          conflict(patch(target, is_visited=True), visited))

    add_comment(b_id, 'after', 'B visit review')
    for author, cookie in ((b_id, a_cookie), (a_id, b_cookie)):
        if author == a_id:
            add_comment(a_id, 'after', 'A visit review')
        all_comments = comments()
        response = patch(visited, cookie, is_visited=False, memo='저장되면 안 되는 메모')
        check(f'one existing After ({"A" if author == a_id else "B"}) blocks the whole revert',
              is_error(response, 409, 'AFTER_COMMENTS_EXIST') and detail(target) == visited and
              comments() == all_comments and conflict(patch(target, cookie, is_visited=False), visited))
        sql(f"DELETE FROM place_comments WHERE place_id = {target['id']} AND user_id = {author} AND phase = 'after'")

    response = patch(visited, is_visited=False)
    check('revert clears visit time, advances the version and preserves Before records and schedule',
          response[:2] == (200, {'data': {'place': {**visited, 'is_visited': False, 'visited_at': None,
                                                   'updated_at': '2099-04-01T00:00:00.002Z'}}}) and
          listing(b_cookie, '&status=unvisited') == {'places': [sibling, place(response)], 'counts': original_counts} and
          detail(target, b_cookie) == place(response) and comments() == before)

    reverted = place(response)
    ready = Barrier(2, timeout=5)

    def complete(cookie):
        ready.wait()
        return patch(reverted, cookie, is_visited=True)

    with ThreadPoolExecutor(max_workers=2) as workers:
        first, second = sorted(workers.map(complete, (a_cookie, b_cookie)), key=lambda result: result[0])
    check('concurrent A/B completion has one winner and one conflict with the new version',
          first[0] == 200 and place(first)['updated_at'] == '2099-04-01T00:00:00.003Z' and
          place(first)['is_visited'] is True and place(first)['visited_at'] is not None and
          conflict(second, place(first)) and detail(target, b_cookie) == place(first))
