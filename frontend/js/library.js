import {fetchJSON} from './api.js';
import {element, formatTimestamp, placeFields, placeStatus, setPending, showFieldErrors, tag, webUrl} from './components.js';
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
const desktop = window.matchMedia('(min-width: 768px)');
let status = 'unvisited';
let selectedId;
let request;
let noticeTimer;

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

  selection.replaceChildren(element('p', '선택한 장소', 'muted'), element('h2', place.title), tags, fields, detail);
  selection.hidden = false;
}

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
  // 빠른 필터 전환에서 늦게 도착한 응답이 현재 탭을 덮지 않도록 이전 요청을 취소한다.
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

  const query = new URLSearchParams({status});
  if (sort.value === 'oldest') query.set('sort', sort.value);
  try {
    const data = await fetchJSON('/api/places?' + query, {signal: controller.signal});
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

  const fields = new FormData(form);
  const title = String(fields.get('title')).trim();
  const category = String(fields.get('category'));
  const source = String(fields.get('source_url')).trim();
  const memo = String(fields.get('memo'));
  const errors = {};
  saveError.textContent = '';
  if (!title || [...title].length > 120) errors.title = '장소 이름을 1~120자로 입력해 주세요.';
  if (!category) errors.category = '카테고리를 선택해 주세요.';
  if (source && !webUrl(source)) errors.source_url = '2048자 이하의 HTTP 또는 HTTPS URL을 입력해 주세요.';
  if ([...memo].length > 1000) errors.memo = '메모를 1000자 이하로 입력해 주세요.';
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) return;

  setPending(submit, true, '장소 저장', '저장 중…');
  const inputs = form.querySelectorAll('input, select, textarea, #cancel-save');
  for (const input of inputs) input.disabled = true;
  let failure;
  try {
    const {place} = await fetchJSON('/api/places', {
      method: 'POST', body: {title, category, source_url: source || null, memo: memo.trim() ? memo : null},
    });
    dialog.close();
    savedNotice.textContent = '저장했어요.';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { savedNotice.textContent = ''; }, 3000);
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
