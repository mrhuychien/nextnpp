# -*- coding: utf-8 -*-
"""Khuyến mại (chương trình trưng bày) — góc nhìn của TỪNG NPP.

Dữ liệu thuộc app `salep` (cùng site): Promotion Program, Display Point,
Display Participation, Sales Staff Profile. Mọi truy vấn scope theo
`require_customer()` (= distributor của NPP) → NPP chỉ thấy địa bàn của mình.

Lưu ý: dùng frappe.get_all (bỏ qua DocPerm) NHƯNG luôn lọc distributor=customer,
nên an toàn và không phụ thuộc việc NPP có role trên doctype của salep hay không.
"""

from __future__ import annotations

import frappe
from frappe import _

from ._utils import require_customer

APPROVED = "Đã duyệt"


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
        fields=["user", "full_name", "phone"], order_by="full_name asc")
    staff_rows, seen = [], set()
    for s in staff:
        b = by_staff.get(s["user"], {"total": 0, "approved": 0})
        staff_rows.append({"user": s["user"], "full_name": s.get("full_name") or s["user"],
                           "phone": s.get("phone"), "total": b["total"], "approved": b["approved"]})
        seen.add(s["user"])
    for u, b in by_staff.items():  # người tạo tham gia nhưng chưa có hồ sơ NV
        if u and u not in seen:
            staff_rows.append({"user": u, "full_name": u, "phone": None,
                               "total": b["total"], "approved": b["approved"]})
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
