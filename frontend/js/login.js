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

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  const errors = {};
  feedback.textContent = '';
  if (!email) errors.email = '이메일을 입력해 주세요.';
  else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    errors.email = '이메일 형식을 확인해 주세요.';
  }
  if (!password) errors.password = '비밀번호를 입력해 주세요.';
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) return;

  setPending(submit, true, '로그인', '로그인 중…');
  try {
    await fetchJSON('/api/auth/login', {method: 'POST', body: {email, password}});
    form.reset();
    window.location.replace('/index.html');
  } catch (error) {
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
