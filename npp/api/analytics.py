# -*- coding: utf-8 -*-
"""Sales analytics for the NPP."""

from __future__ import annotations

import frappe
from frappe.utils import add_months, get_first_day, get_last_day, getdate

from ._utils import require_customer


@frappe.whitelist()
def sales_by_month(months: int = 12) -> list[dict]:
    customer = require_customer()
    months = max(1, min(int(months or 12), 36))
    rows = []
    today = getdate()
    for offset in range(months - 1, -1, -1):
        anchor = add_months(today, -offset)
        start = get_first_day(anchor)
        end = get_last_day(anchor)
        agg = frappe.db.sql(
            """
            SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total), 0) AS revenue
            FROM `tabSales Invoice`
            WHERE customer=%s AND docstatus=1 AND posting_date BETWEEN %s AND %s
            """,
            (customer, start, end),
            as_dict=True,
        )[0]
        rows.append(
            {
                "month": start.strftime("%m/%Y"),
                "count": agg["cnt"],
                "revenue": float(agg["revenue"] or 0),
            }
        )
    return rows


@frappe.whitelist()
def top_items(months: int = 1, limit: int = 10, item_group: str | None = None) -> list[dict]:
    """Top items by qty over last N months. Optional filter by item_group."""
    customer = require_customer()
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
def sales_by_item_group(months: int = 12) -> list[dict]:
    """Doanh số chia theo item_group (Hàng truyền thống / Hàng Tết / ...)."""
    customer = require_customer()
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
          AND sii.uom IN ('Thùng', 'Box')
        GROUP BY i.item_group
        ORDER BY amount DESC
        """,
        (customer, start),
        as_dict=True,
    )
    return [dict(r, qty=float(r["qty"]), amount=float(r["amount"])) for r in rows]
