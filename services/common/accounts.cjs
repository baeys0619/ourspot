'use strict';

// 초기 계정 두 개에 같은 커플 ID를 준다. 로그인 계정과 장소 공유 범위를 구분하는 기준이다.
const COUPLE_ID = 'couple_001';
const INITIAL_ACCOUNTS = [
  {email: 'user_a@example.test', displayName: '사용자 A'},
  {email: 'user_b@example.test', displayName: '사용자 B'},
];
// 초기 계정 해시와 존재하지 않는 이메일을 비교할 때 쓰는 해시에 같은 bcrypt 비용을 적용한다.
const BCRYPT_COST = 12;

// 빈 DB, 지정한 두 계정이 있는 DB, 그 밖의 상태를 구분한다. 계정 확인에는 비밀번호 해시를 읽을 필요가 없다.
async function accountState(db) {
  const [rows] = await db.query('SELECT email, display_name, couple_id FROM users ORDER BY email');
  if (rows.length === 0) return 'empty';
  const ready = rows.length === INITIAL_ACCOUNTS.length && INITIAL_ACCOUNTS.every(({email, displayName}, i) => {
    const row = rows[i];
    return row.email === email && row.display_name === displayName && row.couple_id === COUPLE_ID;
  });
  return ready ? 'ready' : 'unexpected';
}

// 서비스 기동 시 계정 상태만 확인한다. 계정 생성은 설치 단계에서 별도로 실행한다.
async function assertAccountsReady(db) {
  if (await accountState(db) !== 'ready') throw new Error('Initial accounts are not ready');
}

// bcrypt 입력이 잘리지 않도록 글자 수가 아닌 UTF-8 바이트 수를 검사한다. 로그인과 초기 계정 설치에서 같은 제한을 쓴다.
function validPassword(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 72;
}

module.exports = {COUPLE_ID, INITIAL_ACCOUNTS, BCRYPT_COST, accountState, assertAccountsReady, validPassword};
