---
name: nextcode-qa
description: Use when the user wants to write tests, do code review, or set up QA processes for a Frappe/ERPNext v16 custom app. Triggers include "viết test", "FrappeTestCase", "unit test cho DocType", "code review", "checklist QA", "test coverage", "viết regression test cho bug vừa fix", "test fixtures", "mock Frappe call". Do NOT use this skill if the user wants to debug a specific bug (use nextcode-debug), build new features (use nextcode-build), or fix performance (use nextcode-perf). This skill produces tests + review reports; it doesn't ship features.
---

# Nextcode QA — Frappe Testing & Review Master

Skill này áp dụng **3-tier QA discipline** của Vibecode V5 cho Frappe context.

Đọc full master prompt ở `references/prompt.md`.

## Quick reference

**3 tier**:
1. **Tier 1 — Tests** (FrappeTestCase, fixtures-based)
2. **Tier 2 — Code review** (Frappe-specific anti-pattern checklist)
3. **Tier 3 — UAT scripts** (manual test script cho người không phải dev)

**Output**:
- `test_*.py` files đặt trong `npp_sale/npp_sale/doctype/<dt>/test_<dt>.py` hoặc `npp_sale/tests/`
- `test_records.json` (fixture data tối thiểu)
- `REVIEW_REPORT.md`
- `UAT_SCRIPT.md`

## 🚦 Cổng kiểm fixtures/install (thêm vào CI/pre-merge)

App có ship fixtures (viết tay) → thêm gate **trước** khi `install-app`/merge:
```bash
python3 <validate_shipped_docs.py> apps/<app>/<app>   # 0 ERROR mới qua
```
Script + 15 cạm bẫy install ở skill `nextcode-build`
(`references/validate_shipped_docs.py`, `references/fixtures-install-pitfalls.md`).
Tier-2 review nên có mục: fixtures `export-fixtures` chứ không viết tay; Custom
DocPerm không ship qua fixture; mọi seed `after_install` bọc try/except. Khi viết
regression test cho bug install vừa fix → assert `install-app` trên site sạch
chạy trọn (hoặc validator ra 0 ERROR).
