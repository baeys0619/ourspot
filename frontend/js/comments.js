import {fetchJSON} from './api.js';
import {element, setPending} from './components.js';
import {actionDialog} from './place-actions.js';
import {returnToLogin} from './session.js';

const phaseNames = {before: '방문 전', after: '방문 후'};
const limit = 1000;
const contentError = '코멘트를 1~1000자로 입력해 주세요.';

export function createComments({user, getPlace, reload, onMissing, onExpired, onPending}) {
  const byId = id => document.getElementById(id);
  const section = byId('comments');
  const state = byId('comments-state');
  const status = byId('comments-status');
  const retry = byId('retry-comments');
  const phases = byId('comment-phases');
  const notice = byId('comments-notice');
  const dialog = byId('comment-dialog');
  const form = byId('comment-form');
  const input = byId('comment-content');
  const error = byId('comment-error');
  const fieldError = byId('comment-content-error');
  const save = byId('save-comment');
  const cancel = byId('cancel-comment');
  const editorRetry = byId('retry-comment-editor');
  let records = [];
  let ready = false;
  let pending = false;
  let refreshing = false;
  let expired = false;
  let missingPlace = false;
  let editorPhase;

  const isOwn = record => record.user_id === user.id;
  const canEdit = phase => Boolean(getPlace()) && getPlace().is_visited === (phase === 'after');
  const endpoint = () => '/api/places/' + getPlace().id + '/comments';

  function updateControls(detailBusy) {
    section.setAttribute('aria-busy', String(pending || refreshing));
    for (const button of phases.querySelectorAll('button')) button.disabled = pending || detailBusy;
    retry.disabled = pending || detailBusy;
    input.readOnly = pending;
    cancel.disabled = pending;
    editorRetry.disabled = pending;
    editorRetry.hidden = (ready && Boolean(getPlace())) || expired || missingPlace;
    setPending(save, pending, '저장', '저장 중…');
    save.disabled = pending || expired || !ready || !canEdit(editorPhase);
  }

  function inform(message, failed = false) {
    notice.setAttribute('role', failed ? 'alert' : 'status');
    notice.className = 'feedback ' + (failed ? 'error' : 'success');
    notice.textContent = message;
  }

  function countContent() {
    // maxlength는 UTF-16 코드 단위를 사용하므로 서버와 동일하게 trim 후 코드 포인트를 센다.
    const length = [...input.value.trim()].length;
    byId('comment-count').textContent = length + ' / ' + limit + '자';
    return length;
  }

  function validate(message = '') {
    fieldError.textContent = message;
    input.setAttribute('aria-invalid', String(Boolean(message)));
  }

  function openEditor(phase, ownRecord) {
    editorPhase = phase;
    byId('comment-dialog-title').textContent = phaseNames[phase] + ' 코멘트 ' + (ownRecord ? '수정' : '작성');
    byId('comment-author').textContent = user.display_name + ' · 내 기록';
    input.value = ownRecord?.content ?? '';
    countContent();
    validate();
    error.textContent = '';
    inform('');
    updateControls(false);
    dialog.showModal();
  }

  function button(label, phase, action, click) {
    const control = element('button', label, 'text-button' + (action === 'delete' ? ' danger' : ' accent'));
    control.type = 'button';
    control.dataset.commentAction = action;
    control.setAttribute('aria-label', phaseNames[phase] + ' 내 코멘트 ' + label);
    control.addEventListener('click', click);
    return control;
  }

  function card(phase, own, record) {
    const result = element('article', undefined, 'comment-card' + (own ? ' own' : '') + (!record ? ' empty' : ''));
    const heading = element('div', undefined, 'comment-card-heading');
    const partner = records.find(item => !isOwn(item));
    const author = own ? user.display_name + ' · 나' : partner?.display_name ?? '상대방';
    heading.append(element('h4', author));
    if (own && canEdit(phase)) {
      const actions = element('div', undefined, 'comment-actions');
      actions.append(button(record ? '수정' : '기록하기', phase, 'edit', () => openEditor(phase, record)));
      if (record) actions.append(button('삭제', phase, 'delete', () => deleteOwn(phase)));
      heading.append(actions);
    } else if (record) {
      heading.append(element('span', '읽기 전용', 'comment-permission muted'));
    }
    // 서버의 표시 이름과 본문을 텍스트 노드로 삽입해 HTML 해석을 막는다.
    result.append(heading, element('p', record?.content ?? '아직 남긴 기록이 없어요.', 'comment-body'));
    return result;
  }

  function render() {
    if (!ready || !getPlace()) return;
    for (const phase of Object.keys(phaseNames)) {
      const container = byId(phase + '-comments');
      const items = records.filter(record => record.phase === phase);
      if (phase === 'after' && !getPlace().is_visited && items.length === 0) {
        const hint = element('div', undefined, 'comment-card comment-locked');
        hint.append(element('p', '방문 완료 후 작성할 수 있어요.'),
          element('p', '두 사람이 각각 한 번씩 기록할 수 있어요.', 'desktop muted'));
        container.replaceChildren(hint);
      } else {
        container.replaceChildren(card(phase, true, items.find(isOwn)),
          card(phase, false, items.find(record => !isOwn(record))));
      }
    }
    phases.hidden = false;
  }

  function expire() {
    onExpired();
    if (!dialog.open) {
      returnToLogin(true);
      return;
    }
    // 만료 시 보호 화면을 가리고 초안만 모달에 남겨 복사할 수 있게 한다.
    expired = true;
    ready = false;
    byId('comment-sign-in').hidden = false;
    error.textContent = '로그인 세션이 만료됐어요. 작성한 내용을 복사한 뒤 다시 로그인해 주세요.';
    updateControls(false);
  }

  function missing() {
    ready = false;
    missingPlace = true;
    if (dialog.open) error.textContent = '장소를 찾을 수 없어요.';
  }

  function showState(message, failed = false) {
    phases.hidden = true;
    state.hidden = false;
    state.classList.toggle('error', failed);
    status.setAttribute('role', failed ? 'alert' : 'status');
    status.textContent = message;
    retry.hidden = !failed;
  }

  function failureMessage(failure, action) {
    if (failure.status === 403) return '코멘트에 접근할 권한이 없어요.';
    if (failure.status === 404) return '장소를 찾을 수 없어요.';
    if (failure.status === 503) return '코멘트 서비스를 잠시 사용할 수 없어요. 다시 시도해 주세요.';
    if (!failure.status) return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
    return '코멘트를 ' + action + '하지 못했어요. 다시 시도해 주세요.';
  }

  async function refresh() {
    if (!getPlace()) return false;
    ready = false;
    refreshing = true;
    showState('코멘트를 불러오는 중…');
    onPending();
    try {
      ({comments: records} = await fetchJSON(endpoint()));
      ready = true;
      state.hidden = true;
      render();
    } catch (failure) {
      ready = false;
      if (failure.status === 401) expire();
      else if (failure.status === 404) onMissing();
      else showState(failureMessage(failure, '조회'), true);
    } finally {
      refreshing = false;
      onPending();
    }
    return ready;
  }

  async function run(action) {
    if (pending) return;
    pending = true;
    onPending();
    try {
      await action();
    } finally {
      pending = false;
      onPending();
    }
  }

  async function reportFailure(failure, action) {
    if (failure.status === 401) return expire();
    if (failure.status === 404) onMissing();
    let message = failureMessage(failure, action);
    if (failure.status === 409 || failure.status >= 500 || !failure.status) {
      // 서버가 변경을 수락한 뒤 응답이 유실될 수도 있다. 쓰기를 재전송하지 않고 두 상태를 다시 읽는다.
      const refreshed = await reload();
      if (expired || missingPlace) return;
      if (failure.status === 409) message = '방문 상태가 바뀌어 기록을 변경할 수 없었어요.';
      if (refreshed) message += ' 최신 장소와 코멘트를 다시 불러왔어요.';
    }
    if (dialog.open) {
      if (failure.status === 422) {
        validate(failure.fieldErrors?.content || contentError);
        input.focus();
      } else {
        error.textContent = message;
      }
    } else {
      inform(message, true);
    }
  }

  function focusPhase(phase, action = 'edit') {
    const target = phases.hidden ? retry : byId(phase + '-comments').querySelector('[data-comment-action="' + action + '"]');
    if (expired) returnToLogin(true);
    else if (!getPlace()) byId('detail-status').focus();
    else (target && !target.hidden ? target : byId('comments-title')).focus();
  }

  async function deleteOwn(phase) {
    let cancelled = false;
    await run(async () => {
      inform('');
      const confirmed = await actionDialog({
        title: phaseNames[phase] + ' 코멘트를 삭제할까요?',
        description: '내 방문 ' + (phase === 'before' ? '전' : '후') + ' 기록을 삭제해요.',
        confirm: '코멘트 삭제', style: 'secondary danger',
      });
      if (!confirmed) {
        cancelled = true;
        return;
      }
      try {
        // DELETE는 본문 없이 보낸다. 공용 fetchJSON은 204 응답을 읽지 않는다.
        await fetchJSON(endpoint() + '/' + phase, {method: 'DELETE'});
      } catch (failure) {
        await reportFailure(failure, '삭제');
        return;
      }
      inform(phaseNames[phase] + ' 코멘트를 삭제했어요.');
      await reload();
    });
    focusPhase(phase, cancelled ? 'delete' : 'edit');
  }

  input.addEventListener('input', () => {
    countContent();
    validate();
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    if (pending) event.preventDefault();
  });
  dialog.addEventListener('close', () => focusPhase(editorPhase));
  retry.addEventListener('click', async () => {
    await run(reload);
    focusPhase(getPlace()?.is_visited ? 'after' : 'before');
  });
  editorRetry.addEventListener('click', () => run(async () => {
    if (await reload()) error.textContent = canEdit(editorPhase) ? '' : '현재 방문 상태에서는 이 코멘트를 변경할 수 없어요.';
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    error.textContent = '';
    const content = input.value.trim();
    const length = countContent();
    if (length === 0 || length > limit || !content.isWellFormed()) {
      validate(contentError);
      input.focus();
      return;
    }
    validate();
    await run(async () => {
      try {
        // 작성자와 대상은 서버가 세션과 경로에서 확인한다. 본문에는 내용만 보낸다.
        await fetchJSON(endpoint() + '/' + editorPhase, {method: 'PUT', body: {content}});
      } catch (failure) {
        await reportFailure(failure, '저장');
        return;
      }
      inform(phaseNames[editorPhase] + ' 코멘트를 저장했어요.');
      await reload();
      if (!expired) dialog.close();
    });
    if (!dialog.open) focusPhase(editorPhase);
  });

  return {get pending() { return pending; }, expire, missing, refresh, updateControls};
}
