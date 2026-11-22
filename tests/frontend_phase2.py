"""데이트 계획 및 장소 변경을 격리 Docker API와 Firefox에서 검증한다."""

import json
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from auth import check, docker, NETWORK


def verify_place_management(browser, url, password_a, password_b, artifacts, original, sign_in, wait_text):
    first = '2026-11-14'
    second = '2026-11-15'
    title = '<img src=x onerror=alert(1)> 수정 장소'
    memo = '<script>alert(1)</script>'
    places = '/api/places'
    client_a = build_opener(HTTPCookieProcessor(CookieJar()))

    def api(path, method='GET', data=None, headers=None, expected=200):
        options = dict(headers or {})
        payload = None
        if data is not None:
            options['Content-Type'] = 'application/json'
            payload = json.dumps(data).encode()
        try:
            response = client_a.open(Request(url + path, data=payload, headers=options, method=method), timeout=10)
        except HTTPError as error:
            response = error
        with response:
            if response.status != expected:
                raise AssertionError(f'Unexpected fixture API status ({method} {path}): {response.status}')
            return None if response.status == 204 else json.load(response)

    def switch_user(account, password):
        browser.click('#logout')
        browser.wait('login form visible after logout', 'return document.querySelector("#login-form")?.offsetHeight > 0;')
        sign_in(f'user_{account}@example.test', password)
        wait_text('#current-user', f'사용자 {account.upper()}')

    def open_plan(date):
        browser.open(url + '/plans.html?date=' + date)
        browser.wait('schedule loaded', 'return document.querySelector("#plan-results").ariaBusy === "false" && !document.querySelector("#plan-count").hidden;')

    def pick_date(date):
        browser.fill('#plan-date', date)
        browser.js('document.querySelector("#plan-date").dispatchEvent(new Event("change"));')
        browser.wait('selected schedule loaded', '''
            return document.querySelector("#plan-results").ariaBusy === "false" &&
                new URLSearchParams(location.search).get("date") === arguments[0];
        ''', date)

    def rows():
        return browser.js('return [...document.querySelectorAll("#plan-list .plan-place-link")].map(node => node.textContent);')

    def action(place_id, name):
        return f'[data-plan-action="{place_id}-{name}"]'

    def patch(place_id, **changes):
        path = f'{places}/{place_id}'
        current = api(path)['data']['place']
        return api(path, 'PATCH', dict(changes, expected_updated_at=current['updated_at']))['data']['place']

    browser.command('POST', '/window/rect', {'width': 1440, 'height': 950})
    browser.wait('original place ready', 'return !!document.querySelector("#places a");')
    place_id = browser.js('return Number(document.querySelector("#places a").dataset.id);')
    path = f'{places}/{place_id}'
    detail = url + '/place.html?id=' + str(place_id)

    switch_user('a', password_a)
    browser.open(detail)
    wait_text('#detail-title', original)
    browser.click('#edit-place')
    browser.screenshot(artifacts / 'edit-place-1440.png')
    browser.fill('#place-title', title)
    browser.fill('#category', '맛집')
    browser.fill('#source-url', 'javascript:void(0)')
    browser.click('#save-place')
    wait_text('#source_url-error', 'HTTP')
    browser.fill('#source-url', 'https://example.test/edited')
    browser.fill('#memo', memo)
    browser.click('#save-place')
    wait_text('#detail-notice', '장소 정보를 저장했어요.')
    check('A edits all four fields through Place API 0.6', browser.js('''
        return document.querySelector("#detail-title").textContent === arguments[0]
            && document.querySelector("#detail-tags").textContent.includes("맛집")
            && document.querySelector("#detail-fields a").href === "https://example.test/edited"
            && document.querySelector("#detail-fields").textContent.includes(arguments[1]);
    ''', title, memo))
    check('edited title and memo stay text in detail', browser.js(
        'return !document.querySelector("#detail-title img, #detail-fields script");'))

    api('/api/auth/login', 'POST', {'email': 'user_a@example.test', 'password': password_a})
    browser.open(url + '/index.html')
    wait_text('#places', title)
    browser.click('#selected-place button')
    wait_text('.action-dialog h2', '일정에 추가')
    date_default = browser.js('return document.querySelector(".action-dialog input").value;')
    check('assignment dialog defaults to the Seoul calendar date', browser.js('''
        return new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Seoul"}).format(new Date()) === arguments[0];
    ''', date_default))
    browser.fill('.action-dialog input', first)
    browser.click('.action-dialog button[value=confirmed]')
    wait_text('#save-status', '일정을 저장했어요.')
    browser.wait('library links to assigned schedule', '''
        return document.querySelector("#selected-place a[href^='/plans.html']")?.search === "?date=" + arguments[0];
    ''', first)
    check('library date assignment persists on the shared record', api(path)['data']['place']['planned_date'] == first)

    switch_user('b', password_b)
    wait_text('#places', title)
    browser.open(detail)
    wait_text('#detail-title', title)
    check('B reloads A’s edited detail and assignment', browser.js('''
        return document.querySelector("#detail-tags").textContent.includes("11월 14일") &&
            document.querySelector("#detail-fields").textContent.includes(arguments[0]);
    ''', memo))
    browser.click('#edit-place')
    browser.fill('#memo', 'B가 남긴 수정')
    patch(place_id, category='놀거리')
    browser.click('#save-place')
    wait_text('#save-error', '최신 내용을 확인')
    wait_text('#edit-latest', '놀거리')
    check('UPDATE_CONFLICT reloads detail and keeps the draft without replay', browser.js('''
        return document.querySelector("#memo").value === "B가 남긴 수정" &&
            document.querySelector("#category").value === "놀거리" &&
            document.querySelector("#detail-tags").textContent.includes("놀거리");
    ''') and api(path)['data']['place']['memo'] == memo)
    browser.click('#save-place')
    wait_text('#detail-notice', '장소 정보를 저장했어요.')
    check('B’s explicit retry saves only the edited value at the refreshed version',
          api(path)['data']['place']['memo'] == 'B가 남긴 수정' and api(path)['data']['place']['category'] == '놀거리')

    extra = api(places, 'POST', {'title': '격리 순서 장소', 'category': '카페'}, expected=201)['data']['place']['id']
    open_plan(second)
    wait_text('#plan-status', '이 날짜에는 계획이 없어요.')
    check('empty schedule offers candidates and excludes previously visited places', browser.js('''
        return !document.querySelector("#candidate-list").textContent.includes("격리 방문 완료 장소") &&
            document.querySelector("#candidate-list").textContent.includes("11월 14일 예정");
    '''))
    browser.click(action(place_id, 'add'))
    wait_text('.action-dialog h2', '기존 일정에서 이동할까요?')
    wait_text('.action-dialog #action-description', '11월 14일')
    wait_text('.action-dialog #action-description', '11월 15일')
    browser.screenshot(artifacts / 'date-conflict-1440.png')
    browser.click('.action-dialog button[type=button]')
    browser.wait('cancel completed', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    check('cancel does not move the place', api(path)['data']['place']['planned_date'] == first)

    browser.click(action(place_id, 'add'))
    wait_text('.action-dialog h2', '기존 일정에서 이동할까요?')
    patch(place_id, source_url='https://example.test/updated-while-moving')
    browser.click('.action-dialog button[value=confirmed]')
    wait_text('#plan-notice', '최신 내용을 확인')
    browser.wait('conflict refreshed', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    check('expired move confirmation receives UPDATE_CONFLICT without replay',
          api(path)['data']['place']['planned_date'] == first and not rows())

    browser.click(action(place_id, 'add'))
    browser.click('.action-dialog button[value=confirmed]')
    wait_text('#plan-list', title)
    browser.wait('move completed', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    check('B confirms movement and A sees both dates refresh via API',
          not api(places + '?planned_date=' + first)['data']['places'] and
          api(places + '?planned_date=' + second)['data']['places'][0]['id'] == place_id)

    browser.click(action(extra, 'add'))
    wait_text('#plan-list', '격리 순서 장소')
    browser.wait('new schedule version ready', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    check('new assignment appends and boundary actions are disabled',
          rows() == [title, '격리 순서 장소'] and browser.js('''
            return document.querySelector(arguments[0]).disabled && document.querySelector(arguments[1]).disabled;
          ''', action(place_id, 'up'), action(extra, 'down')))
    patch(extra, visit_order=1)
    browser.click(action(extra, 'up'))
    wait_text('#plan-notice', '최신 내용을 확인')
    browser.wait('reorder conflict refreshed', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    check('reorder conflict reloads the server order without a second mutation', rows() == ['격리 순서 장소', title])
    browser.click(action(place_id, 'up'))
    wait_text('#plan-notice', '방문 순서를 변경했어요.')
    browser.wait('reorder completed', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    check('separate reorder PATCH produces continuous order visible to A',
          rows() == [title, '격리 순서 장소'] and
          [place['visit_order'] for place in api(places + '?planned_date=' + second)['data']['places']] == [1, 2])

    pick_date(first)
    check('native date change loads the empty source date', not rows())
    pick_date(second)
    mobile = api(places, 'POST', {'title': '격리 모바일 후보', 'category': '기타'}, expected=201)['data']['place']['id']
    browser.responsive(url + '/plans.html?date=' + second, '#plan-list', artifacts)
    # 모바일에서 후보 목록이 데스크톱 영역 대신 모달을 통해 열리는지 실제로 눌러 본다.
    browser.command('POST', '/window/rect', {'width': 600, 'height': 950})
    open_plan(second)
    browser.click('#open-candidates')
    check('mobile candidate picker opens as a native modal', browser.js(
        'return document.querySelector("#candidate-dialog").open && !!document.querySelector("#candidate-dialog #candidate-list");'))
    browser.click(action(mobile, 'add'))
    wait_text('#plan-list', '격리 모바일 후보')
    browser.wait('mobile assignment completed', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    browser.click(action(mobile, 'remove'))
    browser.click('.action-dialog button[value=confirmed]')
    wait_text('#plan-notice', '일정에서 제외했어요.')
    browser.wait('mobile exclusion completed', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    check('mobile picker adds a real place and mobile controls remove it', rows() == [title, '격리 순서 장소'])
    browser.command('POST', '/window/rect', {'width': 1440, 'height': 950})
    switch_user('a', password_a)
    open_plan(second)
    check('A sees B’s schedule changes in browser', rows() == [title, '격리 순서 장소'])
    browser.click('#plan-list a')
    wait_text('#detail-title', title)
    browser.click('#toggle-visit')
    wait_text('#detail-fields', '방문 완료 시점')
    check('visit PATCH records a timestamp and preserves the existing schedule',
          browser.js('return document.querySelector("#toggle-visit").textContent === "미방문으로 변경";') and
          api(path)['data']['place']['planned_date'] == second)
    open_plan(second)
    wait_text('#plan-list .visited', '방문 완료')
    check('visited place remains in existing itinerary', rows() == [title, '격리 순서 장소'])
    browser.open(url + '/index.html')
    wait_text('#current-user', '사용자 A')
    browser.click('[data-status=visited]')
    wait_text('#places', title)
    check('library visited tab reflects the visit', browser.js(
        'return document.querySelector("#visited-count").textContent === "2";'))

    comment = path + '/comments/after'
    api(comment, 'PUT', {'content': '격리 방문 후 기록'})
    browser.open(detail)
    wait_text('#toggle-visit', '미방문으로 변경')
    browser.click('#toggle-visit')
    wait_text('.action-dialog h2', '미방문으로 변경할 수 없어요')
    wait_text('.action-dialog #action-description', '각 작성자')
    browser.click('.action-dialog button[value=confirmed]')
    check('real AFTER_COMMENTS_EXIST keeps the visit timestamp', api(path)['data']['place']['is_visited'])
    api(comment, 'DELETE', expected=204)

    browser.js('''
        const realFetch = window.fetch;
        window.fetch = (path, options) => {
            if (options.method === 'PATCH') {
                window.fetch = realFetch;
                return Promise.resolve(new Response(
                    JSON.stringify({error: {code: 'WRITE_BUSY', message: 'temporary'}}), {status: 503}));
            }
            return realFetch(path, options);
        };
    ''')
    browser.click('#toggle-visit')
    wait_text('#detail-notice', '변경하지 못했어요.')
    check('temporary API failure leaves status untouched', api(path)['data']['place']['is_visited'])
    browser.click('#toggle-visit')
    wait_text('#detail-notice', '미방문으로 변경했어요.')
    check('explicit retry clears the visit timestamp', api(path)['data']['place']['visited_at'] is None)
    browser.responsive(detail, '#place-detail', artifacts)

    open_plan(second)
    browser.click(action(extra, 'remove'))
    wait_text('.action-dialog h2', '일정에서 제외할까요?')
    browser.click('.action-dialog button[value=confirmed]')
    wait_text('#plan-notice', '일정에서 제외했어요.')
    browser.wait('exclusion completed', 'return document.querySelector("#plan-results").ariaBusy === "false";')
    check('unscheduling clears date and order and keeps place',
          rows() == [title] and api(f'{places}/{extra}')['data']['place']['visit_order'] is None and
          api(f'{places}/{extra}')['data']['place']['planned_date'] is None)

    api(path + '/comments/before', 'PUT', {'content': '격리 삭제 연동 기록'})
    switch_user('b', password_b)
    browser.open(detail)
    wait_text('#detail-title', title)
    browser.click('#delete-place')
    wait_text('.action-dialog #action-description', '두 사람의 코멘트도 함께 삭제')
    browser.click('.action-dialog button[type=button]')
    browser.wait('delete cancel completed', 'return !document.querySelector("#delete-place").disabled;')
    check('delete cancel keeps the place', api(path)['data']['place']['id'] == place_id)
    browser.click('#delete-place')
    patch(place_id, memo='삭제 확인 중 변경')
    browser.click('.action-dialog button[value=confirmed]')
    wait_text('#detail-notice', '최신 내용을 확인')
    wait_text('#detail-fields', '삭제 확인 중 변경')
    check('stale DELETE refreshes detail and requires explicit reconfirmation', api(path)['data']['place']['id'] == place_id)
    browser.click('#delete-place')
    browser.click('.action-dialog button[value=confirmed]')
    wait_text('#save-status', '장소를 삭제했어요.')
    check('B deletes the shared place and its comments are physically removed',
          api(path, expected=404)['error']['code'] == 'NOT_FOUND' and
          docker('exec', NETWORK + '-db', 'sh', '-c',
                 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" -Nse "$1"',
                 'sh', f'SELECT COUNT(*) FROM place_comments WHERE place_id = {place_id}') == '0')
    open_plan(second)
    wait_text('#plan-status', '이 날짜에는 계획이 없어요.')
    browser.open(detail)
    wait_text('#detail-status', '장소를 찾을 수 없어요.')
    browser.open(url + '/index.html')
    wait_text('#current-user', '사용자 B')
