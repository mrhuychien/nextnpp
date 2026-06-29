# -*- coding: utf-8 -*-
"""Khuyến mại (chương trình trưng bày) — góc nhìn của TỪNG NPP.

Dữ liệu thuộc app `salep` (cùng site): Promotion Program, Display Point,
Display Participation, Sales Staff Profile. Mọi truy vấn scope theo
`require_customer()` (= distributor của NPP) → NPP chỉ thấy địa bàn của mình.

Lưu ý: dùng frappe.get_all (bỏ qua DocPerm) NHƯNG luôn lọc distributor=customer,
nên an toàn và không phụ thuộc việc NPP có role trên doctype của salep hay không.
"""

from __future__ import annotations

import re

import frappe
from frappe import _
from frappe.utils import cint

from ._utils import require_customer

APPROVED = "Đã duyệt"
SALES_STAFF_ROLE = "Sales Staff"


def _require_salep() -> None:
    if not (frappe.db.table_exists("Promotion Program")
            and frappe.db.table_exists("Display Participation")
            and frappe.db.table_exists("Display Point")):
        frappe.throw(_("Site chưa cài module Khuyến mại (salep)."))


@frappe.whitelist()
def npp_overview(customer: str | None = None) -> dict:
    """Tổng quan khuyến mại của NPP: chương trình + tiến độ, điểm bán, nhân viên + tiến độ."""
    customer = require_customer(customer)
    _require_salep()

    # Điểm bán của NPP
    points = frappe.get_all(
        "Display Point", filters={"distributor": customer},
        fields=["name", "point_name", "address_line", "phone", "is_active",
                "latitude", "longitude"], order_by="point_name asc")
    active_points = sum(1 for p in points if p.get("is_active"))

    # Tham gia của NPP (mọi chương trình)
    parts = frappe.get_all(
        "Display Participation", filters={"distributor": customer},
        fields=["name", "display_point", "promotion_program", "workflow_state", "owner"])

    # Gộp theo chương trình
    by_prog: dict = {}
    for p in parts:
        b = by_prog.setdefault(p["promotion_program"], {"total": 0, "approved": 0, "pts": set(), "appr_pts": set()})
        b["total"] += 1
        if p.get("display_point"):
            b["pts"].add(p["display_point"])
        if p.get("workflow_state") == APPROVED:
            b["approved"] += 1
            if p.get("display_point"):
                b["appr_pts"].add(p["display_point"])

    programs = frappe.get_all(
        "Promotion Program",
        fields=["name", "program_name", "status", "start_date", "end_date",
                "target_points", "reward_per_point"], order_by="start_date desc")
    prog_rows = []
    for pg in programs:
        b = by_prog.get(pg["name"], {"total": 0, "approved": 0, "pts": set(), "appr_pts": set()})
        prog_rows.append({
            "program": pg["name"], "program_name": pg.get("program_name") or pg["name"],
            "status": pg.get("status"), "start_date": str(pg["start_date"]) if pg.get("start_date") else None,
            "end_date": str(pg["end_date"]) if pg.get("end_date") else None,
            "target_points": pg.get("target_points") or 0, "reward_per_point": pg.get("reward_per_point") or 0,
            "participations": b["total"], "approved": b["approved"],
            "points": len(b["pts"]), "approved_points": len(b["appr_pts"]),
            "coverage_pct": (len(b["appr_pts"]) / active_points * 100) if active_points else 0,
        })
    # Chương trình đang chạy lên trước
    prog_rows.sort(key=lambda x: (x["status"] != "Đang chạy", -(x["approved"])))

    # Nhân viên của NPP + tiến độ (gộp tham gia theo người tạo = owner)
    by_staff: dict = {}
    for p in parts:
        b = by_staff.setdefault(p["owner"], {"total": 0, "approved": 0})
        b["total"] += 1
        if p.get("workflow_state") == APPROVED:
            b["approved"] += 1
    staff = frappe.get_all(
        "Sales Staff Profile", filters={"distributor": customer},
        fields=["name", "user", "full_name", "phone", "cccd"], order_by="full_name asc")
    user_ids = [s["user"] for s in staff if s.get("user")]
    enabled = {u["name"]: u["enabled"] for u in frappe.get_all(
        "User", filters={"name": ["in", user_ids]}, fields=["name", "enabled"])} if user_ids else {}
    staff_rows, seen = [], set()
    for s in staff:
        b = by_staff.get(s["user"], {"total": 0, "approved": 0})
        staff_rows.append({"name": s["name"], "user": s["user"], "full_name": s.get("full_name") or s["user"],
                           "phone": s.get("phone"), "cccd": s.get("cccd"), "total": b["total"], "approved": b["approved"],
                           "active": bool(enabled.get(s["user"], 1)) if s.get("user") else True})
        seen.add(s["user"])
    for u, b in by_staff.items():  # người tạo tham gia nhưng chưa có hồ sơ NV
        if u and u not in seen:
            staff_rows.append({"name": None, "user": u, "full_name": u, "phone": None,
                               "total": b["total"], "approved": b["approved"], "active": True})
    staff_rows.sort(key=lambda x: x["approved"], reverse=True)

    participated = {p["display_point"] for p in parts if p.get("display_point")}
    approved_total = sum(1 for p in parts if p.get("workflow_state") == APPROVED)
    return {
        "customer": customer,
        "totals": {"programs": len(prog_rows),
                   "running": sum(1 for x in prog_rows if x["status"] == "Đang chạy"),
                   "points": len(points), "active_points": active_points,
                   "participated_points": len(participated),
                   "participations": len(parts), "approved": approved_total,
                   "staff": len(staff_rows)},
        "programs": prog_rows,
        "points": [{**p, "is_active": bool(p.get("is_active")),
                    "participated": p["name"] in participated} for p in points],
        "staff": staff_rows,
    }


