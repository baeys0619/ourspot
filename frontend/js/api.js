// API와 정적 화면은 Nginx의 같은 출처를 사용한다. HttpOnly 쿠키는 브라우저가 관리한다.
export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || '요청을 처리하지 못했어요. 다시 시도해 주세요.');
    this.status = status;
    this.code = error.code;
    this.fieldErrors = error.fieldErrors;
    this.details = error.details;
  }
}

// 공통 JSON 응답에서 data를 꺼내고, 오류에는 화면에서 분기할 HTTP 상태와 오류 코드를 남긴다.
export async function fetchJSON(path, {method = 'GET', body, signal, headers: extraHeaders} = {}) {
  // 요청 본문을 보낼 때만 JSON 형식을 지정한다. 호출한 화면에서 넘긴 취소 신호와 비교값 헤더도 그대로 사용한다.
  const headers = {Accept: 'application/json', ...extraHeaders};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method, headers, signal, credentials: 'include', cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 로그아웃이나 삭제가 성공하면 응답 본문이 없다. 이 경우 JSON 읽기를 건너뛴다.
  if (response.status === 204) return;
  // Nginx 자체 오류는 HTML일 수 있다. HTML과 내부 오류는 그대로 출력하지 않는다.
  const envelope = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, response.status < 500 ? envelope?.error : {code: envelope?.error?.code});
  }
  if (!envelope?.data) throw new ApiError(response.status);
  return envelope.data;
}
