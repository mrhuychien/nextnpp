---
name: nextcode-xray
description: Use when the user has an EXISTING Frappe/ERPNext custom app and wants to understand, audit, or hand it over to a new developer — without changing code yet. Triggers include "audit codebase", "handover app", "tôi vừa nhận project ERPNext", "đọc hiểu app này", "tech debt scan", "inventory custom fields/scripts/hooks", "tài liệu hóa app cũ", "what does this app do". Do NOT use this skill if the user wants to build something new (use nextcode-design or nextcode-build), debug a specific bug (use nextcode-debug), or migrate to a new version (use nextcode-migrate). This skill produces handover documentation only — it doesn't modify code.
---

# Nextcode X-Ray — Custom App Handover Master

Skill này áp dụng **Handover Protocol** của Vibecode V5 vào Frappe domain — đọc và document hệ thống mà không sửa.

Đọc full master prompt ở `references/prompt.md`.

## Quick reference

**Output**:
- `XRAY_REPORT.md` — báo cáo tổng (executive summary 1 trang + chi tiết)
- `INVENTORY.md` — bảng kê DocTypes, Custom Fields, Property Setters, Server Scripts, Client Scripts, Print Formats, Reports, Workflows
- `HOOKS_MAP.md` — tất cả hooks.py entries với phân tích tác động
- `PERMISSION_MAP.md` — Role × DocType current state
- `TECH_DEBT.md` — code smells, anti-patterns, security/perf concerns
- `RUNBOOK.md` — cách chạy local, deploy, backup, restore
