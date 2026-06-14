# -*- coding: utf-8 -*-
"""Manager (sales-channel) analytics — toàn bộ NPP.

Chỉ dành cho role quản lý (_utils.MANAGER_ROLES); mọi method gọi _guard().
Doanh số loại HĐ opening; công nợ giữ opening (nợ thật). Tính grouped (không N+1).
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import (
    add_days,
    add_months,
    date_diff,
    flt,
    get_first_day,
    get_last_day,
    getdate,
)

from ._utils import is_manager

# Cấu hình — đổi tại đây nếu hệ thống khác.
NPP_GROUP = "NPP"
RANK_A = 200_000_000   # doanh số BQ tháng ≥ 200tr → hạng A
RANK_B = 100_000_000   # ≥ 100tr → B, còn lại → C
DORMANT_DAYS = 14      # không mua > 14 ngày → "Ngủ đông"


def _guard() -> None:
    if frappe.session.user == "Guest":
        frappe.throw(_("Login required"), frappe.PermissionError)
    if not is_manager():
        frappe.throw(_("Chỉ quản lý kênh mới xem được dữ liệu này."), frappe.PermissionError)


def _sum_by_customer(query: str, params: tuple) -> dict:
    return {r["k"]: flt(r["v"]) for r in frappe.db.sql(query, params, as_dict=True)}


@frappe.whitelist()
def overview(months: int = 3) -> dict:
    """Dashboard điều hành toàn kênh + bảng phân tích từng NPP."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = get_last_day(today)
    month = today.month
    is_tet = month >= 11 or month <= 2

    customers = frappe.get_all(
        "Customer",
        filters={"customer_group": NPP_GROUP, "disabled": 0},
        fields=["name", "customer_name", "territory"],
        order_by="customer_name asc",
    )
    if not customers:
        return {"months": months, "policy": "tet" if is_tet else "normal",
                "customers": [], "totals": {}, "growth": {}, "monthly": [],
                "by_group": [], "by_territory": []}

    names = tuple(c["name"] for c in customers)

    # ── Per-customer maps (chỉ trong nhóm NPP) ──────────────────────────
    rev_rows = frappe.db.sql(
        """
        SELECT customer AS k, COALESCE(SUM(grand_total),0) AS revenue, COUNT(*) AS orders
        FROM `tabSales Invoice`
        WHERE docstatus=1 AND customer IN %s
          AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes'
        GROUP BY customer
        """,
        (names, start, end), as_dict=True,
    )
    rev_map = {r["k"]: flt(r["revenue"]) for r in rev_rows}
    ord_map = {r["k"]: int(r["orders"]) for r in rev_rows}

    qty_map = _sum_by_customer(
        """
        SELECT si.customer AS k, COALESCE(SUM(sii.qty),0) AS v
        FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
        WHERE si.docstatus=1 AND si.customer IN %s
          AND si.posting_date BETWEEN %s AND %s
          AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
        GROUP BY si.customer
        """,
        (names, start, end),
    )
    debt_map = _sum_by_customer(
        """
        SELECT customer AS k, COALESCE(SUM(outstanding_amount),0) AS v
        FROM `tabSales Invoice` WHERE docstatus=1 AND customer IN %s AND outstanding_amount>0
        GROUP BY customer
        """,
        (names,),
    )
    fl_rows = frappe.db.sql(
        "SELECT customer AS k, MAX(posting_date) AS last, MIN(posting_date) AS first "
        "FROM `tabSales Invoice` WHERE docstatus=1 AND customer IN %s GROUP BY customer",
        (names,), as_dict=True,
    )
    last_map = {r["k"]: r["last"] for r in fl_rows}
    first_map = {r["k"]: r["first"] for r in fl_rows}

    # ── Cần thanh toán theo chính sách (grouped) ────────────────────────
    if is_tet:
        tet_year = today.year if month >= 11 else today.year - 1
        tet_map = _sum_by_customer(
            """
            SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v
            FROM `tabSales Invoice`
            WHERE docstatus=1 AND customer IN %s AND posting_date >= %s
              AND IFNULL(is_opening,'No')!='Yes'
            GROUP BY customer
            """,
            (names, f"{tet_year}-11-01"),
        )

        def req_of(n: str) -> float:
            return max(0.0, debt_map.get(n, 0.0) - tet_map.get(n, 0.0) * 0.5)
    else:
        overdue_map = _sum_by_customer(
            """
            SELECT customer AS k, COALESCE(SUM(outstanding_amount),0) AS v
            FROM `tabSales Invoice`
            WHERE docstatus=1 AND customer IN %s AND outstanding_amount>0 AND posting_date <= %s
            GROUP BY customer
            """,
            (names, add_days(today, -30)),
        )

        def req_of(n: str) -> float:
            return overdue_map.get(n, 0.0)

    # ── Lắp bảng NPP + tổng hợp ─────────────────────────────────────────
    rows = []
    t_rev = t_qty = t_debt = t_req = 0.0
    n_active = n_dormant = n_new = n_buying = 0
    terr: dict = {}
    for c in customers:
        name = c["name"]
        rev = rev_map.get(name, 0.0)
        qty = qty_map.get(name, 0.0)
        debt = debt_map.get(name, 0.0)
        req = req_of(name)
        orders = ord_map.get(name, 0)
        last = last_map.get(name)
        first = first_map.get(name)

        if last is None:
            status = "Chưa mua"
        elif date_diff(today, last) <= DORMANT_DAYS:
            status = "Hoạt động"
            n_active += 1
        else:
            status = "Ngủ đông"
            n_dormant += 1
        is_new = bool(first and getdate(first) >= start)
        if is_new:
            n_new += 1
        if rev > 0:
            n_buying += 1

        avg_month = rev / months
        rank = "A" if avg_month >= RANK_A else ("B" if avg_month >= RANK_B else "C")

        t_rev += rev
        t_qty += qty
        t_debt += debt
        t_req += req
        tv = terr.setdefault(c.get("territory") or "—", {"territory": c.get("territory") or "—", "revenue": 0.0, "debt": 0.0, "count": 0})
        tv["revenue"] += rev
        tv["debt"] += debt
        tv["count"] += 1

        rows.append({
            "customer": name,
            "customer_name": c["customer_name"],
            "territory": c.get("territory") or "",
            "revenue": rev,
            "qty": qty,
            "debt": debt,
            "required_payment": req,
            "orders": orders,
            "aov": (rev / orders) if orders else 0.0,
            "last_order": str(last) if last else None,
            "status": status,
            "rank": rank,
            "is_new": is_new,
        })

    # ── Tăng trưởng kỳ trước (MoM tương đối) + cùng kỳ năm trước (YoY) ──
    def npp_rev(s, e) -> float:
        return flt(frappe.db.sql(
            """SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice`
               WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
                 AND IFNULL(is_opening,'No')!='Yes'""",
            (names, s, e))[0][0] or 0)

    prev_rev = npp_rev(get_first_day(add_months(today, -(2 * months - 1))), get_last_day(add_months(today, -months)))
    ly_rev = npp_rev(get_first_day(add_months(today, -(months - 1) - 12)), get_last_day(add_months(today, -12)))

    # ── Run-rate tháng hiện tại ─────────────────────────────────────────
    mtd = npp_rev(get_first_day(today), today)
    dim = get_last_day(today).day
    run_rate = (mtd / today.day * dim) if today.day else mtd

    # ── Xu hướng theo tháng (DS + sản lượng) ────────────────────────────
    m_rev = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
        """SELECT DATE_FORMAT(posting_date,'%%m/%%Y') AS m, COALESCE(SUM(grand_total),0) AS v
           FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date >= %s AND IFNULL(is_opening,'No')!='Yes'
           GROUP BY m""", (names, start), as_dict=True)}
    m_qty = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
        """SELECT DATE_FORMAT(si.posting_date,'%%m/%%Y') AS m, COALESCE(SUM(sii.qty),0) AS v
           FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date >= %s
             AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
           GROUP BY m""", (names, start), as_dict=True)}
    monthly = []
    for offset in range(months - 1, -1, -1):
        key = getdate(add_months(today, -offset)).strftime("%m/%Y")
        monthly.append({"month": key, "revenue": m_rev.get(key, 0.0), "qty": m_qty.get(key, 0.0)})

    # ── Cơ cấu nhóm hàng ────────────────────────────────────────────────
    by_group = [
        {"item_group": r["item_group"], "revenue": flt(r["revenue"]), "qty": flt(r["qty"])}
        for r in frappe.db.sql(
            """SELECT i.item_group, COALESCE(SUM(sii.amount),0) AS revenue, COALESCE(SUM(sii.qty),0) AS qty
               FROM `tabSales Invoice Item` sii
               JOIN `tabSales Invoice` si ON sii.parent=si.name
               JOIN `tabItem` i ON sii.item_code=i.item_code
               WHERE si.docstatus=1 AND si.customer IN %s
                 AND si.posting_date BETWEEN %s AND %s
                 AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
               GROUP BY i.item_group ORDER BY revenue DESC""",
            (names, start, end), as_dict=True)
    ]

    by_territory = sorted(terr.values(), key=lambda x: x["revenue"], reverse=True)
    dso = (t_debt / t_rev * months * 30) if t_rev else 0.0

    return {
        "months": months,
        "policy": "tet" if is_tet else "normal",
        "customers": rows,
        "monthly": monthly,
        "by_group": by_group,
        "by_territory": by_territory,
        "totals": {
            "revenue": t_rev,
            "qty": t_qty,
            "debt": t_debt,
            "required_payment": t_req,
            "npp_count": len(rows),
            "active": n_active,
            "dormant": n_dormant,
            "new": n_new,
            "buying": n_buying,
            "orders": sum(ord_map.values()),
            "aov": (t_rev / sum(ord_map.values())) if sum(ord_map.values()) else 0.0,
            "run_rate": run_rate,
            "dso": dso,
        },
        "growth": {
            "prev_revenue": prev_rev,
            "growth_pct": ((t_rev - prev_rev) / prev_rev * 100) if prev_rev else None,
            "ly_revenue": ly_rev,
            "yoy_pct": ((t_rev - ly_rev) / ly_rev * 100) if ly_rev else None,
        },
    }
