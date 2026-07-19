#!/usr/bin/env bash

# 验证 RC 构建后到当前 HEAD 之间是否只有发布证据文档变化。
# 任何源码、依赖、配置或其它文件变化都会失败，要求重新构建 RC。

set -euo pipefail

readonly FLOW_RC_SHA="${1:-}"
readonly FLOW_COMPARE_HEAD="${2:-HEAD}"

if [[ -z "$FLOW_RC_SHA" ]]; then
  printf 'usage: %s <rc-commit-sha> [head]\n' "$0" >&2
  exit 2
fi

git rev-parse --verify "${FLOW_RC_SHA}^{commit}" >/dev/null
git rev-parse --verify "${FLOW_COMPARE_HEAD}^{commit}" >/dev/null

mapfile -t FLOW_CHANGED_PATHS < <(
  git diff --name-only --diff-filter=ACDMRTUXB "${FLOW_RC_SHA}..${FLOW_COMPARE_HEAD}"
)

if [[ "${#FLOW_CHANGED_PATHS[@]}" -eq 0 ]]; then
  printf 'RC scope valid: %s and %s are identical.\n' "$FLOW_RC_SHA" "$FLOW_COMPARE_HEAD"
  exit 0
fi

FLOW_INVALID=0
for FLOW_PATH in "${FLOW_CHANGED_PATHS[@]}"; do
  case "$FLOW_PATH" in
    docs/release-status.md|docs/plan-2026-07-19.md|docs/release-evidence/*)
      printf 'evidence-only: %s\n' "$FLOW_PATH"
      ;;
    *)
      printf 'runtime-affecting or unapproved post-RC change: %s\n' "$FLOW_PATH" >&2
      FLOW_INVALID=1
      ;;
  esac
done

if [[ "$FLOW_INVALID" -ne 0 ]]; then
  printf 'RC scope invalid: rebuild from the current HEAD.\n' >&2
  exit 1
fi

printf 'RC scope valid: all post-RC changes are release evidence only.\n'
