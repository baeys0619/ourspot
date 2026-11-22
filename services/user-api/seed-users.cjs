'use strict';

const fs = require('node:fs');
const bcrypt = require('bcrypt');
const {createDatabasePool} = require('./common/infrastructure.cjs');
const {COUPLE_ID, INITIAL_ACCOUNTS, BCRYPT_COST, accountState, validPassword} = require('./common/accounts.cjs');

const LOCK = 'ourspot:initial-accounts';

// MySQL 이름 잠금은 연결에 묶이므로, 잠금 획득부터 해제까지 같은 연결을 사용한다.
async function seed(db) {
  const connection = await db.getConnection();
  try {
    // 모든 설치 프로세스가 같은 잠금에서 상태를 재확인하므로 동시 실행에도 기존 계정을 건드리지 않는다.
    const [[{locked}]] = await connection.execute('SELECT GET_LOCK(?, 5) AS locked', [LOCK]);
    if (locked !== 1) throw new Error('Could not lock account provisioning');
    try {
      const state = await accountState(connection);
      if (state === 'ready') return 'ready';
      if (state !== 'empty') return 'unexpected';

      // 빈 DB에서만 표준입력의 비밀번호 두 줄을 읽는다. 서로 다른 값인지 확인한 뒤 각 비밀번호의 bcrypt 해시를 만든다.
      const fields = fs.readFileSync(0, 'utf8').split('\n');
      const passwords = fields.slice(0, INITIAL_ACCOUNTS.length);
      if (fields.length !== 3 || fields[2] !== '' || !passwords.every(validPassword) || passwords[0] === passwords[1]) {
        return 'invalid-input';
      }
      // bcrypt가 각 비밀번호에 별도 salt를 만들어 해시한다. INSERT에는 평문 대신 이 해시를 바인딩한다.
      const hashes = await Promise.all(passwords.map(password => bcrypt.hash(password, BCRYPT_COST)));
      const values = INITIAL_ACCOUNTS.flatMap(({email, displayName}, i) => [email, hashes[i], displayName, COUPLE_ID]);
      // 두 계정만 하나의 트랜잭션으로 설치한다. 최초 설치에 장소 및 코멘트 데이터는 필요 없다.
      await connection.beginTransaction();
      try {
        await connection.execute(
          'INSERT INTO users (email, password_hash, display_name, couple_id) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
          values);
        await connection.commit();
      // 삽입 중 문제가 생기면 트랜잭션을 되돌리고, 이후 이름 잠금과 연결을 차례로 반환한다.
      } catch (error) {
        await connection.rollback();
        throw error;
      }
      return 'created';
    } finally {
      await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK]);
    }
  } finally {
    connection.release();
  }
}

async function main() {
  const db = createDatabasePool();
  try {
    // 설치 스크립트는 --check로 비밀번호 입력이 필요한지 먼저 판단한다. 확인 모드에서는 계정을 쓰지 않는다.
    const result = process.argv[2] === '--check' ? await accountState(db) : await seed(db);
    if (result === 'unexpected' || result === 'invalid-input') {
      const message = result === 'unexpected' ? 'Unexpected accounts; existing rows preserved.' :
        'Enter two different passwords, each 1–72 UTF-8 bytes.';
      console.error(message);
      process.exitCode = 1;
      return;
    }
    console.log(result);
  } finally {
    await db.end();
  }
}

main().catch(() => {
  // 드라이버 오류에 포함될 수 있는 SQL과 해시, 연결 상세는 출력하지 않는다.
  console.error('Account provisioning failed; check database readiness and private configuration.');
  process.exitCode = 1;
});
