import {fetchJSON} from './api.js';
import {element, formatPlannedDate, isCalendarDate, seoulDate, tag} from './components.js';
import {actionDialog, assignDate, patchPlace} from './place-actions.js';
import {requireUser, returnToLogin, sessionExpired} from './session.js';

const byId = id => document.getElementById(id);
const dateInput = byId('plan-date');
const results = byId('plan-results');
const list = byId('plan-list');
const panel = byId('plan-candidates');
const candidateList = byId('candidate-list');
const picker = byId('candidate-dialog');
const mobileAdd = byId('open-candidates');
const status = byId('plan-status');
const notice = byId('plan-notice');
const layout = matchMedia('(min-width: 768px)');
let request;
let ready = false;
let writing = false;

function button(label, className, action) {
  const node = element('button', label, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

// 조회가 끝나기 전에는 일정 변경을 막는다. 쓰기 중에는 날짜도 고정한다.
// 첫째 장소의 올리기와 마지막 장소의 내리기는 조회가 끝나도 비활성 상태로 둔다.
function updateControls() {
  results.setAttribute('aria-busy', String(writing || Boolean(request)));
  dateInput.disabled = writing || byId('account').hidden;
  mobileAdd.disabled = writing || !ready;
  for (const control of document.querySelectorAll('[data-plan-action]')) {
    control.disabled = writing || !ready || control.dataset.boundary === 'true';
  }
}

function feedback(message, error = false) {
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.className = 'feedback ' + (error ? 'error' : 'success');
  notice.textContent = message;
}

function planAction(label, className, place, kind, action, limit = false) {
  const control = button(label, className, action);
  control.dataset.planAction = place.id + '-' + kind;
  control.dataset.boundary = String(limit);
  return control;
}

// 서버가 방문 순서로 정렬한 목록에는 방문 완료 장소도 포함된다.
// 순서 변경은 대상 장소의 버전과 새 번호로 요청한다. 다른 장소의 번호는 서버가 함께 조정한다.
function renderPlan(places) {
  byId('plan-count').textContent = places.length + '곳';
  byId('plan-count').hidden = false;
  list.replaceChildren();
  if (!places.length) {
    status.setAttribute('role', 'status');
    status.append(element('p', '이 날짜에는 계획이 없어요.'));
    status.hidden = false;
  }
  for (const [index, place] of places.entries()) {
    const row = element('li', undefined, 'plan-row');
    const number = element('span', String(place.visit_order).padStart(2, '0'), 'plan-number');
    number.setAttribute('aria-label', '방문 순서 ' + place.visit_order);
    const title = element('a', place.title, 'plan-place-link');
    title.href = '/place.html?id=' + place.id;
    const info = element('div', undefined, 'plan-place-info');
    info.append(title, element('p', place.category + (place.memo ? ' · ' + place.memo : ''), 'muted plan-place-meta'));
    if (place.is_visited) info.append(tag('방문 완료', 'visited'));
    const controls = element('div', undefined, 'plan-row-actions');
    for (const [delta, arrow, kind, limit] of [[-1, '↑', 'up', index === 0], [1, '↓', 'down', index === places.length - 1]]) {
      const order = planAction(arrow, 'button order-button', place, kind, () => mutate(order,
        () => patchPlace(place, {visit_order: place.visit_order + delta}), '방문 순서를 변경했어요.'), limit);
      order.setAttribute('aria-label', place.title + (delta < 0 ? ' 순서 올리기' : ' 순서 내리기'));
      order.append(element('span', ' 순서', 'mobile'));
      controls.append(order);
    }
    // 제외는 날짜를 비우는 수정이다. 장소 삭제 API를 부르지 않으므로 보관함과 코멘트는 그대로 남는다.
    const remove = planAction('일정에서 제외', 'text-button', place, 'remove', () => mutate(remove, async () => {
      const confirmed = await actionDialog({
        title: '일정에서 제외할까요?',
        description: place.title + '이(가) ' + formatPlannedDate(place.planned_date) +
          ' 일정에서만 빠져요. 보관함의 장소 정보와 코멘트는 그대로 남아요.',
        confirm: '일정에서 제외',
      });
      if (confirmed) return patchPlace(place, {planned_date: null});
    }, '일정에서 제외했어요.'));
    remove.setAttribute('aria-label', place.title + ' 일정에서 제외');
    controls.append(remove);
    row.append(number, info, controls);
    list.append(row);
  }
}

// 미방문 목록에서 이미 보고 있는 날짜에 배정된 장소를 뺀다.
// 다른 날짜에 배정된 장소는 후보에 남기고, 추가할 때 이동 여부를 묻는다.
function renderCandidates(places, date) {
  candidateList.replaceChildren();
  const candidates = places.filter(place => place.planned_date !== date);
  if (!candidates.length) candidateList.append(element('li', '추가할 수 있는 장소가 없어요.', 'muted'));
  for (const place of candidates) {
    const row = element('li', undefined, 'candidate-row');
    const info = element('div');
    info.append(element('p', place.title, 'candidate-title'), element('p', place.category +
      (place.planned_date ? ' · ' + formatPlannedDate(place.planned_date) + ' 예정' : ''), 'muted'));
    const add = planAction('추가 +', 'text-button accent', place, 'add', () => {
      if (picker.open) picker.close();
      mutate(add, () => assignDate(place, date), '일정을 저장했어요.');
    });
    add.setAttribute('aria-label', place.title + ' 추가');
    row.append(info, add);
    candidateList.append(row);
  }
}

async function loadPlans(date) {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  ready = false;
  updateControls();
  status.replaceChildren();
  status.setAttribute('role', 'status');
  status.hidden = true;
  try {
    if (!isCalendarDate(date)) {
      list.replaceChildren();
      candidateList.replaceChildren();
      byId('plan-count').hidden = true;
      status.textContent = '날짜를 선택해 주세요.';
      status.hidden = false;
      return;
    }
    status.textContent = '일정을 불러오는 중…';
    status.hidden = false;
    // 두 조회는 별도 요청이다. 나중에 장소를 바꿀 때는 각 행에서 받은 버전을 서버가 다시 확인한다.
    const options = {signal: controller.signal};
    // 선택한 날짜의 일정과 미방문 후보를 동시에 요청한다.
    // 이전 요청은 취소하되, 두 응답이 이미 도착했더라도 현재 요청인지 다시 확인한다.
    const [{places}, {places: candidates}] = await Promise.all([
      fetchJSON('/api/places?' + new URLSearchParams({planned_date: date}), options),
      fetchJSON('/api/places?status=unvisited', options),
    ]);
    if (request !== controller) return;
    status.replaceChildren();
    status.hidden = true;
    renderPlan(places);
    renderCandidates(candidates, date);
    ready = true;
    return true;
  } catch (error) {
    if (request !== controller) return;
    controller.abort();
    if (sessionExpired(error)) returnToLogin(true);
    else {
      status.setAttribute('role', 'alert');
      status.replaceChildren(element('p', '일정을 불러오지 못했어요.'),
        button('다시 시도', 'button secondary', () => loadPlans(date)));
      status.hidden = false;
    }
  } finally {
    if (request === controller) {
      request = undefined;
      updateControls();
    }
  }
}

// 확인창을 여는 순간부터 조회가 끝날 때까지 다른 일정 변경을 막는다.
// 성공했거나 장소 정보가 오래된 경우 현재 날짜를 다시 읽어 서버가 정한 순서와 후보를 표시한다.
async function mutate(control, change, success) {
  if (writing || !ready) return;
  writing = true;
  updateControls();
  feedback('');
  try {
    if (await change()) {
      feedback(success);
      await loadPlans(dateInput.value);
    }
  } catch (error) {
    if (sessionExpired(error)) returnToLogin(true);
    else {
      feedback(error.status < 500 ? error.message : '일정을 변경하지 못했어요. 다시 시도해 주세요.', true);
      // 충돌이나 대상의 상태 변경을 알게 되면 목록만 다시 읽는다. 사용자가 새 상태를 보고 다음 작업을 결정한다.
      if (['UPDATE_CONFLICT', 'PLACE_ALREADY_VISITED', 'NOT_FOUND'].includes(error.code)) {
        await loadPlans(dateInput.value);
      }
    }
  } finally {
    writing = false;
    updateControls();
    // 목록을 다시 그리면 원래 버튼이 사라질 수 있다. 같은 장소의 같은 버튼을 먼저 찾아 포커스를 돌려준다.
    const replacement = results.querySelector('[data-plan-action="' + control.dataset.planAction + '"]');
    if (replacement?.offsetWidth && !replacement.disabled) replacement.focus();
    else if (mobileAdd.offsetWidth && !mobileAdd.disabled) mobileAdd.focus();
    else dateInput.focus();
  }
}

// 날짜를 바꾸면 이전 목록과 건수를 비운다. 유효한 날짜는 주소에도 넣어 새로고침 뒤 같은 일정을 열 수 있게 한다.
function selectDate() {
  const date = dateInput.value;
  feedback('');
  byId('plan-title-date').textContent = isCalendarDate(date) ? formatPlannedDate(date) + ', 어디부터 갈까?' : '데이트 계획';
  byId('plan-date-short').textContent = isCalendarDate(date) ? formatPlannedDate(date) + ' · ' : '';
  list.replaceChildren();
  candidateList.replaceChildren();
  byId('plan-count').hidden = true;
  if (isCalendarDate(date)) history.replaceState(null, '', '/plans.html?' + new URLSearchParams({date}));
  loadPlans(date);
}

// 작은 화면에서는 기존 후보 목록을 모달 안으로 옮긴다. 목록을 복제하지 않아 조회 결과와 버튼 상태를 함께 유지할 수 있다.
mobileAdd.addEventListener('click', () => {
  byId('candidate-dialog-body').append(panel);
  picker.showModal();
});
byId('close-candidates').addEventListener('click', () => picker.close());
picker.addEventListener('close', () => {
  byId('candidate-sidebar').append(panel);
  mobileAdd.focus();
});
layout.addEventListener('change', () => {
  if (layout.matches && picker.open) picker.close();
});
dateInput.addEventListener('change', selectDate);

async function start() {
  try {
    await requireUser();
    selectDate();
  } catch (error) {
    if (sessionExpired(error)) returnToLogin(true);
    else {
      status.setAttribute('role', 'alert');
      status.replaceChildren(element('p', '로그인 상태를 확인하지 못했어요.'), button('다시 시도', 'button secondary', start));
    }
  }
}

// 주소에 유효한 날짜가 있으면 그 일정을 열고, 그 외에는 서울 기준 오늘을 선택한다.
const initial = new URLSearchParams(location.search).get('date');
dateInput.value = isCalendarDate(initial) ? initial : seoulDate();
start();
