"""실제 격리 Docker 서비스와 별도 Firefox 세션 두 개로 코멘트 UI를 검증한다."""

from auth import check


def verify_comments_ui(browser, partner, url, password_a, artifacts):
    # 첫 브라우저는 2단계 검증을 마친 B 세션이고 상대 브라우저에서 A로 로그인한다.
    def wait_text(view, selector, text):
        view.wait(f'{selector} showed expected text', '''
            return document.querySelector(arguments[0])?.textContent.includes(arguments[1]);
        ''', selector, text)

    def api(view, path, method, body=None):
        status, data = view.command('POST', '/execute/async', {'script': '''
            const [path, method, body, done] = arguments;
            fetch(path, {method, headers: body ? {'Content-Type': 'application/json'} : {},
                body: body ? JSON.stringify(body) : undefined})
              .then(async response => done([response.status, response.status === 204 ? null : await response.json()]));
        ''', 'args': [path, method, body]})
        assert status in (200, 201, 204), f'Unexpected isolated API status: {status}'
        return data

    def ready(view):
        view.wait('comments and place controls ready', '''
            return !document.querySelector("#comment-phases").hidden && !document.querySelector("#toggle-visit").disabled;
        ''')

    def action(phase, name='edit'):
        return f'#{phase}-comments [data-comment-action="{name}"]'

    def save(view, phase, content):
        view.click(action(phase))
        view.fill('#comment-content', content)
        view.click('#save-comment')
        wait_text(view, '#comments-notice', '코멘트를 저장했어요.')
        ready(view)
        view.wait('comment editor closed after server confirmation', 'return !document.querySelector("#comment-dialog").open;')

    def remove(view, phase):
        view.click(action(phase, 'delete'))
        view.click('.action-dialog button[value=confirmed]')
        wait_text(view, '#comments-notice', '코멘트를 삭제했어요.')
        ready(view)

    def records(view):
        return api(view, endpoint + '/comments', 'GET')['data']['comments']

    def visible_text(view, phase):
        return view.js('return document.querySelector(arguments[0]).innerText;', f'#{phase}-comments')

    def key(view, value):
        view.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': [
            {'type': 'keyDown', 'value': value}, {'type': 'keyUp', 'value': value},
        ]}]})

    def inject(view, method, status):
        # 실제 읽기와 다른 요청은 그대로 보내고, 대상 코멘트 요청 한 번만 실패시킨다.
        view.js('''
            const [method, status] = arguments;
            const original = window.fetch;
            window.fetch = (path, options) => {
                if (options.method === method && path.includes('/comments')) {
                    window.fetch = original;
                    if (status === 0) return Promise.reject(new TypeError('isolated offline'));
                    return Promise.resolve(new Response(JSON.stringify({error: {
                        fieldErrors: {content: '격리 서버 검증 오류'},
                    }}), {status}));
                }
                return original(path, options);
            };
        ''', method, status)

    partner.open(url + '/login.html')
    partner.wait('partner login ready', 'return !document.querySelector("#login-form").hidden;')
    partner.fill('#email-input', 'user_a@example.test')
    partner.fill('#password-input', password_a)
    partner.click('#login-submit')
    wait_text(partner, '#current-user', '사용자 A')
    place = api(partner, '/api/places', 'POST', {'title': '둘의 기록 격리 검증', 'category': '카페'})['data']['place']
    endpoint = f"/api/places/{place['id']}"
    detail = f"{url}/place.html?id={place['id']}"
    partner.open(detail)
    ready(partner)
    check('empty before cards and locked after reflect actual empty API', not records(partner) and
          '아직 남긴 기록이 없어요.' in visible_text(partner, 'before') and
          '방문 완료 후 작성할 수 있어요.' in visible_text(partner, 'after'))

    # 실제 키 입력, 포커스 복원과 1000 유니코드 코드 포인트 경계를 검증한다.
    partner.js('document.querySelector(arguments[0]).focus();', action('before'))
    key(partner, '\ue007')
    check('keyboard opens the editor and focuses the textarea', partner.js('''
        return document.querySelector("#comment-dialog").open &&
            document.activeElement.id === "comment-content";
    '''))
    key(partner, '\ue00c')
    partner.wait('keyboard focus returned', 'return document.activeElement.matches(arguments[0]);', action('before'))
    check('Escape cancels editor and restores focus without writing', not records(partner))
    partner.click(action('before'))
    for invalid in ('   ', '😀' * 1001):
        partner.fill('#comment-content', invalid)
        partner.click('#save-comment')
        wait_text(partner, '#comment-content-error', '1~1000자')
    check('whitespace and 1001 code points are rejected locally', not records(partner))
    boundary = '😀' * 1000
    partner.fill('#comment-content', ' ' + boundary + ' ')
    partner.click('#save-comment')
    ready(partner)
    check('1000 astral Unicode code points are stored and trimmed', records(partner)[0]['content'] == boundary)

    marker = '<img src=x onerror="window.commentExecuted=1">\n두 번째 줄'
    save(partner, 'before', marker)
    browser.open(detail)
    ready(browser)
    check('B sees A’s real before record as read-only plain text', browser.js('''
        const card = document.querySelector("#before-comments .comment-card:not(.own)");
        return card.querySelector("h4").textContent === "사용자 A" && card.textContent.includes("읽기 전용")
            && card.querySelector(".comment-body").textContent === arguments[0]
            && !card.querySelector("button, img") && window.commentExecuted === undefined;
    ''', marker))
    save(browser, 'before', 'B의 방문 전')
    partner.open(detail)
    ready(partner)
    check('A sees B’s newly saved before after reopening detail', 'B의 방문 전' in visible_text(partner, 'before') and
          {record['display_name'] for record in records(partner)} == {'사용자 A', '사용자 B'})

    browser.click(action('before', 'delete'))
    key(browser, '\ue00c')
    browser.wait('delete cancel returned focus', 'return document.activeElement.matches(arguments[0]);', action('before', 'delete'))
    check('cancelling deletion by keyboard preserves both records', len(records(browser)) == 2)
    remove(browser, 'before')
    check('B deletes only their own before via 204', [record['content'] for record in records(browser)] == [marker])
    save(browser, 'before', 'B의 새 방문 전')

    browser.click(action('before'))
    browser.fill('#comment-content', '충돌 시 남겨 둘 초안')
    partner.click('#toggle-visit')
    ready(partner)
    browser.click('#save-comment')
    wait_text(browser, '#comment-error', '최신 장소와 코멘트를 다시 불러왔어요.')
    check('a real second browser visit locks a stale before submission and preserves the draft', browser.js('''
        return document.querySelector("#comment-content").value === "충돌 시 남겨 둘 초안" &&
            document.querySelector("#save-comment").disabled &&
            document.querySelector("#toggle-visit").textContent === "미방문으로 변경";
    ''') and '충돌 시 남겨 둘 초안' not in visible_text(browser, 'before'))
    browser.click('#cancel-comment')
    check('both existing before records become read-only after visit', browser.js('''
        return document.querySelectorAll("#before-comments .comment-permission").length === 2 &&
            !document.querySelector("#before-comments button");
    '''))

    # B가 보는 장소 버전은 그대로인 상태에서 A의 After 추가가 복귀를 막는다.
    save(partner, 'after', 'A의 방문 후')
    browser.click('#toggle-visit')
    wait_text(browser, '#action-description', '각 작성자')
    browser.click('.action-dialog button[value=confirmed]')
    ready(browser)
    check('real AFTER_COMMENTS_EXIST refreshes A’s record and explains why revert is blocked',
          'A의 방문 후' in visible_text(browser, 'after') and
          api(browser, endpoint, 'GET')['data']['place']['is_visited'])

    browser.click(action('after'))
    browser.fill('#comment-content', '재시도할 B 초안')
    for status, selector, message in [
        (403, '#comment-error', '권한이 없어요'),
        (422, '#comment-content-error', '격리 서버 검증 오류'),
        (503, '#comment-error', '잠시 사용할 수 없어요'),
        (0, '#comment-error', '네트워크 연결'),
    ]:
        inject(browser, 'PUT', status)
        browser.click('#save-comment')
        wait_text(browser, selector, message)
        check(f'comment save {status or "network error"} preserves input and allows retry', browser.js('''
            return document.querySelector("#comment-content").value === "재시도할 B 초안" &&
                !document.querySelector("#save-comment").disabled;
        '''))
    browser.js('''
        const original = window.fetch;
        window.commentPutCount = 0;
        window.fetch = (path, options) => {
            if (options.method === 'PUT' && path.endsWith('/comments/after')) {
                window.commentPutCount++;
                return new Promise(resolve => {
                    window.releaseComment = () => {
                        window.fetch = original;
                        original(path, options).then(resolve);
                    };
                });
            }
            return original(path, options);
        };
    ''')
    browser.click('#save-comment')
    browser.js('''
        document.querySelector("#comment-form").dispatchEvent(new Event("submit", {cancelable: true}));
    ''')
    check('pending save disables duplicate submit and locks the place controls', browser.js('''
        return window.commentPutCount === 1 && document.querySelector("#save-comment").disabled &&
            document.querySelector("#toggle-visit").disabled && document.querySelector("#comment-content").readOnly;
    '''))
    browser.js('window.releaseComment();')
    ready(browser)
    wait_text(browser, '#comments-notice', '코멘트를 저장했어요.')
    save(browser, 'after', 'B의 수정된 방문 후')
    partner.open(detail)
    ready(partner)
    check('A sees B’s edited after and can only edit their own', 'B의 수정된 방문 후' in visible_text(partner, 'after') and
          partner.js('return !document.querySelector("#after-comments .comment-card:not(.own) button");'))
    remove(partner, 'after')
    partner.click('#toggle-visit')
    wait_text(partner, '#action-description', '각 작성자')
    partner.click('.action-dialog button[value=confirmed]')
    ready(partner)
    check('revert remains blocked when only B’s after survives A’s DELETE', all(
        record['display_name'] == '사용자 B' for record in records(partner) if record['phase'] == 'after') and
        'B의 수정된 방문 후' in visible_text(partner, 'after'))
    remove(browser, 'after')
    browser.click('#toggle-visit')
    ready(browser)
    check('both after records deleted allows revert and restores before editing',
          len(records(browser)) == 2 and all(item['phase'] == 'before' for item in records(browser)) and
          browser.js('return !!document.querySelector(arguments[0]) && !document.querySelector("#after-comments button");',
                     action('before')))

    browser.js('''
        const original = window.fetch;
        window.fetch = (path, options) => {
            if (options.method === 'GET' && path.endsWith('/comments')) {
                window.fetch = original;
                return new Promise(resolve => { window.failRead = () => resolve(new Response(null, {status: 503})); });
            }
            return original(path, options);
        };
    ''')
    browser.click('#toggle-visit')
    wait_text(browser, '#comments-status', '코멘트를 불러오는 중')
    check('loading hides old phase controls while the server snapshot is pending', browser.js('''
        return document.querySelector("#comments").ariaBusy === "true" &&
            document.querySelector("#comment-phases").hidden;
    '''))
    browser.js('window.failRead();')
    wait_text(browser, '#comments-status', '잠시 사용할 수 없어요')
    check('comment query failure shows retry and hides stale records', browser.js('''
        return document.querySelector("#comments-status").role === "alert" &&
            !document.querySelector("#retry-comments").hidden && document.querySelector("#comment-phases").hidden;
    '''))
    browser.click('#retry-comments')
    ready(browser)
    check('retry restores latest visit and before records', 'B의 새 방문 전' in visible_text(browser, 'before') and
          '미방문으로 변경' in browser.js('return document.querySelector("#toggle-visit").textContent;'))
    browser.click('#toggle-visit')
    ready(browser)

    # 실제 저장된 긴 문자열로 그리드, 터치 영역과 수평 스크롤을 검사한다.
    save(browser, 'before', '나' * 1000)

    def inspect(width):
        ready(browser)
        check(f'comment cards and touch targets at {width}px', browser.js('''
            const [own, other] = document.querySelectorAll("#before-comments .comment-card");
            const action = own.querySelector("button").getBoundingClientRect();
            const a = own.getBoundingClientRect(), b = other.getBoundingClientRect();
            return (arguments[0] < 768 ? b.top > a.top && b.left === a.left : b.top === a.top && b.left > a.left)
                && action.width >= 44 && action.height >= 44;
        ''', width))
        browser.js('document.querySelector("#comments-title").scrollIntoView();')
        if width == 390:
            target = browser.command('POST', '/element', {
                'using': 'css selector', 'value': action('before'),
            })
            browser.command('POST', '/actions', {'actions': [{
                'type': 'pointer', 'id': 'touch', 'parameters': {'pointerType': 'touch'}, 'actions': [
                    {'type': 'pointerMove', 'origin': target, 'x': 0, 'y': 0},
                    {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0},
                ],
            }]})
            browser.wait('tap opens comment dialog', 'return document.querySelector("#comment-dialog").open;')
            check('mobile touch opens comment editor without horizontal overflow', browser.js('''
                const box = document.querySelector("#comment-dialog").getBoundingClientRect();
                return box.left >= 0 && box.right <= innerWidth;
            '''))
            key(browser, '\ue00c')

    browser.responsive(detail, '#comments', artifacts, inspect)
    browser.click(action('before'))
    browser.fill('#comment-content', '장소 삭제 중인 초안')
    partner.open(detail)
    ready(partner)
    partner.click('#delete-place')
    partner.click('.action-dialog button[value=confirmed]')
    wait_text(partner, '#save-status', '장소를 삭제했어요.')
    browser.click('#save-comment')
    wait_text(browser, '#comment-error', '장소를 찾을 수 없어요.')
    check('real comment 404 hides stale place and retains draft', browser.js('''
        return document.querySelector("#place-detail").hidden && document.querySelector("#save-comment").disabled &&
            document.querySelector("#comment-content").value === "장소 삭제 중인 초안";
    '''))

    # 복귀할 B 세션은 호출 측에서 1단계 세션 만료 검증에도 계속 사용한다.
    partner.open(url + '/index.html')
    ready_place = api(partner, '/api/places', 'POST', {'title': '세션 만료 격리 검증', 'category': '카페'})['data']['place']
    partner.open(f"{url}/place.html?id={ready_place['id']}")
    ready(partner)
    partner.click(action('before'))
    partner.fill('#comment-content', '세션이 만료된 초안')
    api(partner, '/api/auth/logout', 'POST')
    partner.click('#save-comment')
    wait_text(partner, '#comment-error', '로그인 세션이 만료됐어요.')
    check('real comment 401 hides protected detail and keeps the draft copyable', partner.js('''
        return document.querySelector("#place-detail").hidden && document.querySelector("#save-comment").disabled &&
            !document.querySelector("#comment-sign-in").hidden &&
            document.querySelector("#comment-content").value === "세션이 만료된 초안";
    '''))
    partner.click('#comment-sign-in')
    wait_text(partner, '#form-error', '로그인 세션이 만료됐어요.')
