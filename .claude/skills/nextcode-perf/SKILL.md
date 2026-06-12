---
name: nextcode-perf
description: Use when the user wants to optimize performance of a Frappe/ERPNext v16 system — slow queries, slow reports, slow page loads, slow background jobs, or Jinja-heavy print formats. Triggers include "chậm", "slow", "tối ưu query", "report 30s", "N+1 query", "thiếu index", "Jinja chậm", "page load lag", "background job timeout", "CPU cao", "redis full", "MariaDB slow log". Do NOT use this skill for fixing functional bugs (use nextcode-debug), security issues (use nextcode-security), or initial design (use nextcode-design). This skill measures, diagnoses, and proposes fixes — measurement-driven, not guesswork.
---

# Nextcode Perf — Frappe Performance Master

Skill này áp dụng **Speed Demon discipline** của Vibecode V5 cho Frappe context.

Đọc full master prompt ở `references/prompt.md`.

## Quick reference

**Triết lý**: Đo trước, tối ưu sau. Không tối ưu cái không có data.

**4 layer hiệu năng Frappe**:
1. **DB** — query plan, index, N+1, transaction lock
2. **Application** — ORM overhead, hook chain, Server Script execution
3. **Cache** — Redis, document cache, request cache
4. **Frontend** — bundle size, Vue render, list view fetch_from cascade

**Output**:
- `PERF_BASELINE.md` — số đo before
- `BOTTLENECK_ANALYSIS.md` — phân tích từng bottleneck
- `OPTIMIZATION_PLAN.md` — fix theo priority (impact × effort)
- Code patches cụ thể
- `PERF_RESULT.md` — số đo after, so sánh
