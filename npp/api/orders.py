# -*- coding: utf-8 -*-
"""Order (Sales Invoice) creation/update for the NPP portal.

Tạo/sửa đơn ở server thay vì để client gọi get_item_details + frappe.client.insert:
- Đặt theo đơn vị 'Thùng': qty = số thùng; ERPNext tự quy đổi sang stock UOM và
  áp giá theo UOM 'Thùng' của Item (Item cần khai đơn vị 'Thùng' + hệ số quy đổi).
- Giá để ERPNext tự áp theo selling_price_list (gồm pricing rule/khuyến mãi).
- Báo lỗi rõ ràng (customer chưa gán, item không tồn tại, đơn đã chốt...) thay vì
  để client "quay tròn" do promise không settle.
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


def _apply_items(si, items) -> None:
    """Thay TOÀN BỘ dòng hàng của SI bằng `items` = [{item_code, cases}].

    qty = số thùng (cases), uom='Thùng' — ERPNext tự quy đổi + áp giá.
    Throw nếu không có dòng hợp lệ nào.
    """
    if isinstance(items, str):
        items = frappe.parse_json(items)

    si.set("items", [])
    for row in items or []:
        code = (row.get("item_code") or "").strip()
        cases = cint(row.get("cases"))
        if not code or cases <= 0:
            continue
        if not frappe.db.exists("Item", code):
            frappe.throw(_("Sản phẩm không tồn tại: {0}").format(code))
        si.append("items", {"item_code": code, "qty": cases, "uom": "Thùng"})

    if not si.get("items"):
        frappe.throw(_("Đơn hàng trống — số lượng phải lớn hơn 0."))


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
    customer = require_customer()

    si = frappe.new_doc("Sales Invoice")
    si.customer = customer
    si.company = COMPANY
    si.selling_price_list = PRICE_LIST
    si.currency = CURRENCY
    si.posting_date = today()
    si.due_date = today()
    # KHÔNG set "custom_trạng_thái_vận_chuyển" ở đây — field này do hệ thống chính
    # quản lý; giá trị khởi tạo lấy theo default của field (do vận hành cấu hình).
    if note:
        si.set("custom_ghi_chú_npp", note)

    _apply_items(si, items)

    si.insert(ignore_permissions=True)
    return {"name": si.name, "grand_total": si.grand_total}


@frappe.whitelist()
def update_order(invoice, items, note: str | None = None) -> dict:
    """Cập nhật một Sales Invoice NHÁP của NPP hiện tại (sửa số lượng/ghi chú).

    Args:
        invoice: tên Sales Invoice cần sửa (phải còn nháp, docstatus=0).
        items:   JSON list {"item_code", "cases"} — THAY TOÀN BỘ dòng hàng.
        note:    ghi chú NPP mới (None = giữ nguyên; "" = xoá ghi chú).

    Returns: {"name": <tên SI>, "grand_total": <tổng>}.
    Permission: chỉ sửa đơn thuộc Customer của user hiện tại, và còn nháp.
    """
    customer = require_customer()

    if not invoice or not frappe.db.exists("Sales Invoice", invoice):
        frappe.throw(_("Không tìm thấy đơn: {0}").format(invoice or ""))

    si = frappe.get_doc("Sales Invoice", invoice)
    if si.customer != customer:
        frappe.throw(_("Không có quyền sửa đơn này."), frappe.PermissionError)
    if si.docstatus != 0:
        frappe.throw(_("Đơn đã chốt hoặc đã huỷ — không sửa được."))

    _apply_items(si, items)
    if note is not None:
        si.set("custom_ghi_chú_npp", note)

    si.save(ignore_permissions=True)
    return {"name": si.name, "grand_total": si.grand_total}
