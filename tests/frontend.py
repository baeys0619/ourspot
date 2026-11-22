#!/usr/bin/env python3
"""Firefox에서 실제 Nginx·Apache·User/Place API의 프론트 화면을 검증한다."""
import base64
import json
import os
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from auth import check, run_isolated
from frontend_phase2 import verify_place_management
from frontend_phase3 import verify_comments_ui

ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'
WIDTHS = (320, 390, 768, 1440)


class Browser:
    def __init__(self, driver_url):
        self.driver_url = driver_url
        self.session = self.call('POST', '/session', {
            'capabilities': {'alwaysMatch': {'browserName': 'firefox', 'moz:firefoxOptions': {
                'args': ['-headless'],
                'prefs': {'app.update.enabled': False, 'signon.rememberSignons': False},
            }}},
        })['sessionId']

    def call(self, method, path, data=None):
        request = Request(self.driver_url + path, method=method,
                          data=json.dumps(data).encode() if data is not None else None,
                          headers={'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=35) as response:
                return json.load(response)['value']
        except HTTPError as error:
            # WebDriver 오류 본문에는 수행 중인 스크립트나 입력값이 포함될 수 있다.
            kind = json.load(error)['value']['error']
            raise RuntimeError(f'WebDriver {method} {path.split("/")[-1]}: {kind}') from None

    def command(self, method, path, data=None):
        return self.call(method, f'/session/{self.session}' + path, data)

    def js(self, script, *args):
        return self.command('POST', '/execute/sync', {'script': script, 'args': args})

    def wait(self, label, script, *args):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if self.js(script, *args):
                return
            time.sleep(.15)
        raise AssertionError(label)

    def open(self, url):
        self.command('POST', '/url', {'url': url})

    def click(self, selector):
        ref = self.command('POST', '/element', {'using': 'css selector', 'value': selector})[ELEMENT]
        self.command('POST', f'/element/{ref}/click', {})

    def fill(self, selector, value):
        self.js('document.querySelector(arguments[0]).value = arguments[1];', selector, value)

    def screenshot(self, filename, frame=None):
        path = '/screenshot' if frame is None else f'/element/{frame}/screenshot'
        filename.write_bytes(base64.b64decode(self.command('GET', path)))

    def responsive(self, path, screen, artifacts, inspect=None):
        # Firefox의 데스크톱 창 최소 너비(500px) 아래는 같은 출처 iframe의 viewport로 검증한다.
        for width in WIDTHS:
            if width >= 500:
                self.command('POST', '/window/rect', {'width': width, 'height': 950})
                self.open(path)
                self.wait('ready at desktop width', 'return !!document.querySelector(arguments[0])?.offsetHeight;',
                          screen)
                if inspect:
                    inspect(width)
                viewport = self.js('return [innerWidth, document.documentElement.clientWidth, document.documentElement.scrollWidth];')
                if width == 1440:
                    self.screenshot(artifacts / (screen[1:] + '-1440.png'))
            else:
                self.command('POST', '/window/rect', {'width': 600, 'height': 950})
                self.open(path)
                frame = self.js('''
                    const frame = document.createElement('iframe');
                    frame.src = arguments[0];
                    frame.style = `display:block;border:0;width:${arguments[1]}px;height:820px`;
                    document.body.replaceChildren(frame);
                    return frame;
                ''', path, width)[ELEMENT]
                self.command('POST', '/frame', {'id': {ELEMENT: frame}})
                self.wait('ready at mobile width', 'return !!document.querySelector(arguments[0])?.offsetHeight;', screen)
                if inspect:
                    inspect(width)
                viewport = self.js('return [innerWidth, document.documentElement.clientWidth, document.documentElement.scrollWidth];')
                self.command('POST', '/frame', {'id': None})
                if width == 390:
                    self.screenshot(artifacts / (screen[1:] + '-390.png'), frame)
            check(f'{screen} at {width}px has no horizontal overflow (inner/client/scroll: {viewport})',
                  viewport[0] == width and viewport[2] <= viewport[1])


def verify_frontend(browser, url, password_a, password_b, artifacts):
    def wait_text(selector, substring):
        browser.wait(f'{selector} showed expected text',
                     'return document.querySelector(arguments[0])?.textContent.includes(arguments[1]);',
                     selector, substring)

    def sign_in(email, password):
        browser.fill('#email-input', email)
        browser.fill('#password-input', password)
        browser.click('#login-submit')

    browser.open(url + '/')
    wait_text('#form-error', '로그인 세션이 만료됐어요.')
    check('unauthenticated library redirects to login', browser.js('return location.pathname === "/login.html";'))
    browser.responsive(url + '/login.html', '#login-form', artifacts)
    browser.click('#login-submit')
    check('empty form focuses first invalid input', browser.js(
        'return document.activeElement.id === "email-input" && !!document.querySelector("#password-error").textContent;'))

    sign_in('user_a@example.test', 'incorrect-test-value')
    wait_text('#form-error', '이메일 또는 비밀번호')
    check('AUTH_FAILED stays on login without session expiry', browser.js(
        'return location.pathname === "/login.html" && !location.search;'))
    sign_in('user_a@example.test', password_a)
    wait_text('#list-message', '아직 저장한 장소가 없어요.')
    check('auth and API share session and show real empty state', browser.js('''
        return document.querySelector("#current-user").textContent === "사용자 A" &&
            document.querySelector("#unvisited-count").textContent === "0" &&
            document.querySelector("#visited-count").textContent === "0";
    '''))
    browser.screenshot(artifacts / 'empty-1440.png')
    browser.open(url + '/login.html')
    wait_text('#current-user', '사용자 A')
    check('existing session redirects login to library', browser.js('return location.pathname === "/index.html";'))

    browser.click('#add-place')
    browser.wait('native dialog open', 'return document.querySelector("dialog").open;')
    browser.screenshot(artifacts / 'save-1440.png')
    place_title = '<strong>격리 장소</strong>'
    browser.click('#save-place')
    wait_text('#title-error', '장소 이름')
    browser.fill('#place-title', place_title)
    browser.fill('#source-url', 'javascript:void(0)')
    browser.click('#save-place')
    wait_text('#source_url-error', 'HTTP')
    browser.fill('#source-url', 'https://example.test/spot')
    browser.fill('#memo', '<em>격리 메모</em>')
    browser.js('''
        const realFetch = window.fetch;
        window.fetch = (path, options) => {
            if (options.method === 'POST' && path === '/api/places') {
                window.fetch = realFetch;
                options.body = JSON.stringify({...JSON.parse(options.body), category: 'invalid-test-category'});
            }
            return realFetch(path, options);
        };
    ''')
    browser.click('#save-place')
    wait_text('#category-error', '카테고리')
    check('actual server 422 focuses field and preserves form data', browser.js(
        'return document.activeElement.id === "category" && document.querySelector("#place-title").value === arguments[0];',
        place_title))
    browser.click('#save-place')
    wait_text('#places', place_title)
    check('POST creates one place then returns focus and refreshes the list', browser.js('''
        return !document.querySelector("dialog").open && document.activeElement.id === "add-place" &&
            document.querySelectorAll("#places li").length === 1;
    '''))
    check('user content is text and external link has safe attributes', browser.js('''
        const link = document.querySelector("#selected-place dl a");
        return !document.querySelector("#places strong, #selected-place em") &&
            document.querySelector("#selected-place dl").textContent.includes("<em>격리 메모</em>") &&
            link.protocol === "https:" && link.target === "_blank" &&
            link.relList.contains("noopener") && link.relList.contains("noreferrer");
    '''))
    browser.click('[data-status=visited]')
    wait_text('#list-message', '다녀온 곳이 없어요.')
    check('visited filter empty with couple-wide counts', browser.js(
        'return document.querySelector("#unvisited-count").textContent === "1";'))

    # 예정·방문 테스트 데이터는 격리 API에만 기록한다. 프론트에는 조회 동작만 존재한다.
    visited_fixture = '''
        const done = arguments[arguments.length - 1];
        const request = async (path, method, body) => (await fetch(path, {
            method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
        })).json();
        (async () => {
            const {data: {place}} = await request('/api/places', 'POST', {title: '격리 방문 완료 장소', category: '놀거리'});
            const result = await request('/api/places/' + place.id, 'PATCH', {
                is_visited: true, expected_updated_at: place.updated_at
            });
            done(result.data.place.is_visited);
        })().catch(() => done(false));
    '''
    check('isolated API creates visited fixture', browser.command(
        'POST', '/execute/async', {'script': visited_fixture, 'args': []}))
    browser.open(url + '/index.html')
    browser.wait('library ready', 'return document.querySelectorAll("#places li").length === 1;')
    browser.js('''
        const realFetch = window.fetch;
        window.fetch = (path, options) => {
            if (path.startsWith('/api/places?')) {
                window.fetch = realFetch;
                return Promise.reject(new TypeError('isolated offline simulation'));
            }
            return realFetch(path, options);
        };
    ''')
    browser.click('[data-status=visited]')
    wait_text('#list-message', '장소를 불러오지 못했어요.')
    browser.click('#list-message button')
    wait_text('#places', '격리 방문 완료 장소')
    check('retry retains selected filter and visited badge', browser.js('''
        return document.querySelector('[data-status=visited]').getAttribute('aria-pressed') === 'true' &&
            document.querySelector('#places .visited').textContent === '방문 완료';
    '''))
    browser.responsive(url + '/index.html', '#places', artifacts)

    # 화면 크기 확인과 별도로 실제 작은 viewport에서 상세 링크 이동을 검증한다.
    browser.open(url + '/index.html')
    browser.command('POST', '/window/rect', {'width': 600, 'height': 950})
    frame = browser.js('''
        const frame = document.createElement('iframe');
        frame.src = '/index.html';
        frame.style = 'width:390px;height:820px;border:0';
        document.body.replaceChildren(frame);
        return frame;
    ''')[ELEMENT]
    browser.command('POST', '/frame', {'id': {ELEMENT: frame}})
    wait_text('#places', place_title)
    check('mobile save button spans the content width', browser.js('''
        return document.querySelector('#add-place').offsetWidth === document.querySelector('#main').clientWidth;
    '''))
    browser.click('#places .place-row a')
    wait_text('#detail-title', place_title)
    check('mobile card opens standalone place detail', browser.js(
        'return location.pathname === "/place.html" && document.querySelector("#detail-fields").textContent.includes("사용자 A");'))
    browser.command('POST', '/frame', {'id': None})
    browser.open(url + '/index.html')
    wait_text('#current-user', '사용자 A')
    browser.click('#logout')
    browser.wait('logout navigated to login', 'return location.pathname === "/login.html" && !location.search;')
    check('logout skips JSON parsing for 204 and displays login', browser.js('return !location.search;'))
    browser.wait('login form visible', 'return !document.querySelector("#login-form").hidden;')
    sign_in('user_b@example.test', password_b)
    wait_text('#places', place_title)
    check('account B sees account A’s registered place', browser.js(
        'return document.querySelector("#places").textContent.includes("사용자 A") && document.querySelector("#current-user").textContent === "사용자 B";'))
    verify_place_management(browser, url, password_a, password_b, artifacts, place_title, sign_in, wait_text)
    with firefox(artifacts / 'partner-webdriver.log') as partner:
        verify_comments_ui(browser, partner, url, password_a, artifacts)
    browser.open(url + '/index.html')
    wait_text('#current-user', '사용자 B')
    check('Redis session invalidated through the API', browser.command('POST', '/execute/async', {'script': '''
        const done = arguments[0];
        fetch('/api/auth/logout', {method: 'POST'}).then(response => done(response.status === 204));
    ''', 'args': []}))
    browser.click('[data-status=visited]')
    wait_text('#form-error', '로그인 세션이 만료됐어요.')
    check('protected API AUTH_REQUIRED clears place data and redirects', browser.js(
        'return location.search === "?reason=expired" && !document.querySelector("#places");'))
    browser.open(url + '/plans.html')
    wait_text('#form-error', '로그인 세션이 만료됐어요.')
    check('anonymous direct plan access redirects to login', browser.js(
        'return location.pathname === "/login.html" && !document.querySelector("#plan-list");'))


@contextmanager
def firefox(log_path):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    args = ['geckodriver', '--host', '127.0.0.1', '--port', str(port), '--log', 'error']
    if profile_root := os.environ.get('OURSPOT_FIREFOX_PROFILE_ROOT'):
        args.extend(['--profile-root', profile_root])
    with log_path.open('w') as log:
        driver = subprocess.Popen(args, stdout=log, stderr=log)
        driver_url = f'http://127.0.0.1:{port}'
        try:
            for _ in range(40):
                if driver.poll() is not None:
                    raise RuntimeError('geckodriver exited before serving')
                try:
                    with urlopen(driver_url + '/status', timeout=1):
                        break
                except URLError:
                    time.sleep(.25)
            browser = Browser(driver_url)
            try:
                yield browser
            finally:
                browser.command('DELETE', '')
        finally:
            driver.terminate()
            driver.wait(timeout=10)


def main():
    artifacts = Path(tempfile.mkdtemp(prefix='ourspot-frontend-browser-'))
    print(f'검증 파일 {artifacts}', flush=True)
    with firefox(artifacts / 'webdriver.log') as browser:
        run_isolated(front_image='ourspot-front:0.4', on_ready=lambda url, a, b:
                     verify_frontend(browser, url, a, b, artifacts))


if __name__ == '__main__':
    main()
