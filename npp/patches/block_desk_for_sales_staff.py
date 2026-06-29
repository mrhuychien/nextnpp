# -*- coding: utf-8 -*-
"""NVBH (Sales Staff) chỉ dùng portal /dp, KHÔNG vào Desk.

1) Tắt desk_access trên role 'Sales Staff' — nếu còn bật, User.set_system_user()
   sẽ ép user_type='System User' (theo has_desk_access) và NV vào được Desk.
2) Chuyển mọi User gắn Sales Staff Profile sang user_type='Website User'.
Bỏ qua nếu chưa cài salep."""

import frappe


def execute():
    if frappe.db.exists("Role", "Sales Staff") and frappe.db.get_value("Role", "Sales Staff", "desk_access"):
        frappe.db.set_value("Role", "Sales Staff", "desk_access", 0)

    if not frappe.db.table_exists("Sales Staff Profile"):
        return
    users = {u for u in frappe.get_all("Sales Staff Profile", pluck="user") if u}
    for u in users:
        if frappe.db.exists("User", u) and frappe.db.get_value("User", u, "user_type") != "Website User":
            frappe.db.set_value("User", u, "user_type", "Website User")
