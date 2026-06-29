# -*- coding: utf-8 -*-
"""NVBH (Sales Staff) chỉ dùng portal /dp, KHÔNG vào Desk → chuyển mọi User gắn với
Sales Staff Profile sang user_type = 'Website User' (chặn /app). Bỏ qua nếu chưa
cài salep (chưa có doctype Sales Staff Profile)."""

import frappe


def execute():
    if not frappe.db.table_exists("Sales Staff Profile"):
        return
    users = {u for u in frappe.get_all("Sales Staff Profile", pluck="user") if u}
    for u in users:
        if frappe.db.exists("User", u) and frappe.db.get_value("User", u, "user_type") != "Website User":
            frappe.db.set_value("User", u, "user_type", "Website User")
