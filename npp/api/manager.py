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


def _npp_names() -> tuple:
    return tuple(
        c["name"] for c in frappe.get_all(
            "Customer", filters={"customer_group": NPP_GROUP, "disabled": 0}, fields=["name"]
        )
    )


@frappe.whitelist()
def products(months: int = 3) -> dict:
    """Phân tích sản phẩm toàn kênh: top, tăng/giảm (movers), độ phủ nhóm hàng."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = get_last_day(today)
    prev_start = get_first_day(add_months(today, -(2 * months - 1)))
    prev_end = get_last_day(add_months(today, -months))
    names = _npp_names()
    if not names:
        return {"months": months, "top": [], "groups": []}

    cur = frappe.db.sql(
        """
        SELECT sii.item_code, sii.item_name, i.item_group,
               COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.qty),0) AS qty
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON sii.parent=si.name
        JOIN `tabItem` i ON sii.item_code=i.item_code
        WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
          AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
        GROUP BY sii.item_code, sii.item_name, i.item_group
        ORDER BY rev DESC
        """,
        (names, start, end), as_dict=True,
    )
    prev = {r["item_code"]: flt(r["rev"]) for r in frappe.db.sql(
        """
        SELECT sii.item_code, COALESCE(SUM(sii.amount),0) AS rev
        FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
        WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
          AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
        GROUP BY sii.item_code
        """,
        (names, prev_start, prev_end), as_dict=True,
    )}

    top = []
    for r in cur:
        rev = flt(r["rev"])
        p = prev.get(r["item_code"], 0.0)
        top.append({
            "item_code": r["item_code"], "item_name": r["item_name"], "item_group": r["item_group"],
            "revenue": rev, "qty": flt(r["qty"]), "prev_revenue": p,
            "growth_pct": ((rev - p) / p * 100) if p else None,
        })

    total_npp = len(names)
    groups = [
        {
            "item_group": r["item_group"], "revenue": flt(r["rev"]), "qty": flt(r["qty"]),
            "buyers": int(r["buyers"]), "total_npp": total_npp,
            "coverage_pct": (int(r["buyers"]) / total_npp * 100) if total_npp else 0,
        }
        for r in frappe.db.sql(
            """
            SELECT i.item_group, COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.qty),0) AS qty,
                   COUNT(DISTINCT si.customer) AS buyers
            FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
            JOIN `tabItem` i ON sii.item_code=i.item_code
            WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
              AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
            GROUP BY i.item_group ORDER BY rev DESC
            """,
            (names, start, end), as_dict=True)
    ]
    return {"months": months, "top": top, "groups": groups}


@frappe.whitelist()
def white_space(item_group: str, months: int = 3) -> list[dict]:
    """NPP đang phát sinh doanh số nhưng CHƯA mua nhóm `item_group` trong kỳ → cơ hội cross-sell."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = get_last_day(today)
    names = _npp_names()
    if not names or not item_group:
        return []

    bought = {
        r[0] for r in frappe.db.sql(
            """
            SELECT DISTINCT si.customer
            FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
            JOIN `tabItem` i ON sii.item_code=i.item_code
            WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
              AND i.item_group=%s AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
            """,
            (names, start, end, item_group))
    }
    rev_rows = frappe.db.sql(
        """
        SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v
        FROM `tabSales Invoice`
        WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
          AND IFNULL(is_opening,'No')!='Yes'
        GROUP BY customer
        """,
        (names, start, end), as_dict=True,
    )
    info = {
        c["name"]: c for c in frappe.get_all(
            "Customer", filters={"name": ["in", list(names)]},
            fields=["name", "customer_name", "territory"])
    }
    out = [
        {
            "customer": r["k"],
            "customer_name": (info.get(r["k"]) or {}).get("customer_name") or r["k"],
            "territory": (info.get(r["k"]) or {}).get("territory") or "",
            "revenue": flt(r["v"]),
        }
        for r in rev_rows if r["k"] not in bought and flt(r["v"]) > 0
    ]
    out.sort(key=lambda x: x["revenue"], reverse=True)
    return out


