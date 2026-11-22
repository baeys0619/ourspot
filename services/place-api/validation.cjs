'use strict';

const categories = ['카페', '맛집', '놀거리', '기타'];
const placeFields = ['title', 'category', 'source_url', 'memo'];
const scheduleFields = ['planned_date', 'visit_order', 'confirm_move'];
const identityFields = ['id', 'userId', 'user_id', 'coupleId', 'couple_id', 'addedBy', 'added_by', 'added_by_name',
  'comment_id'];
const commentIdentityFields = [...identityFields, 'commentId', 'placeId', 'place_id'];

class PlaceRequestError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.body = {error: {code, message, ...extra}};
  }
}

function invalid(fieldErrors) {
  throw new PlaceRequestError(422, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', {fieldErrors});
}

function rejectIdentityFields(...inputs) {
  rejectFields(identityFields, inputs);
}

function rejectFields(fields, inputs) {
  if (inputs.some(input => input && fields.some(key => Object.hasOwn(input, key)))) {
    throw new PlaceRequestError(403, 'FORBIDDEN', '권한이 없는 작업이에요.');
  }
}

function requireEmptyQuery(query) {
  if (Object.keys(query).length > 0) invalid({query: '지원하지 않는 조회 조건이에요.'});
}

function requireEmptyBody(req, message) {
  if (Number(req.get('Content-Length')) > 0 || req.get('Transfer-Encoding') !== undefined) {
    invalid({body: message});
  }
}

function validateCommentRequest(req) {
  rejectFields(commentIdentityFields, [req.body, req.query]);
  requireEmptyQuery(req.query);
  const {phase} = req.params;
  if (phase !== undefined && phase !== 'before' && phase !== 'after') {
    invalid({phase: '코멘트 단계는 before 또는 after여야 해요.'});
  }
  return phase;
}

function requireCommentContent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid({body: 'JSON 객체를 입력해 주세요.'});
  }
  const fieldErrors = Object.fromEntries(Object.keys(input)
    .filter(key => key !== 'content')
    .map(key => [key, '지원하지 않는 필드예요.']));
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content || !content.isWellFormed() || [...content].length > 1000) {
    fieldErrors.content = '코멘트를 1~1000자로 입력해 주세요.';
  }
  if (Object.keys(fieldErrors).length > 0) invalid(fieldErrors);
  return content;
}

// 수정 요청은 명시한 필드만 다룬다. 선택 필드의 null 또는 빈 문자열은 DB의 NULL로 저장한다.
function validatePlaceFields(input, creating) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid({body: 'JSON 객체를 입력해 주세요.'});
  }
  const allowed = creating ? placeFields : [...placeFields, ...scheduleFields, 'is_visited', 'expected_updated_at'];
  const fieldErrors = Object.fromEntries(Object.keys(input)
    .filter(key => !allowed.includes(key))
    .map(key => [key, '지원하지 않는 필드예요.']));
  const values = {};
  if (creating || Object.hasOwn(input, 'title')) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || !title.isWellFormed() || [...title].length > 120) {
      fieldErrors.title = '장소 이름을 1~120자로 입력해 주세요.';
    } else {
      values.title = title;
    }
  }
  if (creating || Object.hasOwn(input, 'category')) {
    if (!categories.includes(input.category)) fieldErrors.category = '카테고리를 선택해 주세요.';
    else values.category = input.category;
  }
  if (Object.hasOwn(input, 'source_url')) {
    const url = typeof input.source_url === 'string' ? input.source_url.trim() : input.source_url;
    if (url === '' || url === null) values.source_url = null;
    else if (validUrl(url)) values.source_url = url;
    else fieldErrors.source_url = '2048자 이하의 HTTP 또는 HTTPS URL을 입력해 주세요.';
  }
  if (Object.hasOwn(input, 'memo')) {
    const {memo} = input;
    if (memo === null) {
      values.memo = null;
    } else if (typeof memo === 'string' && memo.isWellFormed() && [...memo].length <= 1000) {
      values.memo = memo.trim() === '' ? null : memo;
    } else {
      fieldErrors.memo = '메모를 1000자 이하로 입력해 주세요.';
    }
  }
  if (!creating) {
    validateScheduleFields(input, values, fieldErrors);
    if (Object.hasOwn(input, 'is_visited')) {
      if (typeof input.is_visited !== 'boolean') {
        fieldErrors.is_visited = '방문 상태는 true 또는 false로 입력해 주세요.';
      } else if (Object.hasOwn(input, 'planned_date') || Object.hasOwn(input, 'visit_order')) {
        fieldErrors.is_visited = '방문 상태와 일정은 따로 변경해 주세요.';
      } else {
        values.is_visited = input.is_visited;
      }
    }
  }
  if (!creating && Object.keys(values).length === 0 && Object.keys(fieldErrors).length === 0) {
    fieldErrors.body = '변경할 장소 필드를 입력해 주세요.';
  }
  if (Object.keys(fieldErrors).length > 0) invalid(fieldErrors);
  return values;
}

// 현재 날짜와 일정 크기가 필요한 검사는 장소 버전을 확인한 트랜잭션 안에서 수행한다.
function validateScheduleFields(input, values, fieldErrors) {
  if (Object.hasOwn(input, 'planned_date')) {
    if (input.planned_date === null || validDate(input.planned_date)) values.planned_date = input.planned_date;
    else fieldErrors.planned_date = '실제 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.';
  }
  if (Object.hasOwn(input, 'visit_order')) {
    const {visit_order: order} = input;
    if (input.planned_date === null ? order === null : Number.isSafeInteger(order) && order > 0) {
      values.visit_order = order;
    } else {
      fieldErrors.visit_order = '방문 순서는 양의 정수이며, 일정 제외 시에는 null이어야 해요.';
    }
  }
  if (Object.hasOwn(input, 'confirm_move') && typeof input.confirm_move !== 'boolean') {
    fieldErrors.confirm_move = '이동 확인은 true 또는 false로 입력해 주세요.';
  }
}

function validUrl(value) {
  // URL 생성자가 허용하는 생략된 슬래시나 자동 보정에 의존하지 않고 명시적인 절대 주소를 받는다.
  if (typeof value !== 'string' || !value.isWellFormed() || [...value].length > 2048 ||
      !/^https?:\/\/[^/]/i.test(value) || /[\s\p{Cc}\\]/u.test(value)) return false;
  return URL.canParse(value);
}

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function requireExpectedTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(value) ||
      !validDate(value.slice(0, 10))) {
    invalid({expected_updated_at: '최신 장소 정보가 필요해요.'});
  }
  return value;
}

function placeNotFound() {
  return new PlaceRequestError(404, 'NOT_FOUND', '장소를 찾을 수 없어요.');
}

function requirePlaceId(id) {
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) throw placeNotFound();
  return Number(id);
}

module.exports = {PlaceRequestError, invalid, rejectIdentityFields, requireEmptyQuery, validatePlaceFields,
  requireEmptyBody, validateCommentRequest, requireCommentContent, validDate, requireExpectedTimestamp,
  requirePlaceId, placeNotFound};
