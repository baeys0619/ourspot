"""격리 MySQL·Redis·Nginx를 통해 일정과 동시성 계약을 검증한다."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import time


def verify_schedules(http, sql, check, is_error, other_cookie, a_cookie, b_cookie):
    base = '/api/places'
    date_a, date_b, date_c = '2028-02-29', '2028-03-01', '2028-03-02'

    def place(response):
        return response[1]['data']['place']

    def detail(row, cookie=a_cookie):
        return place(http(f'{base}/{row["id"]}', cookie=cookie))

    def create(title, cookie=a_cookie):
        response = http(base, 'POST', cookie, {'title': title, 'category': '카페'})
        assert response[0] == 201, 'could not create a schedule fixture'
        return place(response)

    def patch(row, cookie=a_cookie, **fields):
        return http(f'{base}/{row["id"]}', 'PATCH', cookie, {**fields, 'expected_updated_at': row['updated_at']})

    def set_date(row, date, cookie=a_cookie):
        response = patch(row, cookie, planned_date=date)
        assert response[0] == 200, 'could not set the fixture date'
        return place(response)

    def dates(date, cookie=a_cookie, filters=''):
        response = http(f'{base}?planned_date={date}{filters}', cookie=cookie)
        assert response[0] == 200, 'could not read the fixture date'
        return response[1]['data']['places']

    def ordered(rows, *expected):
        return ([p['id'] for p in rows] == [p['id'] for p in expected] and
                [p['visit_order'] for p in rows] == list(range(1, len(expected) + 1)))

    def advanced(before, after):
        latest = {p['id']: p['updated_at'] for p in after}
        return all(latest[p['id']] > p['updated_at'] for p in before)

    def conflict(response, latest):
        return (is_error(response, 409, 'UPDATE_CONFLICT') and
                response[1]['error']['details'] == {'current_updated_at': latest['updated_at']})

    def race(*requests):
        ready = Barrier(len(requests), timeout=5)

        def send(call):
            ready.wait()
            return call()

        with ThreadPoolExecutor(max_workers=len(requests)) as workers:
            return sorted(workers.map(send, requests), key=lambda response: response[0])

    first, second, third = create('첫 일정'), create('둘째 일정', b_cookie), create('셋째 일정')
    foreign = set_date(create('다른 커플 일정', other_cookie), date_a, other_cookie)
    destination = set_date(create('목적 날짜'), date_b)
    unrelated = set_date(create('영향 없는 날짜'), date_c)
    # DB 현재 시각보다 큰 버전으로 대상 정보와 일정이 한 번만 갱신되는지 확인한다.
    sql(f"UPDATE places SET updated_at = '2099-02-28 23:59:59.999' WHERE id = {first['id']}")
    check('own schedule starts empty even with a different couple on the same date', dates(date_a) == [])
    assigned = patch(detail(first), b_cookie, planned_date=date_a, memo='날짜와 함께 저장')
    check('first assignment preserves the calendar date and applies general fields with one version increment',
          assigned[0] == 200 and place(assigned)['planned_date'] == date_a and place(assigned)['visit_order'] == 1 and
          place(assigned)['memo'] == '날짜와 함께 저장' and place(assigned)['updated_at'] == '2099-03-01T00:00:00.000Z')

    set_date(second, date_a, b_cookie)
    before_append = dates(date_a)
    set_date(third, date_a)
    before_reorder = dates(date_a, b_cookie, '&sort=oldest')
    check('assignments append in order, advance existing rows and give A/B the same dated list',
          ordered(before_reorder, first, second, third) and before_reorder == dates(date_a) and
          advanced([place(assigned)], before_append) and advanced(before_append, before_reorder))
    check('another couple sees only its schedule and cannot change ours in either direction',
          dates(date_a, other_cookie) == [foreign] and all(is_error(result, 404, 'NOT_FOUND') for result in (
              patch(before_reorder[0], other_cookie, planned_date=date_b, confirm_move=True),
              patch(foreign, a_cookie, visit_order=1),
              http(f'{base}/{foreign["id"]}', cookie=a_cookie))))

    unchanged = patch(before_reorder[0], planned_date=date_a, visit_order=1, confirm_move=True)
    check('same date and position are a PATCH no-op, even with a confirmation flag',
          unchanged[0] == 200 and place(unchanged) == before_reorder[0] and dates(date_a) == before_reorder)
    reordered = patch(before_reorder[2], b_cookie, planned_date=date_a, visit_order=2)
    after_reorder = dates(date_a)
    check('same-date reorder shifts siblings and versions even when a position is unchanged',
          reordered[0] == 200 and place(reordered) == after_reorder[1] and
          ordered(after_reorder, first, third, second) and advanced(before_reorder, after_reorder) and
          conflict(patch(before_reorder[0], b_cookie, visit_order=2), after_reorder[0]))

    sql(f'UPDATE places SET is_visited = TRUE, visited_at = UTC_TIMESTAMP(3) WHERE id = {second["id"]}')
    visited = detail(second)
    visit_reorder = patch(visited, b_cookie, visit_order=2)
    check('existing visited places participate in order and appear only in the appropriate status filter',
          visit_reorder[0] == 200 and place(visit_reorder)['is_visited'] is True and
          ordered(dates(date_a), first, second, third) and dates(date_a, b_cookie, '&status=visited') == [place(visit_reorder)] and
          [p['id'] for p in dates(date_a, a_cookie, '&status=unvisited')] == [first['id'], third['id']])
    check('visited places cannot move to another date with or without confirmation', all(
        is_error(patch(place(visit_reorder), b_cookie, planned_date=date_b, confirm_move=flag), 409, 'PLACE_ALREADY_VISITED')
        for flag in (True, False)))

    pending = create('미배정 검증')
    before_invalid = dates(date_a)
    check('schedule validation rejects invalid dates, orders, confirmation and server-managed fields', all(
        is_error(patch(row, **fields), 422, 'VALIDATION_ERROR') for row, fields in (
            (pending, {'planned_date': '2027-02-29'}), (pending, {'planned_date': '2028-2-29'}),
            (pending, {'planned_date': '2028-02-29T00:00:00.000Z'}), (pending, {'planned_date': 20280229}),
            (pending, {'planned_date': ''}), (pending, {'visit_order': 1}),
            (before_invalid[0], {'visit_order': 0}), (before_invalid[0], {'visit_order': -1}),
            (before_invalid[0], {'visit_order': 2.5}), (before_invalid[0], {'visit_order': '2'}),
            (before_invalid[0], {'visit_order': 4}), (before_invalid[0], {'visit_order': None}),
            (before_invalid[0], {'planned_date': date_a, 'visit_order': None}),
            (before_invalid[0], {'planned_date': date_b, 'visit_order': 1, 'confirm_move': True}),
            (before_invalid[0], {'planned_date': None, 'visit_order': 1}),
            (pending, {'planned_date': date_a, 'visit_order': 1}), (pending, {'planned_date': date_a, 'confirm_move': 'true'}),
            (pending, {'planned_date': date_a, 'is_visited': True}), (pending, {'planned_date': date_a, 'other': 1}),
        )) and dates(date_a) == before_invalid and detail(pending) == pending)

    moving = before_invalid[2]
    check('unconfirmed move returns both dates and current version without writing any fields', all(
        is_error(response, 409, 'DATE_CONFLICT') and response[1]['error']['details'] == {
            'current_planned_date': date_a, 'requested_planned_date': date_b, 'current_updated_at': moving['updated_at'],
        } for response in (patch(moving, planned_date=date_b, memo='보류'),
                           patch(moving, planned_date=date_b, confirm_move=False))) and
        dates(date_a) == before_invalid and dates(date_b) == [destination])
    edited = place(patch(moving, b_cookie, memo='확인 중 수정'))
    latest_source = dates(date_a)
    check('general edits leave sibling versions unchanged and stale confirmation returns UPDATE_CONFLICT first',
          latest_source[:2] == before_invalid[:2] and latest_source[2] == edited and
          conflict(patch(moving, planned_date=date_b, confirm_move=True), edited) and
          conflict(patch(moving, planned_date=date_b), edited))
    moved = patch(edited, b_cookie, planned_date=date_b, confirm_move=True)
    after_source, after_destination = dates(date_a), dates(date_b)
    check('confirmed move closes the source, appends to destination and updates only both date groups',
          moved[0] == 200 and place(moved) == after_destination[-1] and ordered(after_source, first, second) and
          ordered(after_destination, destination, third) and advanced(latest_source, after_source + after_destination) and
          advanced([destination], after_destination) and dates(date_c) == [unrelated] and
          dates(date_a, other_cookie) == [foreign])

    excluded = patch(after_source[1], b_cookie, planned_date=None, visit_order=None)
    after_exclusion = dates(date_a)
    check('exclusion clears only schedule fields, advances siblings and leaves visited history and place intact',
          excluded[0] == 200 and place(excluded)['planned_date'] is None and place(excluded)['visit_order'] is None and
          place(excluded)['visited_at'] == visited['visited_at'] and detail(second) == place(excluded) and
          ordered(after_exclusion, first) and advanced(after_source, after_exclusion + [place(excluded)]) and
          is_error(patch(place(excluded), planned_date=date_c), 409, 'PLACE_ALREADY_VISITED'))
    last = set_date(unrelated, None)
    check('excluding the final place empties the date; repeating exclusion is a no-op',
          dates(date_c) == [] and detail(unrelated) == last and last['visit_order'] is None and
          place(patch(last, planned_date=None, visit_order=None)) == last)

    race_date, race_other = '2028-03-03', '2028-03-04'
    left, right = create('동시 배정 A'), create('동시 배정 B', b_cookie)
    added = race(lambda: patch(left, planned_date=race_date), lambda: patch(right, b_cookie, planned_date=race_date))
    same_day = dates(race_date)
    check('concurrent appends to an initially empty date both succeed with order 1..2',
          [response[0] for response in added] == [200, 200] and
          [p['visit_order'] for p in same_day] == [1, 2] and {p['id'] for p in same_day} == {left['id'], right['id']})
    order_race = race(lambda: patch(same_day[0], visit_order=2), lambda: patch(same_day[1], b_cookie, visit_order=1))
    swapped = dates(race_date)
    check('concurrent reorders targeting different rows serialize and reject the stale sibling',
          order_race[0][0] == 200 and ordered(swapped, *reversed(same_day)) and advanced(same_day, swapped) and
          conflict(order_race[1], next(row for row in swapped if row['id'] != place(order_race[0])['id'])))

    cross = set_date(create('역방향 이동'), race_other)
    moves = race(lambda: patch(swapped[0], planned_date=race_other, confirm_move=True),
                 lambda: patch(cross, b_cookie, planned_date=race_date, confirm_move=True))
    after_left, after_right = dates(race_date), dates(race_other)
    check('opposite-direction moves yield one conflict and keep both date groups contiguous',
          moves[0][0] == 200 and len(after_left) + len(after_right) == 3 and
          advanced(swapped + [cross], after_left + after_right) and ordered(after_left, *after_left) and
          ordered(after_right, *after_right) and conflict(moves[1], detail(cross if place(moves[0])['id'] == swapped[0]['id'] else swapped[0])))

    delete_first, delete_second = dates(date_b)
    delete_race = race(lambda: http(f'{base}/{delete_first["id"]}', 'DELETE', a_cookie,
                                   headers={'X-Expected-Updated-At': delete_first['updated_at']}),
                       lambda: patch(delete_second, b_cookie, visit_order=1))
    after_delete_race = dates(date_b)
    check('deletion racing with reorder yields one success, one stale conflict and a continuous order',
          delete_race[0][0] in (200, 204) and ordered(after_delete_race, *after_delete_race) and
          len(after_delete_race) == (2 if delete_race[0][0] == 200 else 1) and
          conflict(delete_race[1], detail(delete_first if delete_race[0][0] == 200 else delete_second)))

    rollback_src, rollback_dst = '2028-03-05', '2028-03-06'
    target = set_date(create('롤백 이동 대상'), rollback_src)
    set_date(create('롤백 출발 날짜'), rollback_src, b_cookie)
    blocker = set_date(create('롤백 목적 날짜'), rollback_dst)
    original = dates(rollback_src), dates(rollback_dst)
    target = original[0][0]
    db_version = blocker['updated_at'].replace('T', ' ').removesuffix('Z')
    # 대상과 원래 날짜가 변경된 다음 목적 날짜의 버전 갱신만 실패시킨다.
    sql(f"ALTER TABLE places ADD CONSTRAINT chk_test_schedule_rollback "
        f"CHECK (title <> '롤백 목적 날짜' OR updated_at = '{db_version}')")
    try:
        failure = patch(target, b_cookie, planned_date=rollback_dst, confirm_move=True, memo='롤백할 메모')
        check('failure at destination rolls back both dates, every version and the combined general edit',
              is_error(failure, 500, 'INTERNAL_ERROR') and original == (dates(rollback_src), dates(rollback_dst)))
    finally:
        sql('ALTER TABLE places DROP CHECK chk_test_schedule_rollback')

    with ThreadPoolExecutor(max_workers=1) as workers:
        lock = workers.submit(sql, f'START TRANSACTION; SELECT id FROM places WHERE id = {blocker["id"]} '
                                   'FOR UPDATE; DO SLEEP(7); ROLLBACK')
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if sql("SELECT COUNT(*) FROM information_schema.processlist WHERE info = 'DO SLEEP(7)'") == '1':
                break
            time.sleep(0.1)
        else:
            raise AssertionError('could not acquire the test destination lock')
        busy = patch(target, b_cookie, planned_date=rollback_dst, confirm_move=True)
        lock.result()
    check('destination row lock times out with WRITE_BUSY and neither date changes',
          is_error(busy, 503, 'WRITE_BUSY') and original == (dates(rollback_src), dates(rollback_dst)))
    retried = patch(target, b_cookie, planned_date=rollback_dst, confirm_move=True)
    check('after rollback and lock release the same version can succeed without partial changes',
          retried[0] == 200 and ordered(dates(rollback_src), original[0][1]) and
          ordered(dates(rollback_dst), blocker, target))