@frappe.whitelist()
def npp_participations(program: str | None = None, customer: str | None = None) -> list[dict]:
    """Danh sách điểm bán THAM GIA chương trình của NPP (lọc theo chương trình nếu có)."""
    customer = require_customer(customer)
    _require_salep()
    filters = {"distributor": customer}
    if program:
        filters["promotion_program"] = program
    rows = frappe.get_all(
        "Display Participation", filters=filters,
        fields=["name", "display_point", "promotion_program", "workflow_state",
                "owner", "modified", "latitude", "longitude", "reject_reason"],
        order_by="modified desc", limit_page_length=500)
    if not rows:
        return []
    pt_names = {r["name"]: r["point_name"] for r in frappe.get_all(
        "Display Point", filters={"distributor": customer}, fields=["name", "point_name"])}
    pg_names = {r["name"]: r["program_name"] for r in frappe.get_all(
        "Promotion Program", fields=["name", "program_name"])}
    for r in rows:
        r["point_name"] = pt_names.get(r["display_point"]) or r["display_point"]
        r["program_name"] = pg_names.get(r["promotion_program"]) or r["promotion_program"]
        r["modified"] = str(r["modified"]) if r.get("modified") else None
    return rows


def _gen_password(n: int = 8) -> str:
    """Mật khẩu ngẫu nhiên có cả chữ thường/hoa/số (đủ mạnh cho policy mặc định)."""
    import random
    import string
    pool = string.ascii_lowercase + string.ascii_uppercase + string.digits
    while True:
        pw = "".join(random.choice(pool) for _ in range(n))
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw):
            return pw


@frappe.whitelist()
def create_staff(full_name: str, phone: str | None = None, email: str | None = None,
                 cccd: str | None = None, password: str | None = None,
                 customer: str | None = None) -> dict:
    """NPP tạo nhân viên trên ĐỊA BÀN của mình. Đăng nhập = SỐ ĐIỆN THOẠI (User.username)
    + mật khẩu (nhập tay hoặc tự sinh). Tạo User (chỉ role Sales Staff, kích hoạt, đặt
    mật khẩu ngay) + Sales Staff Profile (distributor = NPP). Không gán role khác.
    Trả về username + password để NPP gửi cho nhân viên."""
    customer = require_customer(customer)
    _require_salep()
    full_name = (full_name or "").strip()
    if not full_name:
        frappe.throw(_("Vui lòng nhập họ tên nhân viên."))
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        frappe.throw(_("Vui lòng nhập số điện thoại (dùng làm tên đăng nhập)."))
    email = (email or "").strip().lower() or f"{digits}@nv.local"
    password = (password or "").strip() or _gen_password()

    if frappe.db.exists("User", email):
        frappe.throw(_("Tài khoản (email) đã tồn tại: {0}").format(email))
    if frappe.db.exists("User", {"username": digits}):
        frappe.throw(_("Số điện thoại đã dùng cho tài khoản khác: {0}").format(digits))

    u = frappe.new_doc("User")
    u.email = email
    u.first_name = full_name
    u.username = digits          # ĐĂNG NHẬP bằng số điện thoại
    u.mobile_no = (phone or digits).strip()
    u.enabled = 1
    u.user_type = "Website User"  # CHẶN truy cập Desk (/app) — NV chỉ dùng portal
    u.send_welcome_email = 0
    u.new_password = password    # đặt mật khẩu ngay khi tạo
    u.flags.ignore_permissions = True
    u.insert(ignore_permissions=True)
    if frappe.db.exists("Role", SALES_STAFF_ROLE):
        u.add_roles(SALES_STAFF_ROLE)  # CHỈ role Sales Staff

    p = frappe.new_doc("Sales Staff Profile")
    p.user = email
    p.full_name = full_name
    p.phone = (phone or digits).strip()
    if (cccd or "").strip():
        p.cccd = cccd.strip()
    p.distributor = customer
    p.insert(ignore_permissions=True)
    return {"name": p.name, "user": email, "username": digits, "password": password}


