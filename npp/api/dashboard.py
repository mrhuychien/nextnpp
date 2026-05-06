# -*- coding: utf-8 -*-
"""Dashboard summary endpoint."""

from __future__ import annotations

import frappe
from frappe.utils import get_first_day, get_last_day, getdate

from ._utils import require_customer


@frappe.whitelist()
def summary() -> dict:
    """Return aggregate metrics shown on the NPP dashboard."""
    customer = require_customer()
    today = getdate()
    month_start = get_first_day(today)
    month_end = get_last_day(today)

    # Outstanding (unpaid invoices)
    outstanding_total = frappe.db.sql(
        """
        SELECT COALESCE(SUM(outstanding_amount), 0)
        FROM `tabSales Invoice`
        WHERE customer=%s AND docstatus=1 AND outstanding_amount > 0
        """,
        (customer,),
    )[0][0] or 0

    overdue_count = frappe.db.count(
        "Sales Invoice",
        {"customer": customer, "docstatus": 1, "status": "Overdue"},
    )

    # Order counts
    draft_count = frappe.db.count("Sales Invoice", {"customer": customer, "docstatus": 0})

    # Đơn đang giao — query theo trạng thái vận chuyển (custom field, có dấu)
    # Bắt buộc dùng backtick cho column name unicode
    shipping_count = frappe.db.sql(
        """
        SELECT COUNT(*)
        FROM `tabSales Invoice`
        WHERE customer = %s
          AND docstatus = 1
          AND `custom_trạng_thái_vận_chuyển` IN ('Chờ xử lý', 'Đang giao')
        """,
        (customer,),
    )[0][0] or 0

    # Month aggregates
    month_rows = frappe.db.sql(
        """
        SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total), 0) AS revenue
        FROM `tabSales Invoice`
        WHERE customer=%s AND docstatus=1 AND posting_date BETWEEN %s AND %s
        """,
        (customer, month_start, month_end),
        as_dict=True,
    )
    month_count = month_rows[0]["cnt"] if month_rows else 0
    month_revenue = month_rows[0]["revenue"] if month_rows else 0

    month_qty = frappe.db.sql(
        """
        SELECT COALESCE(SUM(sii.qty), 0)
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON sii.parent = si.name
        WHERE si.customer=%s AND si.docstatus=1
          AND si.posting_date BETWEEN %s AND %s
          AND sii.uom IN ('Thùng', 'Box')
        """,
        (customer, month_start, month_end),
    )[0][0] or 0

    promo_count = _count_active_promotions(customer)

    return {
        "outstanding_total": float(outstanding_total),
        "overdue_count": overdue_count,
        "draft_count": draft_count,
        "shipping_count": shipping_count,
        "month_count": month_count,
        "month_revenue": float(month_revenue),
        "month_qty": float(month_qty),
        "promo_count": promo_count,
    }


def _count_active_promotions(customer: str) -> int:
    """Count Pricing Rules currently valid for this customer."""
    return frappe.db.sql(
        """
        SELECT COUNT(DISTINCT pr.name)
        FROM `tabPricing Rule` pr
        LEFT JOIN `tabPricing Rule Detail` prd ON prd.parent = pr.name AND prd.parenttype = 'Pricing Rule'
        WHERE pr.disable = 0
          AND (pr.valid_from IS NULL OR pr.valid_from <= CURDATE())
          AND (pr.valid_upto IS NULL OR pr.valid_upto >= CURDATE())
          AND (
              pr.applicable_for = ''
              OR pr.applicable_for IS NULL
              OR (pr.applicable_for = 'Customer' AND prd.customer = %s)
          )
        """,
        (customer,),
    )[0][0] or 0
