import {fetchJSON} from './api.js';
import {element, formatPlannedDate, placeFields, tag} from './components.js';
import {requireUser, returnToLogin, sessionExpired} from './session.js';

const status = document.getElementById('detail-status');
const article = document.getElementById('place-detail');

async function start() {
  status.textContent = '장소를 불러오는 중…';
  status.setAttribute('role', 'status');
  try {
    if (document.getElementById('account').hidden) await requireUser();
    const id = new URLSearchParams(window.location.search).get('id');
    if (!/^[1-9]\d*$/.test(id || '') || Number(id) > 2147483647) {
      status.setAttribute('role', 'alert');
      status.textContent = '장소를 찾을 수 없어요.';
      return;
    }

    const {place} = await fetchJSON('/api/places/' + id);
    document.getElementById('detail-title').textContent = place.title;
    const tags = document.getElementById('detail-tags');
    tags.append(tag(place.category), tag(place.is_visited ? '방문 완료' : '미방문', place.is_visited ? 'visited' : 'unvisited'));
    if (place.planned_date) tags.append(tag(formatPlannedDate(place.planned_date) + ' 예정', 'planned'));
    document.getElementById('detail-fields').append(...placeFields(place, true));
    status.hidden = true;
    article.hidden = false;
  } catch (error) {
    if (sessionExpired(error)) returnToLogin(true);
    else {
      status.setAttribute('role', 'alert');
      if (error.status === 404) status.textContent = '장소를 찾을 수 없어요.';
      else {
        const retry = element('button', '다시 시도', 'button secondary');
        retry.type = 'button';
        retry.addEventListener('click', start);
        status.replaceChildren(element('p', '장소를 불러오지 못했어요.'), retry);
      }
    }
  } finally {
    article.setAttribute('aria-busy', 'false');
  }
}

start();
