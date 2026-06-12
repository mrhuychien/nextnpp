---
name: nextcode-design
description: Use when the user wants to design a NEW Frappe/ERPNext v16 custom app from business requirements — before any code is written. Triggers include "thiết kế DocType", "phân tích nghiệp vụ", "ERD cho ERPNext", "blueprint custom app", "phân quyền matrix", "schema design Frappe", "map nghiệp vụ X lên DocType", or any request that asks to translate business operations into a Frappe data model and architecture plan. Do NOT use this skill for implementing existing specs (use nextcode-build), debugging existing apps (use nextcode-debug), or auditing existing codebases (use nextcode-xray). This skill stops at producing the design document — it never writes app code.
---

# Nextcode Design — DocType Blueprint Master

Skill này áp dụng **Blueprint discipline** của Vibecode V5 vào Frappe domain.

Mục tiêu: chuyển nghiệp vụ thực tế (anh kể bằng tiếng Việt, có thể lộn xộn) thành **bộ tài liệu thiết kế đủ chi tiết để `nextcode-build` thực thi không cần hỏi lại**.

Đọc full master prompt ở `references/prompt.md` và **làm theo từng giai đoạn, có approval gate**.

## Quick reference

**Output bắt buộc** (file Markdown trong workspace user):
1. `01_business_model.md` — bối cảnh nghiệp vụ, actors, use cases
2. `02_doctype_blueprint.md` — danh sách DocType + fields + naming + relationship
3. `03_permission_matrix.md` — Role × DocType × ifownor/permlevel
4. `04_workflow_blueprint.md` — state machine cho DocType có workflow
5. `05_integration_plan.md` — link với core ERPNext (Sales Invoice, Item, Customer, ...) + hooks plan
6. `06_fixtures_plan.md` — Roles, Custom Fields, Property Setters, Print Formats sẽ ship qua fixtures

**Approval gate**: Sau mỗi file, dừng lại hỏi anh confirm trước khi sang file kế. Không bao giờ viết code app.
