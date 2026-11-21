#!/usr/bin/env bash
set +x
set -euo pipefail
cd "$(dirname "$0")/.."

run_seed=(docker run --rm --network ourspot-net --env-file .runtime/api.env)
seed_command=(ourspot-user-api:0.2 node seed-users.cjs)
state=$("${run_seed[@]}" "${seed_command[@]}" --check)
case "$state" in
  ready) printf '%s\n' 'Initial accounts already installed.'; exit 0 ;;
  empty) ;;
  *) printf '%s\n' 'Unexpected account provisioning state.' >&2; exit 1 ;;
esac

printf '%s\n' 'Enter two different passwords, each 1–72 UTF-8 bytes.' >&2
read_password() {
  local email="$1" target="$2" entered confirmed
  IFS= read -r -s -p "$email password: " entered </dev/tty
  printf '\n' >&2
  IFS= read -r -s -p "$email confirm: " confirmed </dev/tty
  printf '\n' >&2
  if [[ "$entered" != "$confirmed" || -z "$entered" ]]; then
    printf '%s\n' 'Passwords are empty or do not match.' >&2
    return 1
  fi
  printf -v "$target" '%s' "$entered"
}
read_password user_a@example.test password_a
read_password user_b@example.test password_b
# Bash의 내장 printf로 전달한다. 평문을 명령 인자, 환경변수 및 파일에 남기지 않는다.
printf '%s\n%s\n' "$password_a" "$password_b" | "${run_seed[@]}" -i "${seed_command[@]}"
