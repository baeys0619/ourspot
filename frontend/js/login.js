import {fetchJSON} from './api.js';
import {setPending, showFieldErrors} from './components.js';
import {sessionExpired} from './session.js';

const form = document.getElementById('login-form');
const submit = document.getElementById('login-submit');
const feedback = document.getElementById('form-error');
const status = document.getElementById('session-status');
const emailInput = form.elements.email;
const passwordInput = form.elements.password;

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;

  // 이메일 양끝 공백과 대소문자는 서버와 같은 기준으로 정리한다. 비밀번호는 입력한 그대로 보낸다.
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  const errors = {};
  feedback.textContent = '';
  if (!email) errors.email = '이메일을 입력해 주세요.';
  else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    errors.email = '이메일 형식을 확인해 주세요.';
  }
  // 화면에서는 비밀번호가 비었는지 먼저 확인한다. bcrypt의 72바이트 제한은 User API에서 검사한다.
  if (!password) errors.password = '비밀번호를 입력해 주세요.';
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) return;

  // 서버 응답을 기다리는 동안 두 번 제출하지 못하도록 버튼을 잠근다.
  // 성공하면 브라우저가 응답의 세션 쿠키를 처리한 뒤 보관함으로 이동한다.
  setPending(submit, true, '로그인', '로그인 중…');
  try {
    await fetchJSON('/api/auth/login', {method: 'POST', body: {email, password}});
    form.reset();
    window.location.replace('/index.html');
  } catch (error) {
    // 계정이나 비밀번호가 맞지 않는 경우는 보호 화면에서의 세션 만료와 다르므로 폼에서 다시 입력할 수 있게 한다.
    if (error.code === 'AUTH_FAILED') {
      feedback.textContent = '이메일 또는 비밀번호를 확인해 주세요.';
    } else if (error.code === 'VALIDATION_ERROR') {
      feedback.textContent = error.message;
    } else {
      feedback.textContent = '로그인에 실패했어요. 다시 시도해 주세요.';
    }
    setPending(submit, false, '로그인', '로그인 중…');
  }
});

// 이미 로그인한 사용자는 보관함으로 바로 보낸다. 인증 확인에 실패하면 폼을 표시하고 만료와 서버 오류를 구분해 안내한다.
async function checkSession() {
  try {
    await fetchJSON('/api/auth/me');
    window.location.replace('/index.html');
  } catch (error) {
    status.hidden = true;
    form.hidden = false;
    if (!sessionExpired(error)) {
      feedback.textContent = '로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.';
    } else if (new URLSearchParams(window.location.search).get('reason') === 'expired') {
      feedback.textContent = '로그인 세션이 만료됐어요. 다시 로그인해 주세요.';
    }
  }
}

checkSession();
