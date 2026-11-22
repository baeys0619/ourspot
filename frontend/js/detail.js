import {fetchJSON} from './api.js';
import {createComments} from './comments.js';
import {element, formatPlannedDate, placeFields, placeFormValues, showFieldErrors, tag} from './components.js';
import {actionDialog, deletePlace, patchPlace} from './place-actions.js';
import {requireUser, returnToLogin, sessionExpired} from './session.js';

const byId = id => document.getElementById(id);
const status = byId('detail-status');
const notice = byId('detail-notice');
const article = byId('place-detail');
const edit = byId('edit-place');
const remove = byId('delete-place');
const visit = byId('toggle-visit');
const dialog = byId('place-dialog');
const form = byId('place-form');
const formError = byId('save-error');
const submit = byId('save-place');
const formLatest = byId('edit-latest');
const id = new URLSearchParams(window.location.search).get('id');
let place;
let comments;
let busy = false;
let editBase;
const editFields = ['title', 'category', 'source_url', 'memo'];

// 장소 변경과 코멘트 쓰기가 겹치면 방문 상태를 기준으로 하는 편집 조건이 달라질 수 있다.
// 같은 화면의 변경 버튼과 폼은 진행 중인 작업에 맞춰 잠근다.
function updateControls() {
  const locked = busy || Boolean(comments?.pending);
  article.setAttribute('aria-busy', String(busy));
  for (const button of [edit, remove, visit]) button.disabled = locked || !place;
  for (const control of form.elements) control.disabled = busy;
  submit.disabled = locked || !place;
  comments?.updateControls(busy);
}

function render() {
  byId('detail-title').textContent = place.title;
  const tags = byId('detail-tags');
  tags.replaceChildren(tag(place.category), tag(place.is_visited ? '방문 완료' : '미방문', place.is_visited ? 'visited' : 'unvisited'));
  if (place.planned_date) tags.append(tag(formatPlannedDate(place.planned_date) + ' 예정', 'planned'));
  byId('detail-fields').replaceChildren(...placeFields(place, true));
  visit.textContent = place.is_visited ? '미방문으로 변경' : '방문 완료로 변경';
  status.hidden = true;
  article.hidden = false;
}

// 처음 진입할 때 로그인 사용자로 코멘트 화면을 준비한다.
// 이후 코멘트 조회에서도 이 함수를 호출해 장소 버전과 방문 상태를 다시 확인한다.
async function loadPlace() {
  try {
    if (!comments) {
      const user = await requireUser();
      comments = createComments({
        user, getPlace: () => place, loadPlace, reload: refreshDetail, onMissing: showMissing,
        onPending: updateControls,
        onExpired: () => {
          place = undefined;
          article.hidden = true;
          byId('account').hidden = true;
        },
      });
    }
    if (!/^[1-9]\d*$/.test(id || '') || Number(id) > 2147483647) {
      showMissing();
      return;
    }
    ({place} = await fetchJSON('/api/places/' + id));
    render();
    return true;
  } catch (error) {
    place = undefined;
    if (sessionExpired(error)) {
      if (comments) comments.expire();
      else returnToLogin(true);
    }
    else if (error.status === 404) showMissing();
    else {
      article.hidden = true;
      const retry = element('button', '다시 시도', 'button secondary');
      retry.addEventListener('click', start);
      status.setAttribute('role', 'alert');
      status.replaceChildren(element('p', '장소를 불러오지 못했어요.'), retry);
      status.hidden = false;
    }
  }
}

async function refreshDetail() {
  return await loadPlace() && await comments.refresh();
}

// 장소가 없거나 접근할 수 없으면 상세와 수정창을 닫고 같은 안내를 표시한다.
function showMissing() {
  place = undefined;
  comments?.missing();
  if (dialog.open) dialog.close();
  article.hidden = true;
  status.setAttribute('role', 'alert');
  status.textContent = '장소를 찾을 수 없어요.';
  status.hidden = false;
}

async function start() {
  if (busy || comments?.pending) return;
  busy = true;
  updateControls();
  try {
    await refreshDetail();
    if (place && dialog.open) showLatestInForm();
  } finally {
    busy = false;
    updateControls();
  }
}

function feedback(message, error = false) {
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.className = 'feedback ' + (error ? 'error' : 'success');
  notice.textContent = message;
}

function editableValues(current) {
  return {title: current.title, category: current.category, source_url: current.source_url ?? '',
    memo: (current.memo ?? '').replace(/\r\n?/g, '\n')};
}

function showLatestInForm() {
  // 이전에 읽은 값 그대로인 필드만 서버의 최신 값으로 교체한다.
  // 직접 바꾼 입력은 유지하고, 현재 저장된 내용을 따로 표시해 다시 비교할 수 있게 한다.
  const latest = editableValues(place);
  for (const key of editFields) {
    if (form.elements[key].value === editBase[key]) form.elements[key].value = latest[key];
  }
  editBase = latest;
  const labels = {title: '장소명', category: '카테고리', source_url: 'URL', memo: '메모'};
  formLatest.replaceChildren(element('p', '현재 저장된 정보'));
  for (const [key, label] of Object.entries(labels)) {
    formLatest.append(element('p', label + ' · ' + (place[key] || '없음')));
  }
  formLatest.hidden = false;
}