@frappe.whitelist()
def set_staff_active(staff: str, active, customer: str | None = None) -> dict:
    """Bật/tắt hoạt động (duyệt) nhân viên — đổi User.enabled. Chỉ NV thuộc địa bàn NPP."""
    customer = require_customer(customer)
    _require_salep()
    prof = frappe.db.get_value("Sales Staff Profile", staff, ["name", "user", "distributor"], as_dict=True)
    if not prof or prof.get("distributor") != customer:
        frappe.throw(_("Không có quyền với nhân viên này."), frappe.PermissionError)
    active = 1 if cint(active) else 0
    if prof.get("user"):
        frappe.db.set_value("User", prof["user"], "enabled", active)
    return {"name": staff, "active": bool(active)}


def _own_staff(staff, customer):
    """Trả hồ sơ NV nếu thuộc địa bàn NPP, else throw."""
    prof = frappe.db.get_value("Sales Staff Profile", staff, ["name", "user", "distributor"], as_dict=True)
    if not prof or prof.get("distributor") != customer:
        frappe.throw(_("Không có quyền với nhân viên này."), frappe.PermissionError)
    return prof


@frappe.whitelist()
def update_staff(staff: str, full_name: str | None = None, phone: str | None = None,
                 cccd: str | None = None, customer: str | None = None) -> dict:
    """Sửa thông tin NV (tên/SĐT/CCCD). Đổi SĐT → đổi luôn tên đăng nhập (username)."""
    customer = require_customer(customer)
    _require_salep()
    prof = _own_staff(staff, customer)

    p = frappe.get_doc("Sales Staff Profile", staff)
    if full_name and full_name.strip():
        p.full_name = full_name.strip()
    new_digits = None
    if phone is not None:
        new_digits = re.sub(r"\D", "", phone)
        if not new_digits:
            frappe.throw(_("Số điện thoại không hợp lệ."))
        p.phone = phone.strip()
    if cccd is not None:
        p.cccd = (cccd or "").strip() or None
    p.flags.ignore_permissions = True
    p.save(ignore_permissions=True)

    if prof.get("user"):
        u = frappe.get_doc("User", prof["user"])
        if full_name and full_name.strip():
            u.first_name = full_name.strip()
        if new_digits:
            u.mobile_no = phone.strip()
            if new_digits != (u.username or ""):
                if frappe.db.exists("User", {"username": new_digits, "name": ["!=", u.name]}):
                    frappe.throw(_("Số điện thoại đã dùng cho tài khoản khác: {0}").format(new_digits))
                u.username = new_digits
        u.flags.ignore_permissions = True
        u.save(ignore_permissions=True)
    return {"name": staff, "username": new_digits or None}


@frappe.whitelist()
def reset_staff_password(staff: str, password: str | None = None, customer: str | None = None) -> dict:
    """Cấp lại mật khẩu cho NV (nhập tay hoặc tự sinh). Trả username + password để gửi NV."""
    customer = require_customer(customer)
    _require_salep()
    prof = _own_staff(staff, customer)
    if not prof.get("user"):
        frappe.throw(_("Nhân viên chưa có tài khoản đăng nhập."))
    password = (password or "").strip() or _gen_password()
    u = frappe.get_doc("User", prof["user"])
    u.new_password = password
    u.flags.ignore_permissions = True
    u.save(ignore_permissions=True)
    return {"name": staff, "username": u.username or u.name, "password": password}
