# -*- coding: utf-8 -*-
"""Manager (sales-channel) endpoints — xem toàn bộ NPP.

Chỉ dành cho role quản lý (xem _utils.MANAGER_ROLES). Mọi method gọi _guard().
Drill-down chi tiết 1 NPP do client gọi lại các endpoint self-view với tham số
customer=<NPP> (require_customer cho phép khi user là quản lý).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, add_months, flt, get_first_day, getdate

from ._utils import is_manager

# Nhóm khách hàng NPP trong ERPNext — đổi tại đây nếu hệ thống đặt tên khác.
NPP_GROUP = "NPP"


def _guard() -> None:
    if frappe.session.user == "Guest":
        frappe.throw(_("Login required"), frappe.PermissionError)
    if not is_manager():
        frappe.throw(_("Chỉ quản lý kênh mới xem được dữ liệu này."), frappe.PermissionError)


def _sum_map(query: str, params: tuple) -> dict:
    return {r["k"]: flt(r["v"]) for r in frappe.db.sql(query, params, as_dict=True)}


@frappe.whitelist()
def overview(months: int = 3) -> dict:
    """Tổng quan mọi NPP: doanh số kỳ (loại HĐ opening), công nợ, cần thanh toán, đơn cuối."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    month = today.month
    is_tet = month >= 11 or month <= 2

    customers = frappe.get_all(
        "Customer",
        filters={"customer_group": NPP_GROUP, "disabled": 0},
        fields=["name", "customer_name"],
        order_by="customer_name asc",
    )

    # Doanh số kỳ — loại opening (không phải bán hàng thật).
    rev_map = _sum_map(
        """
        SELECT customer AS k, COALESCE(SUM(grand_total), 0) AS v
        FROM `tabSales Invoice`
        WHERE docstatus=1 AND posting_date >= %s AND IFNULL(is_opening, 'No') != 'Yes'
        GROUP BY customer
        """,
        (start,),
    )
    # Công nợ — GIỮ opening (nợ thật).
    debt_map = _sum_map(
        """
        SELECT customer AS k, COALESCE(SUM(outstanding_amount), 0) AS v
        FROM `tabSales Invoice`
        WHERE docstatus=1 AND outstanding_amount > 0
        GROUP BY customer
        """,
        (),
    )
    last_map = {
        r["k"]: str(r["v"]) if r["v"] else None
        for r in frappe.db.sql(
            "SELECT customer AS k, MAX(posting_date) AS v FROM `tabSales Invoice` WHERE docstatus=1 GROUP BY customer",
            as_dict=True,
        )
    }

    if is_tet:
        tet_year = today.year if month >= 11 else today.year - 1
        tet_map = _sum_map(
            """
            SELECT customer AS k, COALESCE(SUM(grand_total), 0) AS v
            FROM `tabSales Invoice`
            WHERE docstatus=1 AND posting_date >= %s AND IFNULL(is_opening, 'No') != 'Yes'
            GROUP BY customer
            """,
            (f"{tet_year}-11-01",),
        )

        def req_of(name: str) -> float:
            return max(0.0, debt_map.get(name, 0.0) - tet_map.get(name, 0.0) * 0.5)
    else:
        overdue_map = _sum_map(
            """
            SELECT customer AS k, COALESCE(SUM(outstanding_amount), 0) AS v
            FROM `tabSales Invoice`
            WHERE docstatus=1 AND outstanding_amount > 0 AND posting_date <= %s
            GROUP BY customer
            """,
            (add_days(today, -30),),
        )

        def req_of(name: str) -> float:
            return overdue_map.get(name, 0.0)

    rows = []
    t_rev = t_debt = t_req = 0.0
    for c in customers:
        revenue = rev_map.get(c["name"], 0.0)
        debt = debt_map.get(c["name"], 0.0)
        req = req_of(c["name"])
        t_rev += revenue
        t_debt += debt
        t_req += req
        rows.append(
            {
                "customer": c["name"],
                "customer_name": c["customer_name"],
                "revenue": revenue,
                "debt": debt,
                "required_payment": req,
                "last_order": last_map.get(c["name"]),
            }
        )

    return {
        "months": months,
        "policy": "tet" if is_tet else "normal",
        "customers": rows,
        "totals": {
            "revenue": t_rev,
            "debt": t_debt,
            "required_payment": t_req,
            "count": len(rows),
        },
    }
