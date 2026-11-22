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
    const options = {signal: controller.signal};
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
      if (['UPDATE_CONFLICT', 'PLACE_ALREADY_VISITED', 'NOT_FOUND'].includes(error.code)) {
        await loadPlans(dateInput.value);
      }
    }
  } finally {
    writing = false;
    updateControls();
    const replacement = results.querySelector('[data-plan-action="' + control.dataset.planAction + '"]');
    if (replacement?.offsetWidth && !replacement.disabled) replacement.focus();
    else if (mobileAdd.offsetWidth && !mobileAdd.disabled) mobileAdd.focus();
    else dateInput.focus();
  }
}

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

const initial = new URLSearchParams(location.search).get('date');
dateInput.value = isCalendarDate(initial) ? initial : seoulDate();
start();
