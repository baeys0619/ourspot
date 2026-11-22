export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function showFieldErrors(form, errors = {}) {
  let firstInvalid;
  for (const field of form.querySelectorAll('[aria-describedby]')) {
    const message = Object.hasOwn(errors, field.name) ? errors[field.name] : '';
    const hint = document.getElementById(field.getAttribute('aria-describedby'));
    hint.textContent = message || '';
    if (message) {
      field.setAttribute('aria-invalid', 'true');
      firstInvalid ??= field;
    } else {
      field.removeAttribute('aria-invalid');
    }
  }
  firstInvalid?.focus();
}

export function setPending(button, busy, idleLabel, busyLabel) {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
  button.setAttribute('aria-busy', String(busy));
}

export function webUrl(value) {
  if (!value || [...value].length > 2048 ||
      !/^https?:\/\/[^/]/i.test(value) || /[\s\p{Cc}\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const shortDate = new Intl.DateTimeFormat('ko-KR', {month: 'long', day: 'numeric', timeZone: 'Asia/Seoul'});
const fullDate = new Intl.DateTimeFormat('ko-KR', {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul'});
const fullTime = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'long', timeStyle: 'medium', timeZone: 'Asia/Seoul',
});
const calendarDate = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul',
});

export function seoulDate(now = new Date()) {
  return calendarDate.format(now);
}

export function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || value.startsWith('0000')) return false;
  // 달력 날짜의 유효성만 검사한다. API로 보내는 날짜 문자열은 변환하지 않는다.
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function placeFormValues(form) {
  const fields = new FormData(form);
  const title = String(fields.get('title')).trim();
  const category = String(fields.get('category'));
  const source = String(fields.get('source_url')).trim();
  const memo = String(fields.get('memo'));
  const errors = {};
  if (!title || [...title].length > 120) errors.title = '장소 이름을 1~120자로 입력해 주세요.';
  if (!category) errors.category = '카테고리를 선택해 주세요.';
  if (source && !webUrl(source)) errors.source_url = '2048자 이하의 HTTP 또는 HTTPS URL을 입력해 주세요.';
  if ([...memo].length > 1000) errors.memo = '메모를 1000자 이하로 입력해 주세요.';
  return {errors, values: {title, category, source_url: source || null, memo: memo.trim() ? memo : null}};
}

export function formatTimestamp(value, full = false) {
  return (full ? fullDate : shortDate).format(new Date(value));
}

// DATE 필드는 시간대 변환 없이 표시하고, 오래된 장소는 서울 달력의 두 날짜를 비교한다.
export function formatPlannedDate(value, full = false) {
  const [year, month, day] = value.split('-').map(Number);
  return (full ? year + '년 ' : '') + month + '월 ' + day + '일';
}

export function placeStatus(place, now = new Date()) {
  if (place.is_visited) return ['방문 완료', 'visited'];
  const saved = calendarDate.format(new Date(place.created_at));
  const today = seoulDate(now);
  const dayDifference = (Date.parse(today) - Date.parse(saved)) / 86400000;
  if (dayDifference >= 30) return ['아직 못 간 곳', 'overdue'];
  if (place.planned_date) return [formatPlannedDate(place.planned_date) + ' 예정', 'planned'];
  return ['예정 없음', 'unscheduled'];
}

export function tag(label, state = '') {
  return element('span', label, ('tag ' + state).trim());
}

// 응답의 텍스트는 DOM 텍스트 노드에 넣고, HTTP(S) 주소만 링크로 만든다.
export function placeFields(place, full = false) {
  const fields = [];
  const add = (label, content) => {
    const group = element('div');
    const value = element('dd');
    value.append(content);
    group.append(element('dt', label), value);
    fields.push(group);
  };
  if (full) {
    add('저장한 사람', place.added_by_name);
    add('저장 날짜', formatTimestamp(place.created_at, true));
    add('데이트 예정일', place.planned_date ? formatPlannedDate(place.planned_date, true) : '예정 없음');
    if (place.visited_at) add('방문 완료 시점', fullTime.format(new Date(place.visited_at)));
  } else {
    add('저장한 사람', place.added_by_name + ' · ' + formatTimestamp(place.created_at));
  }
  const url = webUrl(place.source_url);
  if (url) {
    const link = element('a', place.source_url);
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    add('장소 링크', link);
  }
  add('메모', place.memo || '메모 없음');
  return fields;
}
