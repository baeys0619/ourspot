#!/usr/bin/env bash
set +x
set -euo pipefail
cd "$(dirname "$0")/.."

source infra/images.env
prefix=${OURSPOT_INSTALL_PREFIX:-ourspot}
runtime=${OURSPOT_RUNTIME_DIR:-.runtime}
image=${OURSPOT_USER_IMAGE:-$USER_LOCAL}
run_seed=(docker run --pull=never --network "$prefix-net" --env-file "$runtime/api.env")
seed_command=("$image" node seed-users.cjs)
if [[ -n "${OURSPOT_QEMU:-}" ]]; then
  run_seed+=(--platform linux/amd64 --no-healthcheck
    --mount "type=bind,src=$OURSPOT_QEMU,dst=/run/ourspot-qemu-x86_64,readonly"
    --entrypoint /run/ourspot-qemu-x86_64)
  seed_command=("$image" /usr/local/bin/node seed-users.cjs)
fi
run_seed_job() {
  local job="$1"
  shift
  if [[ "$prefix" == ourspot ]]; then
    "${run_seed[@]}" --rm "$@"
  else
    # 격리 검증에서는 실행 증거가 남도록 종료된 초기화 컨테이너도 보존한다.
    "${run_seed[@]}" --name "$prefix-seed-$job-$$" "$@"
  fi
}
state=$(run_seed_job check "${seed_command[@]}" --check)
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
printf '%s\n%s\n' "$password_a" "$password_b" | run_seed_job write -i "${seed_command[@]}"
