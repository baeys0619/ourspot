import {fetchJSON} from './api.js';
import {element, formatPlannedDate} from './components.js';

export function patchPlace(place, changes) {
  // 화면에 표시한 스냅샷의 밀리초 문자열을 그대로 비교값으로 전달한다.
  return fetchJSON('/api/places/' + place.id, {
    method: 'PATCH', body: {...changes, expected_updated_at: place.updated_at},
  });
}

// 삭제에는 본문을 보내지 않는다. 화면에서 본 장소의 버전은 요청 헤더에 넣는다.
export function deletePlace(place) {
  return fetchJSON('/api/places/' + place.id, {
    method: 'DELETE', headers: {'X-Expected-Updated-At': place.updated_at},
  });
}

// 확인만 필요한 창과 날짜 선택이 필요한 창을 함께 사용한다.
// 창이 닫힐 때 확인 여부 또는 선택한 날짜를 돌려주고 기존 위치로 포커스를 옮긴다.
export function actionDialog({title, description, confirm, style = 'primary', cancel = true, date}) {
  const previous = document.activeElement;
  const dialog = element('dialog', undefined, 'action-dialog');
  dialog.setAttribute('aria-labelledby', 'action-title');
  dialog.setAttribute('aria-describedby', 'action-description');
  const form = element('form');
  form.method = 'dialog';
  const heading = element('h2', title);
  heading.id = 'action-title';
  const summary = element('p', description, 'muted');
  summary.id = 'action-description';
  form.append(heading, summary);
  let dateControl;
  if (date !== undefined) {
    const field = element('label', '예정 날짜', 'field');
    dateControl = element('input');
    dateControl.type = 'date';
    dateControl.required = true;
    dateControl.min = '0001-01-01';
    dateControl.max = '9999-12-31';
    dateControl.value = date;
    dateControl.autofocus = true;
    field.append(dateControl);
    form.append(field, element('p', '이 장소에는 예정일을 하나만 지정할 수 있어요.', 'fine-print'));
  }
  const actions = element('div', undefined, 'dialog-actions');
  if (cancel) {
    const back = element('button', '취소', 'button secondary');
    back.type = 'button';
    back.autofocus = !dateControl;
    back.addEventListener('click', () => dialog.close());
    actions.append(back);
  } else {
    actions.classList.add('single-action');
  }
  const accept = element('button', confirm, 'button ' + style);
  accept.value = 'confirmed';
  actions.append(accept);
  form.append(actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'confirmed' ? dateControl?.value ?? true : false;
      dialog.remove();
      previous?.focus();
      resolve(result);
    }, {once: true});
  });
}

// 날짜 배정은 먼저 일반 수정으로 요청한다. 서버가 기존 날짜에서의 이동 확인을 요구할 때만 확인창을 연다.
export async function assignDate(place, date) {
  try {
    return await patchPlace(place, {planned_date: date});
  } catch (error) {
    // 버전 충돌은 호출한 화면에 전달한다. DATE_CONFLICT만 사용자의 확인을 받아 날짜 이동으로 이어 간다.
    if (error.code !== 'DATE_CONFLICT') throw error;
    const {current_planned_date, requested_planned_date, current_updated_at} = error.details;
    const confirmed = await actionDialog({
      title: '기존 일정에서 이동할까요?',
      description: '이 장소는 ' + formatPlannedDate(current_planned_date) + '에 예정되어 있어요. ' +
        formatPlannedDate(requested_planned_date) + '로 옮기면 기존 날짜의 일정에서는 제외돼요.',
      confirm: '날짜 변경',
    });
    if (!confirmed) return null;
    // 확인창을 열었을 때의 서버 버전을 사용한다. 대기 중 수정되면 서버가 다시 충돌을 반환한다.
    return patchPlace({...place, updated_at: current_updated_at}, {planned_date: requested_planned_date, confirm_move: true});
  }
}
