'use strict';

const COUPLE_ID = 'couple_001';
const INITIAL_ACCOUNTS = [
  {email: 'user_a@example.test', displayName: '사용자 A'},
  {email: 'user_b@example.test', displayName: '사용자 B'},
];
const BCRYPT_COST = 12;

async function accountState(db) {
  const [rows] = await db.query('SELECT email, display_name, couple_id FROM users ORDER BY email');
  if (rows.length === 0) return 'empty';
  const ready = rows.length === INITIAL_ACCOUNTS.length && INITIAL_ACCOUNTS.every(({email, displayName}, i) => {
    const row = rows[i];
    return row.email === email && row.display_name === displayName && row.couple_id === COUPLE_ID;
  });
  return ready ? 'ready' : 'unexpected';
}

async function assertAccountsReady(db) {
  if (await accountState(db) !== 'ready') throw new Error('Initial accounts are not ready');
}

function validPassword(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 72;
}

module.exports = {COUPLE_ID, INITIAL_ACCOUNTS, BCRYPT_COST, accountState, assertAccountsReady, validPassword};
