import {fetchJSON} from './api.js';
import {setPending} from './components.js';

// 보호 API가 유효한 세션이 없다고 응답할 때만 로그인 화면으로 보낸다. 저장소 장애나 비밀번호 오류는 호출한 화면에서 처리한다.
export function sessionExpired(error) {
  return error.status === 401 && error.code === 'AUTH_REQUIRED';
}

export function returnToLogin(expired = false) {
  // 페이지 이동에 앞서 보호 화면의 내용과 열린 모달을 지운다.
  document.getElementById('main')?.replaceChildren();
  document.getElementById('current-user')?.replaceChildren();
  for (const dialog of document.querySelectorAll('dialog')) dialog.remove();
  window.location.replace(expired ? '/login.html?reason=expired' : '/login.html');
}

export async function requireUser() {
  // 보호 화면이 시작할 때 서버에서 현재 사용자를 확인한 뒤 계정 메뉴를 표시한다.
  const {user} = await fetchJSON('/api/auth/me');
  document.getElementById('current-user').textContent = user.display_name;
  document.getElementById('account').hidden = false;

  const logout = document.getElementById('logout');
  logout.addEventListener('click', async () => {
    const message = document.getElementById('account-error');
    message.textContent = '';
    setPending(logout, true, '로그아웃', '로그아웃 중…');
    try {
      // 서버가 Redis 세션을 지운 뒤 성공 응답을 보내면 로그인 화면으로 돌아간다.
      await fetchJSON('/api/auth/logout', {method: 'POST'});
      returnToLogin();
    } catch (error) {
      // 저장소 장애라면 화면을 유지해 로그아웃을 다시 요청할 수 있게 한다.
      message.textContent = sessionExpired(error) ? '로그인이 필요해요.' :
        '로그아웃하지 못했어요. 다시 시도해 주세요.';
      setPending(logout, false, '로그아웃', '로그아웃 중…');
      if (sessionExpired(error)) returnToLogin(true);
    }
  });
  return user;
}

// 뒤로 가기로 캐시된 페이지가 복원되면 새로고침해 세션을 다시 확인한다.
window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload();
});
