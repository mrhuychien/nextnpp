---
name: frappe-app-build-profile
description: Use when starting or scaffolding a NEW Frappe/ERPNext v16 custom app (or a major new module) and the user wants it built in the established house style ("kiểu NPP"): spec-first nextcode workflow with approval gates, a Python whitelisted-method backend (NO scattered Server/Client Scripts), a standard-doctype + custom-fields data model, a vanilla-JS no-build SPA portal, role-gated analytics, and verify-before-ship discipline. Triggers include "build app mới kiểu NPP", "scaffold Frappe app theo chuẩn của tôi", "theo phương pháp nextcode", "dựng app Frappe như app NPP", "build brief cho app Frappe". Do NOT use for debugging existing apps (use nextcode-debug), version upgrades (use nextcode-migrate), security audits (use nextcode-security), or non-Frappe tasks. This skill is the ORCHESTRATOR/house-style profile — it sets conventions and delegates deep detail to nextcode-* and the frappe-* skills.
---

# Frappe App Build Profile — "kiểu NPP"

Đây là **hồ sơ phong cách build** cho mọi Frappe/ERPNext v16 custom app: gom phương
pháp + quy ước nhất quán đã dùng khi dựng NPP Portal, và **nối** các skill chuyên sâu
lại. Mục tiêu: app mới chỉ cần điền **build brief**, phần stack/convention tự áp dụng.

Term tiếng Anh giữ nguyên (DocType, whitelisted method, fixture, SPA, hook…).

## Khi nào dùng / không dùng
- DÙNG: khởi tạo app/module Frappe mới muốn theo đúng "kiểu NPP".
- KHÔNG: debug app cũ (`nextcode-debug`), nâng version (`nextcode-migrate`), audit
  bảo mật (`nextcode-security`), việc không liên quan Frappe.

## Trục 1 — Phương pháp (quy trình)
1. **Design trước** (`nextcode-design`): nghiệp vụ → ERD/DocType/phân quyền → blueprint.
   **Approval gate**: chưa duyệt blueprint thì chưa viết code.
2. **Build** (`nextcode-build`): scaffold app, controller, whitelisted method, fixtures,
   Print Format. Fixtures **export** chứ không viết tay; chạy validator.
3. **Verify trước ship** (`frappe-app-shipping-gotchas`): `py_compile` + `node --check` +
   `validate_shipped_docs.py` (0 ERROR); kiểm `__init__.py` mọi module.
4. **QA** (`nextcode-qa`) khi cần test/regression.
- Xuyên suốt: **commit-per-feature** (message ghi P0/P1/P2), push nhánh dev (+ default
  nếu được phép), retry/backoff. Xong việc → **đúc kết learnings thành skill** và đẩy
  lên kho skills trung tâm.
- Khi nghi ngờ hành vi Frappe v16: **đọc source thật** (raw GitHub) thay vì đoán.

## Trục 2 — Quy ước cứng (non-negotiable)
- **Backend = file Python trong app** (`api/*.py` whitelisted method). KHÔNG rải
  Server/Client Script. Mỗi method: docstring + **permission check** ở dòng đầu
  (`_guard` cho quản lý, `require_customer` cho self-view). `frappe.db.sql` có comment.
- **Data model tiết kiệm**: tận dụng DocType chuẩn (Sales Invoice, Customer, Item…) +
  **Custom Field qua fixtures**; chỉ tạo DocType mới khi thật cần. **Fieldname ASCII**
  (dù label có dấu) — xem `frappe-app-shipping-gotchas`.
- **Frontend = SPA portal no-build** (nếu cần giao diện khách/ngoài Desk): vanilla JS,
  ES module code-split, hash router, **import-map cache-bust**, CSS prefix, Chart.js
  lazy, mobile-first → chi tiết `frappe-portal-spa`.
- **Analytics/số liệu**: loại `is_opening`, so kỳ **period-aligned**, margin bằng
  `incoming_rate×stock_qty`, segment/aging/DSO/Pareto/target → `frappe-sales-analytics`.
- **Bảo mật đa-khách**: tách **self-view** (ép `custom_customer` của user) vs
  **manager-view** (role-gated); không leak cross-customer.

## Trục B — Build brief (điền cho MỖI app mới)
```
# Build brief — <Tên app>
Nền tảng: Frappe/ERPNext v16 custom app, theo phương pháp nextcode + skills
frappe-portal-spa / frappe-sales-analytics / frappe-app-shipping-gotchas.

1. Domain & nghiệp vụ:  <ai dùng, làm gì, bài toán chính>
2. DocType & field:     <DocType chuẩn tận dụng + Custom Field cần thêm>
3. Vai trò & phân quyền:<role nào thấy gì; self-view vs manager-view>
4. Giao diện:           <Desk hay portal SPA? liệt kê màn hình>
5. Analytics (nếu có):  <KPI / so kỳ / margin…>
6. Ràng buộc:           backend Python whitelisted method (không Server Script);
                        fixtures cho custom field; fieldname ASCII;
                        verify py_compile/node --check/validator; commit-per-feature.
7. Git:                 push nhánh <…> (+ default nếu được phép).
```
Câu mở màn gợi ý: *"Build app `<tên>` theo kiểu NPP (nextcode + 3 skill frappe-*).
Brief: …"*

## Bản đồ ủy thác (việc → skill)
| Việc | Skill |
|---|---|
| Thiết kế nghiệp vụ → schema/phân quyền | `nextcode-design` |
| Scaffold + controller + whitelisted + fixtures + Print Format | `nextcode-build` |
| Portal SPA (router, cache-bust, CSS, chart) | `frappe-portal-spa` |
| Số liệu doanh số/công nợ/biên LN/segment | `frappe-sales-analytics` |
| Install/deploy gotchas (`__init__.py`, custom field, migrate→build→restart) | `frappe-app-shipping-gotchas` |
| Test/regression/code review | `nextcode-qa` |
| Tối ưu/performance · bảo mật | `nextcode-perf` · `nextcode-security` |

## Checklist ship (rút gọn)
- [ ] Blueprint đã duyệt trước khi code?
- [ ] Backend là Python whitelisted method (không Server Script rải rác), có guard quyền?
- [ ] DocType chuẩn + Custom Field (fixtures), fieldname ASCII; không DocType thừa?
- [ ] Portal (nếu có) theo `frappe-portal-spa` (import-map, CSS prefix, code-split)?
- [ ] Số liệu theo `frappe-sales-analytics` (loại opening, period-aligned, COGS)?
- [ ] `py_compile` + `node --check` + validator fixtures 0 ERROR; mọi module có `__init__.py`?
- [ ] Commit-per-feature; push đúng nhánh; đã đúc kết learnings mới thành skill?
