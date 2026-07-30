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


def salep_photos(parenttype: str, parent: str, parentfield: str) -> list[dict]:
    """Đọc NHIỀU ảnh (child table 'Display Photo' của salep) của 1 bản ghi.
    Trả list {url, captured_on, latitude, longitude}. An toàn nếu chưa có doctype."""
    if not parent:
        return []
    try:
        rows = frappe.get_all(
            "Display Photo",
            filters={"parenttype": parenttype, "parent": parent, "parentfield": parentfield},
            fields=["image", "captured_on", "latitude", "longitude"], order_by="idx asc")
    except Exception:
        return []
    return [{"url": r["image"],
             "captured_on": str(r["captured_on"]) if r.get("captured_on") else None,
             "latitude": r.get("latitude"), "longitude": r.get("longitude")}
            for r in rows if r.get("image")]


def salep_photos_map(parenttype: str, parents, parentfield: str) -> dict:
    """Như salep_photos nhưng cho NHIỀU parent 1 lần (gộp theo parent) — tránh N+1."""
    parents = [p for p in (parents or []) if p]
    if not parents:
        return {}
    try:
        rows = frappe.get_all(
            "Display Photo",
            filters={"parenttype": parenttype, "parent": ["in", parents], "parentfield": parentfield},
            fields=["parent", "image", "captured_on", "latitude", "longitude"], order_by="idx asc")
    except Exception:
        return {}
    out: dict = {}
    for r in rows:
        if r.get("image"):
            out.setdefault(r["parent"], []).append(
                {"url": r["image"], "captured_on": str(r["captured_on"]) if r.get("captured_on") else None,
                 "latitude": r.get("latitude"), "longitude": r.get("longitude")})
    return out
