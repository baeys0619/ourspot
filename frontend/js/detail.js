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

async function loadPlace() {
  try {
    if (!comments) {
      const user = await requireUser();
      comments = createComments({
        user, getPlace: () => place, reload: refreshDetail, onMissing: showMissing,
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
    if (await loadPlace()) {
      if (dialog.open) showLatestInForm();
      await comments.refresh();
    }
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
  // 원격 변경을 보여 주면서 저장하지 않은 입력은 재검토할 수 있도록 그대로 둔다.
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

async function change(action) {
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
      const refreshed = await loadPlace();
      if (refreshed) await comments.refresh();
      if (dialog.open) {
        formError.textContent = error.message;
        if (refreshed) showLatestInForm();
        else if (!place) {
          formError.append(' 최신 정보를 다시 불러와 주세요. ',
            Object.assign(element('button', '다시 시도', 'text-button'), {type: 'button', onclick: start}));
        }
      }
    } else if (error.code === 'AFTER_COMMENTS_EXIST') {
      await refreshDetail();
      if (!place) return;
      await actionDialog({
        title: '미방문으로 변경할 수 없어요',
        description: '방문 후 코멘트가 남아 있어요. 각 작성자가 자신의 방문 후 기록을 먼저 삭제해야 미방문으로 바꿀 수 있어요.',
        confirm: '확인', style: 'secondary', cancel: false,
      });
    } else if (error.status === 404) {
      showMissing();
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
    render();
    feedback(place.is_visited ? '방문 완료로 변경했어요.' : '미방문으로 변경했어요.');
    await comments.refresh();
  });
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
    await deletePlace(current);
    window.location.replace('/index.html?notice=place-deleted');
  });
  if (place) remove.focus();
});

start();