@frappe.whitelist()
def targets(months: int = 1) -> dict:
    """% hoàn thành mục tiêu: doanh số kỳ vs (target tháng × số tháng). Target nhập ở Customer.custom_monthly_target."""
    _guard()
    months = max(1, min(int(months or 1), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = get_last_day(today)
    customers = frappe.get_all(
        "Customer",
        filters={"customer_group": NPP_GROUP, "disabled": 0},
        fields=["name", "customer_name", "territory", "custom_monthly_target"],
        order_by="customer_name asc",
    )
    if not customers:
        return {"months": months, "rows": [], "totals": {}}
    names = tuple(c["name"] for c in customers)
    rev_map = _sum_by_customer(
        """
        SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v
        FROM `tabSales Invoice`
        WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
          AND IFNULL(is_opening,'No')!='Yes'
        GROUP BY customer
        """,
        (names, start, end),
    )
    rows = []
    t_target = t_rev = 0.0
    for c in customers:
        monthly_t = flt(c.get("custom_monthly_target"))
        target = monthly_t * months
        rev = rev_map.get(c["name"], 0.0)
        t_target += target
        t_rev += rev
        rows.append({
            "customer": c["name"], "customer_name": c["customer_name"],
            "territory": c.get("territory") or "", "monthly_target": monthly_t,
            "target": target, "revenue": rev,
            "attainment_pct": (rev / target * 100) if target else None,
        })
    # NPP có target nhưng đạt thấp lên đầu
    rows.sort(key=lambda x: (x["attainment_pct"] is None, x["attainment_pct"] or 0))
    return {
        "months": months, "rows": rows,
        "totals": {"target": t_target, "revenue": t_rev,
                   "attainment_pct": (t_rev / t_target * 100) if t_target else None},
    }


@frappe.whitelist()
def set_target(customer: str, amount) -> dict:
    """Nhập/cập nhật mục tiêu doanh số THÁNG cho 1 NPP (Currency)."""
    _guard()
    if not frappe.db.exists("Customer", customer):
        frappe.throw(_("Customer không tồn tại: {0}").format(customer))
    frappe.db.set_value("Customer", customer, "custom_monthly_target", flt(amount))
    return {"customer": customer, "monthly_target": flt(amount)}


@frappe.whitelist()
def insights() -> dict:
    """Cảnh báo hành động: NPP ngủ đông · tụt doanh số · nợ + ngừng mua."""
    _guard()
    today = getdate()
    names = _npp_names()
    if not names:
        return {"alerts": []}

    last = {r["k"]: r["v"] for r in frappe.db.sql(
        "SELECT customer AS k, MAX(posting_date) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s GROUP BY customer", (names,), as_dict=True)}
    info = {c["name"]: c for c in frappe.get_all(
        "Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
    debt_map = _sum_by_customer(
        "SELECT customer AS k, COALESCE(SUM(outstanding_amount),0) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s AND outstanding_amount>0 GROUP BY customer", (names,))
    this_rev = _sum_by_customer(
        "SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
        (names, get_first_day(today), get_last_day(today)))
    prev_rev = _sum_by_customer(
        "SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
        (names, get_first_day(add_months(today, -1)), get_last_day(add_months(today, -1))))

    alerts = []
    for c in names:
        nm = (info.get(c) or {}).get("customer_name") or c
        terr = (info.get(c) or {}).get("territory") or ""
        last_d = last.get(c)
        debt = debt_map.get(c, 0.0)
        tr = this_rev.get(c, 0.0)
        pr = prev_rev.get(c, 0.0)
        days = date_diff(today, last_d) if last_d else None

        if debt > 0 and days is not None and days > 30:
            alerts.append({"type": "debt_risk", "level": "danger", "customer": c, "customer_name": nm,
                           "territory": terr, "value": debt,
                           "message": f"Còn nợ {debt:,.0f}đ nhưng đã {days} ngày không mua"})
        elif last_d and days is not None and days > DORMANT_DAYS:
            alerts.append({"type": "dormant", "level": "warning", "customer": c, "customer_name": nm,
                           "territory": terr, "value": debt,
                           "message": f"Ngủ đông — {days} ngày chưa đặt hàng"})
        if pr > 0 and tr < pr * 0.5:
            drop = (1 - tr / pr) * 100
            alerts.append({"type": "declining", "level": "warning", "customer": c, "customer_name": nm,
                           "territory": terr, "value": pr - tr,
                           "message": f"Doanh số tháng này giảm {drop:.0f}% so với tháng trước"})

    order = {"danger": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: (order.get(a["level"], 9), -a["value"]))
    return {"alerts": alerts}
