# -*- coding: utf-8 -*-
"""Order (Sales Invoice) creation for the NPP portal.

Tạo đơn ở server thay vì để client gọi get_item_details + frappe.client.insert:
- Quy đổi thùng → hộp bằng Item.custom_quycach (1 nguồn sự thật, server-side).
- KHÔNG phụ thuộc UOM 'Thùng' khai trên từng Item (qty nộp theo stock UOM = hộp).
- Giá để ERPNext tự áp theo selling_price_list (gồm pricing rule/khuyến mãi).
- Báo lỗi rõ ràng (customer chưa gán, item không tồn tại...) thay vì để client
  "quay tròn" do promise không settle.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, today

from ._utils import require_customer

# Mirror npp/public/npp/views/_config.js — giữ đồng bộ khi đổi.
COMPANY = "Công ty cổ phần Hoàng Giang"
PRICE_LIST = "TỈNH"
CURRENCY = "VND"


@frappe.whitelist()
def create_order(items, note: str | None = None) -> dict:
    """Tạo Sales Invoice nháp cho NPP của user hiện tại.

    Args:
        items: JSON string (hoặc list) gồm {"item_code": str, "cases": int}.
               `cases` = số THÙNG người dùng đặt.
        note:  ghi chú NPP (tùy chọn).

    Returns: {"name": <tên SI>, "grand_total": <tổng>}.

    Permission: chỉ tạo cho Customer gắn với user hiện tại (require_customer).
    """
    customer = require_customer()  # throw lỗi rõ ràng nếu user chưa gán NPP

    if isinstance(items, str):
        items = frappe.parse_json(items)
    if not items:
        frappe.throw(_("Đơn hàng trống — chưa chọn sản phẩm."))

    si = frappe.new_doc("Sales Invoice")
    si.customer = customer
    si.company = COMPANY
    si.selling_price_list = PRICE_LIST
    si.currency = CURRENCY
    si.posting_date = today()
    si.due_date = today()
    # Field tiếng Việt có dấu → dùng .set() với key dạng string (không qua
    # định danh Python để tránh chuẩn hóa NFKC làm lệch tên cột).
    si.set("custom_trạng_thái_vận_chuyển", "Chờ xử lý")
    if note:
        si.set("custom_ghi_chú_npp", note)

    for row in items:
        code = (row.get("item_code") or "").strip()
        cases = cint(row.get("cases"))
        if not code or cases <= 0:
            continue
        if not frappe.db.exists("Item", code):
            frappe.throw(_("Sản phẩm không tồn tại: {0}").format(code))
        # quy cách = số hộp/thùng; đọc từ field custom_quycach trên Item.
        # Chưa nhập → coi như 1 (đặt theo hộp).
        quycach = cint(frappe.db.get_value("Item", code, "custom_quycach")) or 1
        si.append(
            "items",
            {
                "item_code": code,
                "qty": cases * quycach,  # qty theo stock UOM (hộp)
            },
        )

    if not si.get("items"):
        frappe.throw(_("Đơn hàng trống — số lượng phải lớn hơn 0."))

    # Portal/website user thường không có quyền tạo Sales Invoice trực tiếp;
    # endpoint kiểm soát customer = customer của chính user nên an toàn.
    si.insert(ignore_permissions=True)
    return {"name": si.name, "grand_total": si.grand_total}
