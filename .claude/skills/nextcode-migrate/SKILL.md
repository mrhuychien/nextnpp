---
name: nextcode-migrate
description: Use when the user wants to plan/execute Frappe/ERPNext version upgrades (v13→v14, v14→v15, v15→v16) OR write data/schema migration patches for an existing custom app. Triggers include "v14 lên v16", "upgrade ERPNext", "patches.txt", "schema migration", "data migration", "breaking changes", "rollback plan", "fixtures sync", "field renaming", "DocType deprecation", "POS rewrite v16", "HRMS migration", "bench update". Do NOT use this skill for designing new apps (use nextcode-design), debugging current bugs unrelated to migration (use nextcode-debug), or implementing greenfield features (use nextcode-build).
---

# Nextcode Migrate — Frappe Version Upgrade & Patches Master

Skill này KHÔNG có tương đương trong Vibecode V5 — đặc thù riêng của Frappe/ERPNext: cần kỹ thuật migrate cẩn trọng vì DB schema và DocType meta liên kết chặt.

Đọc full master prompt ở `references/prompt.md`.

## Quick reference

**3 use case chính**:
1. **Version upgrade**: bench update giữa major versions (vd: v15→v16)
2. **Custom app patches**: thay đổi schema/data trong app của anh qua `patches.txt`
3. **Fixtures sync**: đảm bảo Custom Field/Property Setter consistent giữa các site

**Output**:
- `MIGRATION_PLAN.md` — kế hoạch tuần tự, có rollback
- `BREAKING_CHANGES.md` — phân tích impact của version mới lên app
- Patch files (`.py` trong `patches/`)
- `RUNBOOK.md` — lệnh staging trước, production sau
- Backup verification script

**Quy tắc vàng**:
- KHÔNG bao giờ migrate production trực tiếp
- KHÔNG bao giờ skip major version (v14→v16 phải qua v15)
- LUÔN verify backup restore được trước khi migrate

## ⚠️ Fixtures re-sync khi `migrate` — cùng luật như install

`migrate` chạy lại `sync_fixtures` → fixtures import bằng **đúng** đường full
validate như install (alphabet tên file, không áp default, lỗi ≠ ImportError =
chết migrate). Hệ quả khi migrate:
- patches.txt **phải** có cả `[pre_model_sync]` + `[post_model_sync]` (thiếu →
  KeyError chết migrate).
- `name` của fixture phải **ổn định giữa các site** — đừng ship doctype hash-named
  (vd Custom DocPerm): name đổi giữa site → re-import nhân đôi / vỡ. Cấp quyền
  bằng `add_permission` trong code, không qua fixture.
- Patch **idempotent** tuyệt đối (chạy lại không hỏng), bọc guard `frappe.db.exists`.
- Đổi tên field/DocType: patch `rename_field`/`rename_doc` chạy ở `[pre_model_sync]`
  **trước** khi schema mới đè.

15 cạm bẫy install/fixtures + cổng kiểm `validate_shipped_docs.py`: skill
`nextcode-build` (`references/fixtures-install-pitfalls.md`). Chạy validator trong
RUNBOOK trước bước `bench --site X migrate`.
