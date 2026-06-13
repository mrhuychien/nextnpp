# -*- coding: utf-8 -*-
"""Shared helpers for NPP Portal API endpoints."""

from __future__ import annotations

import frappe
from frappe import _

# Role được xem dữ liệu của MỌI NPP (quản lý kênh bán hàng / kế toán / admin).
MANAGER_ROLES = {"Sales Manager", "Accounts Manager", "System Manager"}


def is_manager() -> bool:
    """User hiện tại có quyền quản lý (xem toàn bộ NPP) hay không."""
    return bool(MANAGER_ROLES & set(frappe.get_roles()))


def require_customer(customer: str | None = None) -> str:
    """Trả Customer dùng cho các endpoint self-view.

    - User thường: LUÔN trả custom_customer của chính họ; tham số `customer` bị
      bỏ qua → không thể xem trộm dữ liệu NPP khác.
    - Quản lý (MANAGER_ROLES): được phép truyền `customer` để 'xem thay' 1 NPP.

    Raises PermissionError nếu Guest hoặc user thường chưa gán Customer.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Login required"), frappe.PermissionError)

    if customer and is_manager():
        if not frappe.db.exists("Customer", customer):
            frappe.throw(_("Customer không tồn tại: {0}").format(customer))
        return customer

    own = frappe.db.get_value("User", frappe.session.user, "custom_customer")
    if not own:
        frappe.throw(
            _("User account is not linked to any Customer. Contact administrator."),
            frappe.PermissionError,
        )
    return own
