---
name: frappe-sales-analytics
description: Use when building manager/channel analytics, KPIs, or dashboards over ERPNext v16 Sales Invoices — revenue, growth/YoY, debt & aging/DSO, gross margin, customer lifecycle segmentation, Pareto concentration, target attainment, or a single-customer drill-down — exposed as role-gated whitelisted API methods. Triggers include "phân tích doanh số", "dashboard quản lý kênh", "doanh số theo tháng/nhóm hàng/tỉnh", "tăng trưởng so kỳ / YoY", "biên lợi nhuận / COGS", "công nợ tuổi nợ / aging / DSO", "phân khúc NPP / vòng đời khách", "Pareto 80/20", "% đạt mục tiêu", "chi tiết 1 khách hàng", "whitelisted method báo cáo", "loại hoá đơn opening". Do NOT use for the browser/portal UI (use frappe-portal-spa), for generic DocType/controller scaffolding (use nextcode-build), or for query tuning unrelated to these metrics (use nextcode-perf). This skill is about correct sales-metric semantics + safe SQL on Sales Invoice.
---

# Frappe Sales Analytics — số liệu đúng + SQL an toàn

Skill này gói các **định nghĩa chỉ số đúng** và **mẫu SQL** để dựng analytics bán
hàng/công nợ trên ERPNext Sales Invoice (mô hình chỉ-dùng-Sales-Invoice,
`update_stock=Yes`). Đi kèm cách phân quyền method.

Term tiếng Anh giữ nguyên (Sales Invoice, whitelisted, COGS, DSO, aging, segment).

## Khi nào dùng
Viết method backend tính doanh số/công nợ/biên LN/phân khúc cho dashboard quản lý
hoặc trang chi tiết 1 khách. KHÔNG dùng cho UI (xem `frappe-portal-spa`) hay
scaffold DocType (xem `nextcode-build`).

## ⚠️ 5 luật số liệu không được sai

1. **Loại hoá đơn opening khỏi DOANH SỐ:** mọi truy vấn doanh số/sản lượng phải có
   `AND IFNULL(si.is_opening,'No')!='Yes'`. Hoá đơn opening là số dư đầu kỳ, không
   phải bán hàng → tính vào sẽ thổi phồng doanh số. **Nhưng CÔNG NỢ thì GIỮ** opening
   (nó là nợ thật) → query `outstanding_amount` KHÔNG lọc is_opening.

2. **So sánh phải cùng-kỳ (period-aligned):** kỳ hiện tại tính **đến hôm nay**
   (partial, `end=today`). Kỳ trước = dịch cửa sổ đi N tháng; YoY = dịch 12 tháng;
   **giữ nguyên số ngày đã trôi**. Tuyệt đối không so "MTD đến nay" với "cả tháng
   trước" → sẽ ra "tụt -65%" giả. MTD-vs-MTD: `prev_end = prev_first + (today.day-1)`.

3. **Biên lợi nhuận cần COGS thật:** vì `update_stock=Yes`, mỗi
   `Sales Invoice Item` có `incoming_rate` và `stock_qty` →
   `COGS = SUM(incoming_rate * stock_qty)`; `margin% = (revenue-COGS)/revenue`.
   Không lấy giá vốn ở chỗ khác.

4. **Đơn vị thùng:** sản lượng/“ca” lọc `sii.uom IN ('Thùng','Box')`. Doanh số tiền
   thì dùng `grand_total` (hoá đơn) hoặc `sii.amount` (dòng) — chọn 1 và nhất quán.

5. **Run-rate (ước cả tháng):** `MTD / số_ngày_đã_qua * số_ngày_trong_tháng`. Dùng
   để cảnh báo sớm, luôn ghi rõ là "ước tính".

## Phân quyền method (bắt buộc)

- **Quản lý kênh** (toàn bộ NPP): gate bằng role.
  ```python
  MANAGER_ROLES = {"Sales Manager", "Accounts Manager", "System Manager"}
  def is_manager(): return bool(MANAGER_ROLES & set(frappe.get_roles()))
  def _guard():
      if frappe.session.user == "Guest": frappe.throw(_("Login required"), frappe.PermissionError)
      if not is_manager(): frappe.throw(_("Chỉ quản lý..."), frappe.PermissionError)
  ```
