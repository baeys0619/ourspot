import {fetchJSON} from './api.js';
import {element, formatPlannedDate, formatTimestamp, placeFields, placeFormValues, placeStatus, seoulDate, setPending, showFieldErrors, tag} from './components.js';
import {actionDialog, assignDate} from './place-actions.js';
import {requireUser, returnToLogin, sessionExpired} from './session.js';

const byId = id => document.getElementById(id);
const results = byId('results');
const list = byId('places');
const selection = byId('selected-place');
const message = byId('list-message');
const sort = byId('sort');
const filters = document.querySelectorAll('[data-status]');
const addPlace = byId('add-place');
const dialog = byId('place-dialog');
const form = byId('place-form');
const submit = byId('save-place');
const cancel = byId('cancel-save');
const saveError = byId('save-error');
const savedNotice = byId('save-status');
const scheduleError = byId('schedule-error');
const desktop = window.matchMedia('(min-width: 768px)');
let status = 'unvisited';
let selectedId;
let request;
let noticeTimer;
let assigning = false;

function showMessage(title = '', description = '', action, error = false) {
  message.replaceChildren();
  message.classList.toggle('error', error);
  message.setAttribute('role', error ? 'alert' : 'status');
  if (title) message.append(element('h2', title));
  if (description) message.append(element('p', description));
  if (action) message.append(action);
}

