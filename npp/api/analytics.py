# -*- coding: utf-8 -*-
"""Sales analytics for the NPP.

Doanh số/sản lượng KHÔNG tính hoá đơn opening (is_opening='Yes' = số dư đầu kỳ,
không phải bán hàng thật) → mọi query lọc IFNULL(is_opening,'No') != 'Yes'.
"""

from __future__ import annotations

import frappe
from frappe.utils import add_months, get_first_day, get_last_day, getdate

from ._utils import require_customer


@frappe.whitelist()
def sales_by_month(months: int = 12, customer: str | None = None) -> list[dict]:
    """Doanh số + sản lượng (thùng) theo từng tháng, N tháng gần nhất."""
    customer = require_customer(customer)
    months = max(1, min(int(months or 12), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))

    rev = frappe.db.sql(
        """
        SELECT DATE_FORMAT(posting_date, '%%m/%%Y') AS m,
               COUNT(*) AS cnt, COALESCE(SUM(grand_total), 0) AS revenue
        FROM `tabSales Invoice`
        WHERE customer=%s AND docstatus=1 AND posting_date >= %s
          AND IFNULL(is_opening, 'No') != 'Yes'
        GROUP BY DATE_FORMAT(posting_date, '%%m/%%Y')
        """,
        (customer, start),
        as_dict=True,
    )
    qty = frappe.db.sql(
        """
        SELECT DATE_FORMAT(si.posting_date, '%%m/%%Y') AS m,
               COALESCE(SUM(sii.qty), 0) AS qty
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON sii.parent = si.name
        WHERE si.customer=%s AND si.docstatus=1 AND si.posting_date >= %s
          AND IFNULL(si.is_opening, 'No') != 'Yes'
          AND sii.uom IN ('Thùng', 'Box')
        GROUP BY DATE_FORMAT(si.posting_date, '%%m/%%Y')
        """,
        (customer, start),
        as_dict=True,
    )
    rev_map = {r["m"]: r for r in rev}
    qty_map = {r["m"]: float(r["qty"] or 0) for r in qty}

    rows = []
    for offset in range(months - 1, -1, -1):
        key = getdate(add_months(today, -offset)).strftime("%m/%Y")
        r = rev_map.get(key)
        rows.append(
            {
                "month": key,
                "count": int(r["cnt"]) if r else 0,
                "revenue": float(r["revenue"]) if r else 0.0,
                "qty": qty_map.get(key, 0.0),
            }
        )
    return rows


@frappe.whitelist()
def top_items(months: int = 1, limit: int = 10, item_group: str | None = None, customer: str | None = None) -> list[dict]:
    """Top items by qty over last N months. Optional filter by item_group."""
    customer = require_customer(customer)
    months = max(1, min(int(months or 1), 12))
    limit = max(1, min(int(limit or 10), 50))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))

    query = """
        SELECT sii.item_code, sii.item_name, i.item_group,
               COALESCE(SUM(sii.qty), 0) AS qty,
               COALESCE(SUM(sii.amount), 0) AS amount
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON sii.parent = si.name
        JOIN `tabItem` i ON sii.item_code = i.item_code
        WHERE si.customer=%s AND si.docstatus=1
          AND si.posting_date >= %s
          AND IFNULL(si.is_opening, 'No') != 'Yes'
          AND sii.uom IN ('Thùng', 'Box')
    """
    params = [customer, start]

    if item_group:
        query += " AND i.item_group = %s"
        params.append(item_group)

    query += """
        GROUP BY sii.item_code, sii.item_name, i.item_group
        ORDER BY qty DESC
        LIMIT %s
    """
    params.append(limit)

    rows = frappe.db.sql(query, params, as_dict=True)
    return [dict(r, qty=float(r["qty"]), amount=float(r["amount"])) for r in rows]


@frappe.whitelist()
def sales_by_item_group(months: int = 12, customer: str | None = None) -> list[dict]:
    """Doanh số chia theo item_group (Hàng truyền thống / Hàng Tết / ...)."""
    customer = require_customer(customer)
    months = max(1, min(int(months or 12), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))

    rows = frappe.db.sql(
        """
        SELECT i.item_group,
               COALESCE(SUM(sii.qty), 0) AS qty,
               COALESCE(SUM(sii.amount), 0) AS amount
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON sii.parent = si.name
        JOIN `tabItem` i ON sii.item_code = i.item_code
        WHERE si.customer = %s
          AND si.docstatus = 1
          AND si.posting_date >= %s
          AND IFNULL(si.is_opening, 'No') != 'Yes'
          AND sii.uom IN ('Thùng', 'Box')
        GROUP BY i.item_group
        ORDER BY amount DESC
        """,
        (customer, start),
        as_dict=True,
    )
    return [dict(r, qty=float(r["qty"]), amount=float(r["amount"])) for r in rows]


@frappe.whitelist()
def kpi(months: int = 12, customer: str | None = None) -> dict:
    """Số liệu tổng quan kỳ N tháng + tăng trưởng doanh số so với kỳ trước.

    Loại hoá đơn opening. Tất cả lọc theo require_customer() → chỉ data NPP đó.
    """
    customer = require_customer(customer)
    months = max(1, min(int(months or 12), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = get_last_day(today)
    prev_start = get_first_day(add_months(today, -(2 * months - 1)))
    prev_end = get_last_day(add_months(today, -months))

    cur = frappe.db.sql(
        """
        SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total), 0) AS revenue
        FROM `tabSales Invoice`
        WHERE customer=%s AND docstatus=1 AND posting_date BETWEEN %s AND %s
          AND IFNULL(is_opening, 'No') != 'Yes'
        """,
        (customer, start, end),
        as_dict=True,
    )[0]
    prev_rev = frappe.db.sql(
        """
        SELECT COALESCE(SUM(grand_total), 0)
        FROM `tabSales Invoice`
        WHERE customer=%s AND docstatus=1 AND posting_date BETWEEN %s AND %s
          AND IFNULL(is_opening, 'No') != 'Yes'
        """,
        (customer, prev_start, prev_end),
    )[0][0] or 0
    qty = frappe.db.sql(
        """
        SELECT COALESCE(SUM(sii.qty), 0)
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON sii.parent = si.name
        WHERE si.customer=%s AND si.docstatus=1
          AND si.posting_date BETWEEN %s AND %s
          AND IFNULL(si.is_opening, 'No') != 'Yes'
          AND sii.uom IN ('Thùng', 'Box')
        """,
        (customer, start, end),
    )[0][0] or 0

    revenue = float(cur["revenue"] or 0)
    count = int(cur["cnt"] or 0)
    prev_rev = float(prev_rev)
    return {
        "months": months,
        "revenue": revenue,
        "qty": float(qty),
        "order_count": count,
        "avg_order_value": (revenue / count) if count else 0.0,
        "prev_revenue": prev_rev,
        "growth_pct": ((revenue - prev_rev) / prev_rev * 100) if prev_rev else None,
    }
