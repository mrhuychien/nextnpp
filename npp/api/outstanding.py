# -*- coding: utf-8 -*-
"""Outstanding receivables (công nợ) endpoints."""

from __future__ import annotations

import frappe
from frappe.utils import date_diff, getdate

from ._utils import require_customer


@frappe.whitelist()
def summary() -> dict:
    customer = require_customer()
    rows = frappe.db.sql(
        """
        SELECT name, posting_date, due_date, outstanding_amount, status
        FROM `tabSales Invoice`
        WHERE customer=%s AND docstatus=1 AND outstanding_amount > 0
        ORDER BY due_date ASC
        """,
        (customer,),
        as_dict=True,
    )
    today = getdate()
    overdue = []
    total = 0.0
    for r in rows:
        total += float(r["outstanding_amount"] or 0)
        days = date_diff(today, r["due_date"]) if r["due_date"] else 0
        if days > 0:
            overdue.append(
                {
                    "name": r["name"],
                    "due_date": r["due_date"],
                    "days_overdue": days,
                    "outstanding_amount": float(r["outstanding_amount"]),
                }
            )

    return {
        "total": total,
        "invoice_count": len(rows),
        "overdue_invoices": overdue,
    }


@frappe.whitelist()
def aging() -> dict:
    customer = require_customer()
    today = getdate()
    rows = frappe.db.sql(
        """
        SELECT due_date, outstanding_amount
        FROM `tabSales Invoice`
        WHERE customer=%s AND docstatus=1 AND outstanding_amount > 0
        """,
        (customer,),
        as_dict=True,
    )
    buckets = {"0_30": 0.0, "31_60": 0.0, "61_90": 0.0, "over_90": 0.0}
    for r in rows:
        amt = float(r["outstanding_amount"] or 0)
        days = date_diff(today, r["due_date"]) if r["due_date"] else 0
        if days <= 30:
            buckets["0_30"] += amt
        elif days <= 60:
            buckets["31_60"] += amt
        elif days <= 90:
            buckets["61_90"] += amt
        else:
            buckets["over_90"] += amt
    return buckets