function actionButton(label, action, style = 'secondary') {
  const button = element('button', label, 'button ' + style);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

// 선택한 행과 오른쪽 상세 영역을 함께 갱신한다. 예정일이 있으면 그 일정으로 연결하고, 미방문·미배정 장소에는 추가 버튼을 표시한다.
function renderSelected(place) {
  selectedId = place.id;
  for (const link of list.querySelectorAll('a')) {
    if (Number(link.dataset.id) === selectedId) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }

  const tags = element('div', undefined, 'tags');
  tags.append(tag(place.category), tag(...placeStatus(place)));
  const fields = element('dl', undefined, 'place-fields');
  fields.append(...placeFields(place));
  const detail = element('a', '장소 상세 보기', 'button secondary');
  detail.href = '/place.html?id=' + place.id;

  const actions = element('div', undefined, 'selected-actions');
  if (place.planned_date) {
    const plan = element('a', formatPlannedDate(place.planned_date) + ' 일정 보기', 'button primary');
    plan.href = '/plans.html?' + new URLSearchParams({date: place.planned_date});
    actions.append(plan);
  } else if (!place.is_visited) {
    actions.append(actionButton('일정에 추가', event => addToSchedule(place, event.currentTarget), 'primary'));
  }
  actions.append(detail);
  selection.replaceChildren(element('p', '선택한 장소', 'muted'), element('h2', place.title), tags, fields, actions);
  selection.hidden = false;
}

// 선택한 장소에 날짜를 배정한다. 화면에 남은 정보가 최신 상태와 어긋난 경우 보관함을 다시 불러온다.
async function addToSchedule(place, button) {
  if (assigning) return;
  assigning = true;
  scheduleError.textContent = '';
  try {
    const date = await actionDialog({
      title: '일정에 추가', description: place.title + '을(를) 방문할 날짜를 정해 주세요.',
      date: seoulDate(), confirm: '추가하기',
    });
    if (!date) return;
    button.disabled = true;
    if (await assignDate(place, date)) {
      savedNotice.textContent = '일정을 저장했어요.';
      await loadPlaces();
      selection.querySelector('a[href^="/plans.html"]')?.focus();
    }
  } catch (error) {
    if (sessionExpired(error)) returnToLogin(true);
    else {
      scheduleError.textContent = error.status < 500 ? error.message : '일정을 저장하지 못했어요. 다시 시도해 주세요.';
      if (['UPDATE_CONFLICT', 'PLACE_ALREADY_VISITED', 'NOT_FOUND'].includes(error.code)) await loadPlaces();
    }
  } finally {
    assigning = false;
    button.disabled = false;
    if (button.isConnected) button.focus();
  }
}

// 탭의 건수는 커플 전체 기준이다. 현재 탭이 비어 있는 경우와 보관함 전체가 비어 있는 경우의 안내를 구분한다.
function renderPlaces({places, counts}) {
  byId('unvisited-count').textContent = counts.unvisited;
  byId('visited-count').textContent = counts.visited;
  if (!places.length) {
    if (counts.unvisited + counts.visited === 0) {
      showMessage('장소 없음', '아직 저장한 장소가 없어요. 첫 장소를 저장해 보세요.',
        actionButton('장소 저장', openForm, 'primary'));
    } else {
      const unvisited = status === 'unvisited';
      showMessage(unvisited ? '가볼 곳이 없어요.' : '다녀온 곳이 없어요.',
        unvisited ? '다녀온 곳 탭에서 저장한 장소를 볼 수 있어요.' : '가볼 곳 탭에서 저장한 장소를 볼 수 있어요.');
    }
    return;
  }

  showMessage();
  const fragment = document.createDocumentFragment();
  for (const place of places) {
    const row = element('li', undefined, 'place-row');
    const link = element('a');
    link.href = '/place.html?id=' + place.id;
    link.dataset.id = place.id;
    link.append(
      element('span', place.title, 'row-title'),
      element('span', '상세 ›', 'row-more mobile'),
      element('span', place.category + ' · ' + place.added_by_name + ' · ' + formatTimestamp(place.created_at), 'row-meta'),
      tag(...placeStatus(place)),
    );
    link.addEventListener('click', event => {
      // 작은 화면과 새 탭 열기는 실제 상세 URL을 사용한다.
      if (!desktop.matches || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      renderSelected(place);
    });
    row.append(link);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
  renderSelected(places.find(place => place.id === selectedId) || places[0]);
  byId('library-note').hidden = status !== 'unvisited' || sort.value !== 'oldest';
}

async function loadPlaces() {
  // 탭이나 정렬이 바뀌면 진행 중이던 목록 요청을 취소한다.
  request?.abort();
  const controller = new AbortController();
  request = controller;
  results.setAttribute('aria-busy', 'true');
  list.replaceChildren();
  selection.hidden = true;
  byId('library-note').hidden = true;
  const skeleton = element('div', undefined, 'skeleton');
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.append(element('span'), element('span'), element('span'));
  showMessage('장소를 불러오는 중…', '', skeleton);

  // 서버가 방문 상태를 필터링한다. 오래된 순을 선택했을 때만 sort를 보내고, 최근 순은 API의 기본값을 쓴다.
  const query = new URLSearchParams({status});
  if (sort.value === 'oldest') query.set('sort', sort.value);
  try {
    const data = await fetchJSON('/api/places?' + query, {signal: controller.signal});
    // 응답, 오류, 로딩 종료 모두 현재 요청에만 반영한다. 취소 시점에 이전 응답 처리가 시작됐을 수 있다.
    if (request === controller) renderPlaces(data);
  } catch (error) {
    if (request !== controller) return;
    if (sessionExpired(error)) returnToLogin(true);
    else showMessage('장소를 불러오지 못했어요.', '연결을 확인한 뒤 다시 시도해 주세요.',
      actionButton('다시 시도', loadPlaces), true);
  } finally {
    if (request === controller) results.setAttribute('aria-busy', 'false');
  }
}

// 탭을 바꿀 때 미방문은 오래된 순, 방문 완료는 최근 순으로 정렬 기본값을 되돌린다.
function activateFilter(button, nextSelection) {
  status = button.dataset.status;
  selectedId = nextSelection;
  sort.value = status === 'unvisited' ? 'oldest' : 'latest';
  for (const filter of filters) filter.setAttribute('aria-pressed', String(filter === button));
  loadPlaces();
}

for (const filter of filters) {
  filter.addEventListener('click', () => {
    if (status !== filter.dataset.status) activateFilter(filter);
  });
}
sort.addEventListener('change', loadPlaces);

// 등록창을 새로 열 때는 지난 입력과 오류를 지운다. 요청에 실패해서 창이 계속 열려 있을 때는 입력이 그대로 남는다.
function openForm() {
  if (dialog.open) return;
  form.reset();
  saveError.textContent = '';
  showFieldErrors(form);
  dialog.showModal();
}

addPlace.addEventListener('click', openForm);
cancel.addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => {
  if (submit.disabled) event.preventDefault();
});
dialog.addEventListener('close', () => {
  form.reset();
  addPlace.focus();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;

  const {values, errors} = placeFormValues(form);
  saveError.textContent = '';
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) return;

  setPending(submit, true, '장소 저장', '저장 중…');
  // 전송할 값을 읽은 뒤 입력과 취소를 잠근다. 저장 중에 폼이 바뀌거나 같은 요청이 다시 나가는 일을 막는다.
  const inputs = form.querySelectorAll('input, select, textarea, #cancel-save');
  for (const input of inputs) input.disabled = true;
  let failure;
  try {
    const {place} = await fetchJSON('/api/places', {
      method: 'POST', body: values,
    });
    dialog.close();
    savedNotice.textContent = '저장했어요.';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { savedNotice.textContent = ''; }, 3000);
    // 새 장소는 미방문으로 생성된다. 성공 후 미방문 목록을 조회해 방금 저장한 장소를 선택한다.
    if (status !== 'unvisited') activateFilter(filters[0], place.id);
    else {
      selectedId = place.id;
      loadPlaces();
    }
  } catch (error) {
    failure = error;
  } finally {
    for (const input of inputs) input.disabled = false;
    setPending(submit, false, '장소 저장', '저장 중…');
  }
  // 실패하면 모달을 유지하고 서버에서 돌려준 필드 오류를 표시한다. 인증이 만료된 경우에만 보호 화면을 비우고 이동한다.
  if (!failure) return;
  if (sessionExpired(failure)) {
    returnToLogin(true);
    return;
  }
  saveError.textContent = failure.status && failure.status < 500 ? failure.message :
    '저장하지 못했어요. 다시 시도해 주세요.';
  showFieldErrors(form, failure.fieldErrors);
});

async function start() {
  try {
    await requireUser();
    if (new URLSearchParams(location.search).get('notice') === 'place-deleted') {
      savedNotice.textContent = '장소를 삭제했어요.';
      history.replaceState(null, '', '/index.html');
    }
    byId('library-toolbar').hidden = false;
    addPlace.disabled = false;
    loadPlaces();
  } catch (error) {
    results.setAttribute('aria-busy', 'false');
    if (sessionExpired(error)) returnToLogin(true);
    else showMessage('로그인 상태를 확인하지 못했어요.', '', actionButton('다시 시도', start), true);
  }
}

start();
