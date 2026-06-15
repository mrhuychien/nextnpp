#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SessionStart hook — tự cài "personal skills" vào ~/.claude/skills mỗi khi khởi
# tạo session, đặc biệt cho Claude Code on the web: container ephemeral, KHÔNG có
# skill local (~/.claude/skills của máy bạn). Chỉ thứ nằm trong GIT mới theo vào
# session cloud → hook này kéo skills từ 1 repo trung tâm về.
#
# Lưu ý: skills nằm trong .claude/skills/ của CHÍNH repo này đã tự được nạp
# (project skills) — không cần hook. Hook này dành cho skills DÙNG CHUNG nhiều
# repo (giữ ở 1 repo trung tâm).
#
# Cấu hình qua Environment variables (đặt trong cấu hình environment trên web,
# hoặc shell):
#   CLAUDE_SKILLS_REPO    (bắt buộc để bật) URL/đường dẫn git repo chứa skills.
#   CLAUDE_SKILLS_BRANCH  (tùy chọn) branch; mặc định nhánh default của repo.
#   CLAUDE_SKILLS_SUBDIR  (tùy chọn) thư mục con chứa skills; mặc định tự dò
#                         'skills/' rồi tới gốc repo.
#   CLAUDE_SKILLS_LOCAL=1 (tùy chọn) cho phép chạy cả ở máy local (mặc định CHỈ
#                         chạy ở remote để không đè skill bạn đang sửa ở local).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

log() { echo "[skills-sync] $*"; }

# 1) Chỉ chạy ở remote (web) trừ khi bật CLAUDE_SKILLS_LOCAL=1 — tránh đè/ghi
#    lên skills bạn đang chỉnh ở máy local.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ "${CLAUDE_SKILLS_LOCAL:-}" != "1" ]; then
  exit 0
fi

REPO="${CLAUDE_SKILLS_REPO:-}"
if [ -z "$REPO" ]; then
  log "CLAUDE_SKILLS_REPO chưa đặt → chỉ dùng project skills của repo này. (Xem .claude/hooks/README.md)"
  exit 0
fi

DEST="${HOME}/.claude/skills"
PROJECT_SKILLS="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/skills"
mkdir -p "$DEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 2) Clone shallow; fail-soft — lỗi mạng/quyền KHÔNG được chặn session.
if ! git clone --depth 1 ${CLAUDE_SKILLS_BRANCH:+--branch "$CLAUDE_SKILLS_BRANCH"} "$REPO" "$TMP" 2>/dev/null; then
  log "Không clone được '$REPO' (mạng/quyền?) → bỏ qua, session vẫn chạy bình thường."
  exit 0
fi

# 3) Xác định thư mục nguồn chứa các <skill>/SKILL.md
SRC="$TMP/${CLAUDE_SKILLS_SUBDIR:-}"
if [ ! -d "$SRC" ] || ! ls -d "$SRC"/*/SKILL.md >/dev/null 2>&1; then
  if ls -d "$TMP"/skills/*/SKILL.md >/dev/null 2>&1; then SRC="$TMP/skills"; else SRC="$TMP"; fi
fi

# 4) Cài từng skill. Project skill cùng tên THẮNG → tránh trùng lặp.
count=0; skipped=0
for d in "$SRC"/*/; do
  [ -f "${d}SKILL.md" ] || continue
  name="$(basename "$d")"
  if [ -d "$PROJECT_SKILLS/$name" ]; then
    skipped=$((skipped + 1)); continue
  fi
  rm -rf "${DEST:?}/$name"
  cp -a "$d" "$DEST/$name"
  count=$((count + 1))
done

log "Đã cài $count skill vào $DEST (bỏ qua $skipped trùng project skill)."
exit 0
