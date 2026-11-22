import {fetchJSON} from './api.js';
import {setPending} from './components.js';

export function sessionExpired(error) {
  return error.status === 401 && error.code === 'AUTH_REQUIRED';
}

export function returnToLogin(expired = false) {
  document.getElementById('main')?.replaceChildren();
  document.getElementById('current-user')?.replaceChildren();
  for (const dialog of document.querySelectorAll('dialog')) dialog.remove();
  window.location.replace(expired ? '/login.html?reason=expired' : '/login.html');
}

export async function requireUser() {
  // 브라우저 뒤로 가기의 페이지 캐시에서도 보호 화면은 세션을 다시 조회한다.
  const {user} = await fetchJSON('/api/auth/me');
  document.getElementById('current-user').textContent = user.display_name;
  document.getElementById('account').hidden = false;

  const logout = document.getElementById('logout');
  logout.addEventListener('click', async () => {
    const message = document.getElementById('account-error');
    message.textContent = '';
    setPending(logout, true, '로그아웃', '로그아웃 중…');
    try {
      await fetchJSON('/api/auth/logout', {method: 'POST'});
      returnToLogin();
    } catch (error) {
      message.textContent = sessionExpired(error) ? '로그인이 필요해요.' :
        '로그아웃하지 못했어요. 다시 시도해 주세요.';
      setPending(logout, false, '로그아웃', '로그아웃 중…');
      if (sessionExpired(error)) returnToLogin(true);
    }
  });
}

window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload();
});
