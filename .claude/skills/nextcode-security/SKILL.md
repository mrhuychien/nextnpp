---
name: nextcode-security
description: Use when the user wants to audit or harden security of a Frappe/ERPNext v16 custom app — permission misconfigurations, SQL injection risks, unsafe whitelisted methods, data leakage in print/report, file upload risks, or insecure server-side validation. Triggers include "permission audit", "SQL injection", "user thấy data của user khác", "lộ data", "User Permission audit", "Role Permission Manager", "secure whitelisted method", "hardening", "OWASP", "security review". Do NOT use this skill for general bugs (use nextcode-debug), performance (use nextcode-perf), or new app design (use nextcode-design).
---

# Nextcode Security — Frappe Hardening Master

Skill này áp dụng **Fortress discipline** của Vibecode V5 cho Frappe domain. Tập trung vào permission system 4 lớp + Frappe-specific attack surfaces.

Đọc full master prompt ở `references/prompt.md`.

## Quick reference

**Output**:
- `SECURITY_AUDIT.md` — finding theo severity (Critical/High/Medium/Low)
- `PERMISSION_AUDIT.md` — gap analysis Role × DocType × permlevel
- Fixes (code patches + Property Setter + Role config)
- `HARDENING_CHECKLIST.md` — checklist deploy production

**Frappe attack surfaces phổ biến**:
1. Whitelisted method không check permission
2. `frappe.db.sql` parameterized sai
3. `eval` / `exec` trên user input (Server Script)
4. File upload không validate type/size
5. `frappe.get_attr()` với user input
6. User Permission đặt sai → user thấy hết
7. Print Format expose field permlevel
8. Webhook payload không sign
9. API key lưu plaintext trong code/log