- **Self-view 1 khách** (NPP chỉ thấy chính mình): `require_customer(customer=None)` —
  manager được truyền `customer` bất kỳ; user thường **ép** về `custom_customer` của họ.
  Đây là ranh giới chống rò rỉ dữ liệu đa-khách: **không bao giờ** để 1 khách xem
  được hoá đơn/công nợ của khách khác.
- Mọi method `@frappe.whitelist()` + docstring + gọi guard ở dòng đầu.

## Bộ chỉ số chuẩn (công thức)

- **Phân khúc vòng đời** (theo lần mua cuối + xu hướng 90 ngày): `Chưa mua` (chưa có
  đơn) · `Mất` (>90 ngày) · `Ngủ đông` (>30 ngày) · `Mới` (đơn đầu trong 90 ngày) ·
  `Tăng trưởng` (rev90 > prev90×1.2) · `Suy giảm` (rev90 < prev90×0.8) · `Ổn định`.
- **Nhịp tái đặt:** `avg_cycle = (last-first)/(orders-1)`; **quá hạn tái đặt** nếu
  `days_since > avg_cycle × 1.5`.
- **Hạng A/B/C** theo **doanh số bình quân tháng** (trailing 12 tháng / 12):
  A ≥ 200tr, B ≥ 100tr, C còn lại. (Ngưỡng là tham số — hỏi user.)
- **Aging:** chia theo `COALESCE(due_date, posting_date)` so với hôm nay:
  trong hạn / 1–30 / 31–60 / 61–90 / >90. **DSO** ≈ `debt / rev_12 × 365`.
- **Pareto:** sort khách giảm dần theo doanh số → `top5_pct`, `top10_pct`,
  `npp_for_80` (số khách tạo 80% doanh số). Tập trung cao = rủi ro phụ thuộc.
- **% đạt mục tiêu:** field `custom_monthly_target` (Currency, thêm bằng Custom Field);
  `attainment = revenue / (monthly_target × months)`; so với **nhịp kỳ vọng**
  `pace = số_ngày_đã_qua / tổng_ngày_kỳ` (không so target cả kỳ khi mới giữa kỳ).
- **Tỉnh:** ERPNext `territory` hay rỗng/"Vietnam" → chuẩn hoá: ưu tiên territory
  (nếu không generic), else dò tên 63 tỉnh trong `customer_name`. Phát cờ
  `territory_clean` (vd ≥90% khách có tỉnh) để bật/tắt biểu đồ theo tỉnh.

Chi tiết công thức + mẫu SQL copy-paste: `references/metrics-and-sql.md`.

## Mẫu SQL an toàn (tóm tắt)
- Tham số hoá: `WHERE customer IN %s` truyền **tuple** `names`; không nối chuỗi.
- `frappe.db.sql(q, params, as_dict=True)`; literal `%` của `DATE_FORMAT` phải
  **`%%`** (`DATE_FORMAT(posting_date,'%%Y-%%m')`) vì `%s` là placeholder.
- Helper gom theo khách: `_sum_by_customer(q, params) -> {customer: float}`.
- Số tiền/None: bọc `flt()`, `COALESCE(...,0)`; tỷ lệ luôn guard chia 0 → trả `None`.

## Cạm bẫy cột (đã từng dính)
- `Pricing Rule Detail` **không** có cột `customer` → lọc theo `pr.customer` (parent
  Pricing Rule), đừng join `prd.customer`.
- `Item` **không** có `total_weight`; trọng lượng đơn nằm ở **parent** Sales Invoice
  `total_net_weight`.
- `Customer Credit Limit` là **child table** (`parenttype='Customer'`) → đọc qua
  `frappe.get_all("Customer Credit Limit", filters={"parent": ...})`, bọc try/except
  (nhiều site không set).

## Checklist review method analytics
- [ ] Doanh số có lọc `is_opening`? Công nợ thì KHÔNG lọc?
- [ ] So sánh period-aligned (cùng số ngày)? Không partial-vs-full?
- [ ] Margin dùng `incoming_rate*stock_qty`?
- [ ] Guard role/`require_customer` ở dòng đầu method?
- [ ] `customer IN %s` truyền tuple; `%%` trong DATE_FORMAT?
- [ ] Mọi tỷ lệ guard chia 0 (trả None, không 0/0)?
- [ ] Drill-down 1 khách KHÔNG để lộ dữ liệu khách khác?
