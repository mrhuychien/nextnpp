---
name: nextcode-debug
description: Use when the user reports a bug, error, traceback, or unexpected behavior in a Frappe/ERPNext v16 environment — and wants to investigate root cause. Triggers include "bug", "lỗi", "traceback", "AttributeError", "PermissionError", "DoesNotExistError", "TimestampMismatchError", "validation error mà tôi không hiểu", "hook không chạy", "background job stuck", "queue đang stuck", "permission denied dù đã có role", "Server Script bị skip", "scheduler không trigger", "cache stale", "ImportError after migrate". Do NOT use this skill for designing new features (use nextcode-design), implementing from spec (use nextcode-build), or general performance tuning that isn't tied to a specific bug (use nextcode-perf). This skill is evidence-driven investigation, not speculation.
---

# Nextcode Debug — Frappe Investigation Master

Skill này áp dụng **9-step Investigation Protocol** của Vibecode V5 cho Frappe-specific bug.

Đọc full master prompt ở `references/prompt.md`.

## Quick reference

**Triết lý**: KHÔNG đoán. KHÔNG fix khi chưa hiểu root cause. Mỗi giả thuyết phải có **evidence** trước khi chấp nhận.

**Output**:
- `INVESTIGATION.md` — log toàn quá trình (giả thuyết → evidence → kết luận)
- Root cause statement (1 câu)
- Reproduction steps (deterministic)
- Fix proposal (kèm rollback plan)
- Test case để đảm bảo bug không tái phát

**Frappe-specific tools** em sẽ chỉ định cho user chạy:
- `bench --site X console` (REPL)
- `frappe.log_error()` đọc qua Error Log
- `frappe.db.sql.log_queries = True`
- `bench worker --queue long` (xem background job real-time)
- `bench --site X clear-cache`
- `bench --site X migrate --resume`

## 🔧 `install-app` / `migrate` chết giữa chừng → `references/install-failure-playbook.md`

Loại bug riêng (vỡ trong tiến trình cài, không reproduce qua UAT). Nhớ ngay:
- Install chết giữa chừng **để lại xác** → luôn `drop-site` + `new-site`, đừng tin
  site bẩn, đừng `install-app --force`.
- Fixtures import theo **alphabet tên file**, import mọi `.json`; file đang chết →
  file sau nó **chưa chạy**. Bug đi theo **lớp** → mô phỏng tĩnh tìm hết đồng loại
  (validator ở `nextcode-build/references/validate_shipped_docs.py`), đừng vá lẻ.
- Xác thực server chạy đúng code bằng **md5 / `calculated_hash`** trước khi sửa.
- Đọc **source thật** controller đang vỡ (`curl` raw GitHub), tin format
  `[doctype, name]: field` trong MandatoryError (không tin biến lặp `d=...`).
- Bảng tra exception→nguyên nhân + 15 cạm bẫy: playbook trên + skill `nextcode-build`.
