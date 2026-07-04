# -*- coding: utf-8 -*-
"""Gán cho role 'NPP' đầy đủ QUYỀN (DocPerm) giống role 'Sales Staff'.

Lý do: NPP (nhà phân phối) cũng đi bán/trưng bày → cần thao tác trên các doctype
của salep (Display Point, Display Participation, ...) với quyền y như nhân viên bán.

Cách làm: với mỗi doctype mà Sales Staff đang có quyền, sao chép CHÍNH XÁC các ptype
(read/write/create/... + if_owner) sang role NPP bằng API permission của Frappe
(add_permission/update_permission_property). Dùng API này để Frappe tự copy toàn bộ
DocPerm chuẩn sang Custom DocPerm khi customize lần đầu → KHÔNG phá quyền role khác.

- Idempotent: chạy lại vẫn cho kết quả đúng (đồng bộ lại quyền = Sales Staff).
- Sales Staff chưa có (chưa cài salep) → bỏ qua.
- Role NPP chưa có → tạo mới (desk_access=0, chỉ dùng portal, không vào Desk).

Muốn đồng bộ lại sau khi Sales Staff đổi quyền:
    bench --site <site> execute npp.patches.grant_npp_sales_staff_perms.execute
"""

import frappe
from frappe.permissions import add_permission, update_permission_property

SRC_ROLE = "Sales Staff"
DST_ROLE = "NPP"
PTYPES = ["read", "write", "create", "delete", "submit", "cancel", "amend",
          "report", "export", "import", "print", "email", "share",
          "set_user_permissions", "if_owner", "select"]


def execute():
    if not frappe.db.exists("Role", SRC_ROLE):
        return  # chưa có Sales Staff (chưa cài salep) → không có gì để sao chép

    if not frappe.db.exists("Role", DST_ROLE):
        role = frappe.new_doc("Role")
        role.role_name = DST_ROLE
        role.desk_access = 0            # NPP dùng portal, không vào Desk
        role.flags.ignore_permissions = True
        role.insert(ignore_permissions=True)

    # Doctype nào Sales Staff đang có quyền (gộp cả DocPerm chuẩn & Custom DocPerm).
    doctypes = set()
    for tbl in ("DocPerm", "Custom DocPerm"):
        for r in frappe.get_all(tbl, filters={"role": SRC_ROLE}, fields=["parent"]):
            if r.get("parent"):
                doctypes.add(r["parent"])

    for doctype in sorted(doctypes):
        if not frappe.db.exists("DocType", doctype):
            continue
        # Nguồn hiệu lực: doctype đã customize (có Custom DocPerm) → đọc Custom DocPerm,
        # ngược lại đọc DocPerm chuẩn.
        src_tbl = "Custom DocPerm" if frappe.db.exists("Custom DocPerm", {"parent": doctype}) else "DocPerm"
        rows = frappe.get_all(src_tbl, filters={"role": SRC_ROLE, "parent": doctype}, fields=["*"])
        for r in rows:
            permlevel = r.get("permlevel") or 0
            try:
                add_permission(doctype, DST_ROLE, permlevel)   # tạo rule NPP (giữ nguyên role khác)
                for pt in PTYPES:
                    try:
                        update_permission_property(doctype, DST_ROLE, permlevel, pt,
                                                   1 if r.get(pt) else 0, validate=False)
                    except Exception:
                        pass   # ptype không tồn tại ở version Frappe này → bỏ qua
            except Exception:
                frappe.log_error(
                    "grant_npp_sales_staff_perms",
                    f"Lỗi cấp quyền {doctype} permlevel {permlevel} cho role {DST_ROLE}:\n"
                    + frappe.get_traceback())

    frappe.clear_cache()