// 수정·방문 변경·삭제를 한 번에 하나씩 처리한다. 버전 충돌 시 현재 장소를 다시 읽고 저장은 사용자가 다시 요청한다.
async function change(action, {refreshOnUncertainResult = false} = {}) {
  if (busy || comments?.pending || !place) return;
  busy = true;
  updateControls();
  feedback('');
  try {
    await action(place);
  } catch (error) {
    if (sessionExpired(error)) {
      returnToLogin(true);
    } else if (error.code === 'UPDATE_CONFLICT') {
      feedback(error.message, true);
      await refreshDetail();
      if (dialog.open) {
        formError.textContent = error.message;
        if (place) showLatestInForm();
        else {
          formError.append(' 최신 정보를 다시 불러와 주세요. ',
            Object.assign(element('button', '다시 시도', 'text-button'), {type: 'button', onclick: start}));
        }
      }
    } else if (error.code === 'AFTER_COMMENTS_EXIST') {
      // 최신 상태와 기록을 표시한 뒤, 각 작성자가 자기 방문 후 기록을 먼저 지워야 한다고 안내한다.
      await refreshDetail();
      if (!place) return;
      await actionDialog({
        title: '미방문으로 변경할 수 없어요',
        description: '방문 후 코멘트가 남아 있어요. 각 작성자가 자신의 방문 후 기록을 먼저 삭제해야 미방문으로 바꿀 수 있어요.',
        confirm: '확인', style: 'secondary', cancel: false,
      });
    } else if (error.status === 404) {
      showMissing();
    } else if (refreshOnUncertainResult && (!error.status || error.status >= 500)) {
      // 응답이 끊기거나 서버 오류가 나도 변경이 저장됐을 수 있다. 같은 요청을 다시 보내는 대신 방문 상태를 조회한다.
      const wasVisited = place.is_visited;
      const refreshed = await refreshDetail();
      if (!refreshed) feedback('방문 상태 변경을 확인하지 못했어요. 다시 시도해 주세요.', true);
      else feedback(place.is_visited !== wasVisited ?
        '방문 상태 변경 응답을 확인하지 못해 최신 상태를 다시 불러왔어요.' :
        '방문 상태를 변경하지 못했어요. 다시 시도해 주세요.', true);
    } else if (dialog.open) {
      formError.textContent = error.status < 500 ? error.message : '저장하지 못했어요. 다시 시도해 주세요.';
      return error.fieldErrors;
    } else {
      feedback(error.status < 500 ? error.message : '변경하지 못했어요. 다시 시도해 주세요.', true);
    }
  } finally {
    busy = false;
    updateControls();
  }
}

// 폼을 열 때의 값을 저장해 둔다. 이후 재조회가 필요해지면 사용자가 바꾼 항목과 그대로 둔 항목을 구분하는 기준이 된다.
edit.addEventListener('click', () => {
  editBase = editableValues(place);
  for (const key of editFields) form.elements[key].value = editBase[key];
  formError.textContent = '';
  formLatest.hidden = true;
  showFieldErrors(form);
  dialog.showModal();
});
byId('cancel-save').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => {
  if (busy) event.preventDefault();
});
dialog.addEventListener('close', () => edit.focus());

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !place) return;
  formError.textContent = '';
  const {values, errors} = placeFormValues(form);
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) return;
  const fieldErrors = await change(async current => {
    // 수정창의 기준값과 달라졌고 서버의 현재 값과도 다른 필드만 보낸다.
    // 비운 URL과 메모는 placeFormValues에서 null로 바뀌므로 폼에 보이는 값과 전송할 값을 각각 비교한다.
    const changes = Object.fromEntries(Object.entries(values)
      .filter(([key, value]) => form.elements[key].value !== editBase[key] && value !== current[key]));
    if (Object.keys(changes).length) ({place} = await patchPlace(current, changes));
    render();
    dialog.close();
    feedback('장소 정보를 저장했어요.');
  });
  if (fieldErrors) showFieldErrors(form, fieldErrors);
});

visit.addEventListener('click', async () => {
  await change(async current => {
    ({place} = await patchPlace(current, {is_visited: !current.is_visited}));
    // 서버에서 받은 방문 상태를 먼저 표시하고 코멘트를 다시 읽는다. 그사이 상대가 바꿨다면 최신 상태를 안내한다.
    const applied = place.is_visited;
    render();
    await comments.refresh();
    if (place) {
      feedback(place.is_visited !== applied ? '방문 상태가 다시 변경되어 최신 상태를 표시했어요.' :
        applied ? '방문 완료로 변경했어요.' : '미방문으로 변경했어요.');
    }
  }, {refreshOnUncertainResult: true});
  visit.focus();
});

remove.addEventListener('click', async () => {
  await change(async current => {
    const confirmed = await actionDialog({
      title: '장소를 삭제할까요?',
      description: current.title + '을(를) 삭제하면 장소 정보 및 두 사람의 코멘트도 함께 삭제돼요. 이 작업은 되돌릴 수 없어요.',
      confirm: '장소 삭제', style: 'secondary danger',
    });
    if (!confirmed) return;
    // 확인창을 열 때 본 버전으로 삭제를 요청한다. 서버에서 204를 받은 뒤 보관함으로 돌아간다.
    await deletePlace(current);
    window.location.replace('/index.html?notice=place-deleted');
  });
  if (place) remove.focus();
});

start();
