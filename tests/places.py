"""실제 HTTP와 테스트 전용 MySQL 연결로 장소 CRUD 계약을 검증한다."""
from concurrent.futures import ThreadPoolExecutor
import re
import time


def verify_places(http, sql, check, is_error, other_cookie, a_cookie, b_cookie, users):
    base = '/api/places'
    basic = {'title': '저장할 장소', 'category': '카페'}

    def place(response):
        return response[1]['data']['place']

    def patch(path, cookie, version, **changes):
        return http(path, 'PATCH', cookie, {**changes, 'expected_updated_at': version})

    def delete(path, cookie, version):
        return http(path, 'DELETE', cookie, headers={'X-Expected-Updated-At': version})

    def conflict(response, version):
        return (is_error(response, 409, 'UPDATE_CONFLICT') and
                response[1]['error']['details'] == {'current_updated_at': version})

    check('all Place CRUD methods require a valid session before validating input', all(
        is_error(http(path, method, payload=b'{'), 401, 'AUTH_REQUIRED')
        for method, path in [('POST', base), ('GET', base + '/1'),
                             ('PATCH', base + '/1'), ('DELETE', base + '/1')]))
    created = http(base, 'POST', a_cookie, {**basic, 'title': '  저장할 장소  ', 'source_url': '', 'memo': ''})
    check('POST creates the contracted shape and uses session identity and DB defaults',
          created[0] == 201 and set(place(created)) == {
              'id', 'title', 'category', 'source_url', 'memo', 'planned_date', 'visit_order', 'is_visited',
              'visited_at', 'created_at', 'updated_at', 'added_by', 'added_by_name',
          } and all(place(created)[key] is None for key in (
              'source_url', 'memo', 'planned_date', 'visit_order', 'visited_at')) and
          place(created)['title'] == basic['title'] and place(created)['is_visited'] is False and
          place(created)['added_by'] == users[0]['id'] and
          place(created)['added_by_name'] == users[0]['display_name'] and
          re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', place(created)['created_at']) and
          place(created)['created_at'] == place(created)['updated_at'])
    initial = place(created)
    path = f'{base}/{initial["id"]}'
    version = initial['updated_at']

    url = 'https://example.test/'
    second = http(base, 'POST', b_cookie, {'title': '🌿' * 120, 'category': '놀거리',
                                        'source_url': url + 'a' * (2048 - len(url)), 'memo': '한' * 1000})
    check('both accounts can create places, including exact Unicode and URL length limits',
          second[0] == 201 and place(second)['title'] == '🌿' * 120 and
          len(place(second)['source_url']) == 2048 and len(place(second)['memo']) == 1000 and
          place(second)['added_by'] == users[1]['id'])
    second_place = place(second)
    second_path = f'{base}/{second_place["id"]}'
    listing = http(base, cookie=b_cookie)[1]['data']
    check('partners share list and detail and see the original author',
          http(path, cookie=b_cookie)[:2] == (200, {'data': {'place': initial}}) and
          http(second_path, cookie=a_cookie)[:2] == (200, second[1]) and
          [item for item in listing['places'] if item['id'] in (initial['id'], second_place['id'])]
          == [second_place, initial] and listing['counts'] == {'unvisited': 3, 'visited': 1})

    foreign = http(base, cookie=other_cookie)[1]['data']
    foreign_place = foreign['places'][0]
    foreign_path = f'{base}/{foreign_place["id"]}'
    check('list and detail isolate couples in both directions',
          [item['title'] for item in foreign['places']] == ['hidden'] and
          foreign['counts'] == {'unvisited': 1, 'visited': 0} and
          is_error(http(path, cookie=other_cookie), 404, 'NOT_FOUND') and
          is_error(http(foreign_path, cookie=a_cookie), 404, 'NOT_FOUND'))
    check('another couple cannot patch or delete, even with the correct version', all(
        is_error(response, 404, 'NOT_FOUND') for response in (
            patch(path, other_cookie, version, title='숨겨진 변경'), delete(path, other_cookie, version),
            patch(foreign_path, a_cookie, foreign_place['updated_at'], title='숨겨진 변경'),
            delete(foreign_path, a_cookie, foreign_place['updated_at']))))
    check('invalid and nonexistent place IDs are 404', all(
        is_error(http(f'{base}/{item}', cookie=a_cookie), 404, 'NOT_FOUND')
        for item in ('0', '-1', '1.0', 'missing', '2147483648', '2147483647')))

    invalid_forms = [b'null', [], {'category': '카페'}, {'title': '공원'}, {**basic, 'title': '  '},
                     {**basic, 'title': '🌿' * 121}, {**basic, 'category': '공원'},
                     {**basic, 'memo': '한' * 1001}, {**basic, 'memo': 12},
                     {**basic, 'title': '\ud800'}, {**basic, 'source_url': url + '\0'},
                     {**basic, 'source_url': 'javascript:alert(1)'}, {**basic, 'source_url': 'http:example.test'},
                     {**basic, 'source_url': url + 'a' * (2049 - len(url))}, {**basic, 'planned_date': '2026-11-14'}]
    check('POST rejects invalid types, required fields, length, categories, URLs and unsupported fields', all(
        is_error(http(base, 'POST', a_cookie, form), 422, 'VALIDATION_ERROR') for form in invalid_forms))
    check('authenticated malformed JSON returns 400', all(
        is_error(http(endpoint, method, a_cookie, b'{'), 400, 'BAD_REQUEST')
        for method, endpoint in [('POST', base), ('PATCH', path)]))
    check('identity spoofing fields return 403', all(
        is_error(response, 403, 'FORBIDDEN') for response in (
            http(base, 'POST', a_cookie, {**basic, 'couple_id': 'test-other-couple'}),
            patch(path, a_cookie, version, added_by=users[1]['id']),
            http(path + '?coupleId=test-other-couple', cookie=a_cookie),
            http(path + '?user_id=1', 'DELETE', a_cookie),
            http(path, 'DELETE', a_cookie, {'couple_id': 'test-other-couple'}))))
    check('PATCH and DELETE reject missing or noncanonical comparison values', all(
        is_error(response, 422, 'VALIDATION_ERROR') for response in (
            http(path, 'PATCH', a_cookie, {'memo': '값'}), patch(path, a_cookie, version[:-5] + 'Z', memo='값'),
            patch(path, a_cookie, '2026-02-30T00:00:00.000Z', memo='값'), http(path, 'DELETE', a_cookie),
            delete(path, a_cookie, '2026-11-22T24:00:00.000Z'),
            http(path, 'DELETE', a_cookie, {}, headers={'X-Expected-Updated-At': version}))))
    check('PATCH rejects empty changes, server timestamps and invalid changes on an unscheduled place', all(
        is_error(patch(path, a_cookie, version, **form), 422, 'VALIDATION_ERROR') for form in (
            {}, {'updated_at': version}, {'visited_at': None}, {'is_visited': 1},
            {'visit_order': None}, {'visit_order': 1}, {'confirm_move': True})))

    edited = patch(path, b_cookie, version, title='  공유 수정 ', category='기타', source_url=url, memo=' 메모 ')
    check('a partner can patch general fields while preserving author and creation time',
          edited[0] == 200 and place(edited)['title'] == '공유 수정' and place(edited)['category'] == '기타' and
          place(edited)['source_url'] == url and place(edited)['memo'] == ' 메모 ' and
          all(place(edited)[key] == initial[key] for key in ('created_at', 'added_by', 'added_by_name')) and
          place(edited)['updated_at'] > version and http(path, cookie=a_cookie) == edited)
    edited_version = place(edited)['updated_at']
    check('normalization preserves the version for an unchanged PATCH; stale no-op still conflicts',
          patch(path, a_cookie, edited_version, title=' 공유 수정 ') == edited and
          conflict(patch(path, a_cookie, version, title='공유 수정'), edited_version))
    cleared = patch(path, a_cookie, edited_version, source_url=None, memo=' ')
    check('PATCH clears optional fields and leaves omitted fields in place',
          cleared[0] == 200 and place(cleared)['memo'] is None and place(cleared)['source_url'] is None and
          place(cleared)['title'] == place(edited)['title'] and place(cleared)['category'] == place(edited)['category'])

    # DB 시각보다 뒤인 버전을 고정하면 이전 버전 +1ms 분기가 결정적으로 실행된다.
    sql(f"UPDATE places SET updated_at = '2099-01-01 00:00:00.999' WHERE id = {initial['id']}")
    fixed = '2099-01-01T00:00:00.999Z'
    with ThreadPoolExecutor(max_workers=2) as workers:
        requests = [workers.submit(patch, path, cookie, fixed, title=title)
                    for cookie, title in ((a_cookie, '동시 수정 A'), (b_cookie, '동시 수정 B'))]
        responses = sorted((request.result() for request in requests), key=lambda response: response[0])
    current = '2099-01-01T00:00:01.000Z'
    check('concurrent PATCH has one winner, advances exactly 1ms and returns the latest conflict version',
          responses[0][0] == 200 and place(responses[0])['updated_at'] == current and
          conflict(responses[1], current) and http(path, cookie=a_cookie) == responses[0])
    check('stale DELETE reports the latest version and leaves the place intact',
          conflict(delete(path, b_cookie, fixed), current) and http(path, cookie=b_cookie) == responses[0])

    with ThreadPoolExecutor(max_workers=1) as workers:
        # 잠금 획득 후 SLEEP에 도달한 연결을 확인하고 실제 API 잠금 시간 초과를 기다린다.
        lock = workers.submit(sql, "START TRANSACTION; SELECT id FROM users WHERE couple_id = 'couple_001' "
                              "ORDER BY id LIMIT 1 FOR UPDATE; DO SLEEP(7); ROLLBACK")
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if sql("SELECT COUNT(*) FROM information_schema.processlist WHERE info = 'DO SLEEP(7)'") == '1':
                break
            time.sleep(0.1)
        else:
            raise AssertionError('could not acquire the test couple lock')
        busy = patch(path, b_cookie, current, title='잠금이 풀려야 하는 수정')
        lock.result()
    check('real MySQL lock timeout returns WRITE_BUSY and leaves the row unchanged',
          is_error(busy, 503, 'WRITE_BUSY') and http(path, cookie=a_cookie) == responses[0])

    check('either partner can delete; deleted objects are absent from detail and listing',
          delete(path, b_cookie, current)[:2] == (204, None) and
          delete(second_path, a_cookie, second_place['updated_at'])[:2] == (204, None) and
          is_error(http(path, cookie=a_cookie), 404, 'NOT_FOUND') and
          is_error(delete(path, b_cookie, current), 404, 'NOT_FOUND') and
          http(base, cookie=a_cookie)[1]['data']['counts'] == {'unvisited': 1, 'visited': 1})

    dated = http(base + '?planned_date=2026-11-14', cookie=a_cookie)[1]['data']['places']
    earlier, later = dated
    sql(f"INSERT INTO place_comments (place_id, user_id, phase, content) "
        f"VALUES ({later['id']}, {users[0]['id']}, 'before', '테스트 기록')")
    later_path = f'{base}/{later["id"]}'
    check('DELETE cascades existing comments and advances the version even for a schedule row that keeps its order',
          delete(later_path, b_cookie, later['updated_at'])[:2] == (204, None) and
          sql(f"SELECT COUNT(*) FROM place_comments WHERE place_id = {later['id']}") == '0')
    remaining = http(base + '?planned_date=2026-11-14', cookie=b_cookie)[1]['data']['places']
    check('schedule sibling keeps its position and invalidates earlier versions',
          len(remaining) == 1 and remaining[0]['id'] == earlier['id'] and remaining[0]['visit_order'] == 1 and
          remaining[0]['updated_at'] > earlier['updated_at'] and
          conflict(delete(f'{base}/{earlier["id"]}', b_cookie, earlier['updated_at']), remaining[0]['updated_at']))

    sql(f"INSERT INTO places (couple_id, added_by, title, category, planned_date, visit_order) VALUES "
        f"('couple_001', {users[0]['id']}, '세 번째', '기타', '2026-11-14', 2)")
    dated = http(base + '?planned_date=2026-11-14', cookie=a_cookie)[1]['data']['places']
    leading_path = f'{base}/{earlier["id"]}'
    leading_version = dated[0]['updated_at']
    count_leading_comments = f"SELECT COUNT(*) FROM place_comments WHERE place_id = {earlier['id']}"
    sql(f"INSERT INTO place_comments (place_id, user_id, phase, content) "
        f"VALUES ({earlier['id']}, {users[1]['id']}, 'after', '복구할 기록')")
    # 삭제 직후의 순서 갱신만 실패시키고, 롤백이 장소와 CASCADE 삭제까지 복구하는지 검사한다.
    sql("ALTER TABLE places ADD CONSTRAINT chk_test_reorder CHECK (title <> '세 번째' OR visit_order <> 1)")
    try:
        check('failed reorder rolls back place deletion, cascade and existing versions',
              is_error(delete(leading_path, a_cookie, leading_version), 500, 'INTERNAL_ERROR') and
              http(base + '?planned_date=2026-11-14', cookie=a_cookie)[1]['data']['places'] == dated and
              sql(count_leading_comments) == '1')
    finally:
        sql('ALTER TABLE places DROP CHECK chk_test_reorder')
    check('a visited place can be deleted and the remaining date order closes the gap',
          dated[0]['is_visited'] is True and delete(leading_path, a_cookie, leading_version)[:2] == (204, None) and
          sql(count_leading_comments) == '0' and
          [item['visit_order'] for item in http(base + '?planned_date=2026-11-14', cookie=b_cookie)[1]['data']['places']] == [1])
