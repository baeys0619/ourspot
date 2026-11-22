// API와 정적 화면은 Nginx의 같은 출처를 사용한다. HttpOnly 쿠키는 브라우저가 관리한다.
export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || '요청을 처리하지 못했어요. 다시 시도해 주세요.');
    this.status = status;
    this.code = error.code;
    this.fieldErrors = error.fieldErrors;
  }
}

export async function fetchJSON(path, {method = 'GET', body, signal} = {}) {
  const headers = {Accept: 'application/json'};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method, headers, signal, credentials: 'include', cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return;
  // Nginx 자체 오류는 HTML일 수 있다. HTML과 내부 오류는 그대로 출력하지 않는다.
  const envelope = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, response.status < 500 ? envelope?.error : undefined);
  }
  if (!envelope?.data) throw new ApiError(response.status);
  return envelope.data;
}
