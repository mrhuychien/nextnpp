---
name: nextcode-build
description: Use when the user has an APPROVED design/spec/blueprint for a Frappe/ERPNext v16 custom app and wants to actually scaffold and implement it — generating bench commands, DocType JSON files, Python controllers, hooks.py, Server Scripts, Client Scripts, whitelisted API methods, fixtures, and Print Formats. Triggers include "scaffold app", "tạo DocType", "viết hooks.py", "implement controller", "viết whitelisted method", "tạo Print Format", "fixtures export", "build từ blueprint". Do NOT use this skill if the design isn't ready (use nextcode-design first), or for debugging/auditing existing code (use nextcode-debug or nextcode-xray). This skill writes app code; it requires an approved blueprint as input.
---

# Nextcode Build — Custom App Implementation Master

Skill này áp dụng **Coder Pack discipline** của Vibecode V5 vào Frappe domain.

Tiền điều kiện: **đã có blueprint duyệt** (từ `nextcode-design`) hoặc spec rõ ràng do user cung cấp. Nếu chưa, em từ chối build và yêu cầu chạy `nextcode-design` trước.

Đọc full master prompt ở `references/prompt.md`.

## Quick reference

**Output bắt buộc**:
- Bench commands (sequential, có comment giải thích)
- DocType JSON (đầy đủ, không gọn)
- Python controller class (với hooks: validate, before_save, on_submit, ...)
- `hooks.py` block-by-block
- Server/Client Scripts khi phù hợp (vs. file Python trong app — em sẽ giải thích trade-off)
- Whitelisted API methods
- Print Format (Jinja, dùng class prefix khi embed vào ERPNext UI)
- Patches.txt + patch files
- Fixtures export commands

**Quy ước**:
- App name snake_case
- 1 file = 1 chức năng (KHÔNG nhồi nhiều DocType vào 1 file)
- Mọi whitelisted method có docstring + permission check
- Mọi `frappe.db.sql` có comment giải thích vì sao không dùng ORM

## ⚠️ Fixtures & install — đọc TRƯỚC khi ship

Tầng dễ vỡ nhất khi `bench install-app` là **fixtures**: import chạy full
validate, theo thứ tự **alphabet tên file**, lỗi không-phải-ImportError là chết
install, và **KHÔNG áp schema default** trước mandatory. Một app ~47 DocType có
thể chết **8 vòng liên tiếp**, mỗi vòng một lớp lỗi khác.

- **Luật vàng:** luôn `bench export-fixtures`, đừng viết tay fixtures (mất `name`,
  thiếu field reqd, sai kiểu Table/Select). Buộc viết tay → chạy validator dưới.
- **15 cạm bẫy + cách build đúng + bảng tra lỗi:** `references/fixtures-install-pitfalls.md`.
- **Cổng kiểm trước khi cài** (bắt buộc nếu fixtures viết tay):
  ```bash
  python3 references/validate_shipped_docs.py <path/tới/apps/myapp/myapp>
  # 0 ERROR mới đem cài. Chạy lại sau mỗi lần sửa fixture.
  ```
- **Custom DocPerm KHÔNG ship qua fixture** (hash name, đổi giữa site) → cấp quyền
  bằng `add_permission`/`update_permission_property` trong `after_install`.
- **Mọi seed trong after_install** bọc `try/except` + `log_error` — lỗi seed
  không được làm chết install.
