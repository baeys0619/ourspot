"""격리된 Place API와 MySQL에서 코멘트와 방문 상태 계약을 검증한다."""
from concurrent.futures import ThreadPoolExecutor
import re
from threading import Barrier


def verify_comments(http, sql, check, is_error, other_cookie, a_cookie, b_cookie, users):
    base = '/api/places'
    a_id, b_id = (user['id'] for user in users)
    timestamp = r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z'

    def create(title):
        response = http(base, 'POST', a_cookie, {'title': title, 'category': '카페'})
        assert response[0] == 201, 'could not create a comment fixture'
        return response[1]['data']['place']

    def path(place):
        return f'{base}/{place["id"]}'

    def comments_path(place):
        return path(place) + '/comments'

    def listing(place, cookie=a_cookie):
        response = http(comments_path(place), cookie=cookie)
        assert response[0] == 200, 'could not read comments'
        return response[1]['data']['comments']

    def put(place, phase, cookie, content):
        return http(f'{comments_path(place)}/{phase}', 'PUT', cookie, {'content': content})

    def delete(place, phase, cookie):
        return http(f'{comments_path(place)}/{phase}', 'DELETE', cookie)

    def comment(response):
        assert response[0] == 200, 'could not save a comment'
        return response[1]['data']['comment']

    def patch_visit(place, visited, cookie=b_cookie):
        return http(path(place), 'PATCH', cookie, {
            'is_visited': visited, 'expected_updated_at': place['updated_at'],
        })

    def parallel(first, second):
        ready = Barrier(2, timeout=5)

        def request(call):
            ready.wait()
            return call()

        with ThreadPoolExecutor(max_workers=2) as workers:
            return list(workers.map(request, (first, second)))

    target = create('코멘트 계약 검증')
    endpoint = comments_path(target)
    before_path = endpoint + '/before'
    no_content = (204, None, None)
    check('comment methods require a session before validating input', all(
        is_error(http(url, method, payload=b'{'), 401, 'AUTH_REQUIRED')
        for url, method in ((endpoint, 'GET'), (before_path, 'PUT'), (before_path, 'DELETE'))))
    check('an accessible place without records returns an empty comment array',
          http(endpoint, cookie=a_cookie) == (200, {'data': {'comments': []}}, None))
    check('other couples cannot read, create or delete comments', all(
        is_error(response, 404, 'NOT_FOUND') for response in (
            http(endpoint, cookie=other_cookie), put(target, 'before', other_cookie, '차단'),
            delete(target, 'before', other_cookie))))
    check('invalid and missing parent IDs are 404 for every supported comment method', all(
        is_error(http(f'{base}/{id_}/comments{suffix}', method, a_cookie, payload), 404, 'NOT_FOUND')
        for id_ in ('0', 'x', '2147483647', '2147483648')
        for method, suffix, payload in (('GET', '', None), ('PUT', '/before', {'content': '기록'}),
                                        ('DELETE', '/before', None))))
    check('unsupported phase and query fields return 422', all(
        is_error(response, 422, 'VALIDATION_ERROR') for response in (
            put(target, 'Before', a_cookie, '기록'), delete(target, 'during', a_cookie),
            http(endpoint + '?phase=before', cookie=a_cookie),
            http(before_path + '?extra=1', 'PUT', a_cookie, {'content': '기록'}),
            http(before_path + '?extra=1', 'DELETE', a_cookie))))
    check('invalid JSON, invalid content and unsupported body fields are rejected', all(
        is_error(http(before_path, 'PUT', a_cookie, body), status, code)
        for status, code, body in (
            (400, 'BAD_REQUEST', b'{'),
            *((422, 'VALIDATION_ERROR', body) for body in (
                None, b'null', [], 'text', {}, {'content': 1}, {'content': '  \n '},
                {'content': '🌿' * 1001}, {'content': '\ud800'},
                {'content': '기록', 'extra': 1}, {'content': '기록', 'expected_updated_at': target['updated_at']},
            )),
        )) and is_error(http(before_path, 'DELETE', a_cookie, {}), 422, 'VALIDATION_ERROR') and listing(target) == [])
    check('unvisited place rejects After PUT and missing own After DELETE stays idempotent',
          is_error(put(target, 'after', a_cookie, '기록'), 409, 'COMMENT_PHASE_LOCKED') and
          delete(target, 'after', a_cookie) == no_content and listing(target) == [])

    before_b = comment(put(target, 'before', b_cookie, '  B의 기대  '))
    check('deleting absent own Before preserves the partner record',
          delete(target, 'before', a_cookie) == no_content and listing(target) == [before_b])
    before_a = comment(put(target, 'before', a_cookie, 'cafe'))
    check('A and B see both Before authors and the contracted fields with UTC milliseconds',
          listing(target) == listing(target, b_cookie) == [before_a, before_b] and
          all(set(row) == {'id', 'place_id', 'user_id', 'display_name', 'phase', 'content', 'created_at', 'updated_at'} and
              row['place_id'] == target['id'] and row['user_id'] == user['id'] and
              row['display_name'] == user['display_name'] and row['phase'] == 'before' and
              re.fullmatch(timestamp, row['created_at']) and row['updated_at'] == row['created_at']
              for row, user in zip((before_a, before_b), users)) and before_b['content'] == 'B의 기대')
    forged = {'userId': b_id, 'user_id': b_id, 'coupleId': 'couple_001', 'couple_id': 'couple_001',
              'added_by': b_id, 'comment_id': before_b['id'], 'id': before_b['id'], 'place_id': target['id']}
    check('partner identity and target overrides in body or query return 403 without changing records', all(
        is_error(response, 403, 'FORBIDDEN') for field, value in forged.items() for response in (
            http(before_path, 'PUT', a_cookie, {'content': '위조', field: value}),
            http(before_path, 'DELETE', a_cookie, {field: value}),
            http(f'{before_path}?{field}={value}', 'DELETE', a_cookie),
            http(f'{endpoint}?{field}={value}', cookie=a_cookie),
        )) and listing(target) == [before_a, before_b])

    accented = comment(put(target, 'before', a_cookie, '  café  '))
    check('upsert changes content and update time while preserving the original ID and creation time',
          accented == {**before_a, 'content': 'café', 'updated_at': accented['updated_at']} and
          accented['updated_at'] > before_a['updated_at'] and
          comment(put(target, 'before', a_cookie, 'café')) == accented)
    before_a = comment(put(target, 'before', a_cookie, '🌿' * 1000))
    check('1000 Unicode characters round trip in one row and the parent version stays unchanged',
          before_a['content'] == '🌿' * 1000 and before_a['id'] == accented['id'] and
          listing(target) == [before_a, before_b] and http(path(target), cookie=b_cookie)[1]['data']['place'] == target)
    check('only the Before author can delete and repeated DELETE returns 204',
          delete(target, 'before', b_cookie) == delete(target, 'before', b_cookie) == no_content and
          listing(target) == [before_a])
    visited_response = patch_visit(target, True)
    check('visit completion sees the original parent version and preserves Before', visited_response[0] == 200)
    visited = visited_response[1]['data']['place']
    check('visited Before is read-only, including DELETE, with 204 for an absent own record',
          is_error(put(target, 'before', a_cookie, '차단'), 409, 'COMMENT_PHASE_LOCKED') and
          is_error(put(target, 'before', b_cookie, '차단'), 409, 'COMMENT_PHASE_LOCKED') and
          is_error(delete(target, 'before', a_cookie), 409, 'COMMENT_PHASE_LOCKED') and
          delete(target, 'before', b_cookie) == no_content and listing(target) == [before_a])
    after_a = comment(put(target, 'after', a_cookie, 'A의 감상'))
    after_b = comment(put(target, 'after', b_cookie, 'B의 감상'))
    edited_b = comment(put(target, 'after', b_cookie, 'B의 감상 수정'))
    check('A and B write and read After, and an edit keeps the author and the original row',
          listing(target) == listing(target, b_cookie) == [before_a, after_a, edited_b] and
          after_a['user_id'] == a_id and edited_b['user_id'] == b_id and
          edited_b == {**after_b, 'content': 'B의 감상 수정', 'updated_at': edited_b['updated_at']} and
          edited_b['updated_at'] > after_b['updated_at'])
    check('every remaining After blocks revert, and each author deletes only their own',
          is_error(patch_visit(visited, False), 409, 'AFTER_COMMENTS_EXIST') and
          delete(target, 'after', a_cookie) == no_content and
          delete(target, 'after', a_cookie) == no_content and listing(target) == [before_a, edited_b] and
          is_error(patch_visit(visited, False, a_cookie), 409, 'AFTER_COMMENTS_EXIST') and
          delete(target, 'after', b_cookie) == no_content)
    reverted = patch_visit(visited, False)
    check('deleting both After records allows revert and re-enables editing Before',
          reverted[0] == 200 and reverted[1]['data']['place']['is_visited'] is False and
          reverted[1]['data']['place']['visited_at'] is None and listing(target) == [before_a] and
          comment(put(target, 'before', a_cookie, '다시 편집'))['id'] == before_a['id'])

    concurrent = create('코멘트 동시 쓰기 검증')
    for stage in ('create', 'edit'):
        left, right = (comment(response) for response in parallel(
            lambda: put(concurrent, 'before', a_cookie, stage + ' A'),
            lambda: put(concurrent, 'before', a_cookie, stage + ' B')))
        winner = max((left, right), key=lambda row: row['updated_at'])
        check(f'concurrent same-user {stage} serializes both PUTs into one row',
              left['id'] == right['id'] and left['created_at'] == right['created_at'] and
              left['updated_at'] != right['updated_at'] and listing(concurrent) == [winner])
    write, removal = parallel(lambda: put(concurrent, 'before', a_cookie, '경합'),
                              lambda: delete(concurrent, 'before', a_cookie))
    written = comment(write)
    remaining = listing(concurrent)
    check('concurrent PUT and DELETE produce a serial result without duplicate rows',
          removal == no_content and (remaining == [] or (remaining == [written] and written['id'] != winner['id'])))
    check('concurrent DELETE is idempotent', parallel(
        lambda: delete(concurrent, 'before', a_cookie),
        lambda: delete(concurrent, 'before', a_cookie)) == [no_content, no_content] and listing(concurrent) == [])

    for attempt in range(4):
        race = create('방문 복귀 경합')
        completed = patch_visit(race, True)
        assert completed[0] == 200, 'could not complete the race fixture visit'
        race = completed[1]['data']['place']
        after, revert = parallel(lambda: put(race, 'after', a_cookie, '감상'),
                                 lambda: patch_visit(race, False))
        actual = http(path(race), cookie=b_cookie)[1]['data']['place']
        records = listing(race, b_cookie)
        # 가능한 직렬 결과는 After만 성공하거나 미방문 복귀만 성공하는 두 가지다.
        check(f'After PUT vs revert race {attempt + 1} preserves the visit/comment invariant',
              (after[0] == 200 and is_error(revert, 409, 'AFTER_COMMENTS_EXIST') and
               actual == race and records == [comment(after)]) or
              (revert[0] == 200 and is_error(after, 409, 'COMMENT_PHASE_LOCKED') and
               actual == revert[1]['data']['place'] and actual['is_visited'] is False and not records))

    failure = create('코멘트 트랜잭션 롤백')
    saved = comment(put(failure, 'before', a_cookie, '복원할 기록'))
    # 격리 DB에서 upsert가 끝난 뒤 실행되는 작성자 조회만 실패시켜 INSERT와 UPDATE의 롤백을 검증한다.
    sql('ALTER TABLE users RENAME COLUMN display_name TO test_hidden_display_name')
    try:
        failures = (put(failure, 'before', b_cookie, '저장되면 안 되는 새 기록'),
                    put(failure, 'before', a_cookie, '저장되면 안 되는 수정'))
    finally:
        sql('ALTER TABLE users RENAME COLUMN test_hidden_display_name TO display_name')
    check('DB error after insert or update rolls back the full comment transaction',
          all(is_error(response, 500, 'INTERNAL_ERROR') and
              set(response[1]['error']) == {'code', 'message'} for response in failures) and
          listing(failure) == [saved] and http(path(failure), cookie=b_cookie)[1]['data']['place'] == failure and
          comment(put(failure, 'before', b_cookie, '롤백 후 쓰기'))['user_id'] == b_id)

    check('shared place deletion cascades both users’ comments and removes the comments endpoint',
          http(path(failure), 'DELETE', b_cookie,
               headers={'X-Expected-Updated-At': failure['updated_at']}) == no_content and
          sql(f"SELECT COUNT(*) FROM place_comments WHERE place_id = {failure['id']}") == '0' and
          is_error(http(comments_path(failure), cookie=a_cookie), 404, 'NOT_FOUND'))
