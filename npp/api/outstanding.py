# -*- coding: utf-8 -*-
"""Outstanding receivables (công nợ) endpoints."""

from __future__ import annotations

import frappe
from frappe.utils import add_months, date_diff, flt, get_first_day, getdate

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


@frappe.whitelist()
def payment_due() -> dict:
    """'Cần thanh toán' theo chính sách Tết/thường — CHỈ cho NPP đang đăng nhập.

    - Tết (tháng 11..2): được nợ 50% tổng HĐ từ 01/11; cần TT = nợ - 50%.
    - Thường: cần TT = tổng dư nợ của HĐ đã quá 30 ngày kể từ ngày HĐ.
    Mọi truy vấn lọc theo require_customer() → KHÔNG lộ dữ liệu NPP khác.
    """
    customer = require_customer()
    today = getdate()
    month = today.month
    is_tet = month >= 11 or month <= 2

    invoices = frappe.db.sql(
        """
        SELECT name, posting_date, grand_total, outstanding_amount
        FROM `tabSales Invoice`
        WHERE customer=%s AND docstatus=1 AND outstanding_amount > 0
        ORDER BY posting_date ASC
        """,
        (customer,),
        as_dict=True,
    )
    current_debt = sum(flt(r["outstanding_amount"]) for r in invoices)

    if is_tet:
        tet_year = today.year if month >= 11 else today.year - 1
        tet_start = f"{tet_year}-11-01"
        tet_inv = frappe.db.sql(
            """
            SELECT name, posting_date, grand_total
            FROM `tabSales Invoice`
            WHERE customer=%s AND docstatus=1 AND posting_date >= %s AND grand_total > 0
            ORDER BY posting_date ASC
            """,
            (customer, tet_start),
            as_dict=True,
        )
        tet_total = sum(flt(r["grand_total"]) for r in tet_inv)
        tet_allowed = tet_total * 0.5
        return {
            "policy": "tet",
            "tet_year": tet_year,
            "tet_start": tet_start,
            "current_debt": current_debt,
            "tet_invoice_total": tet_total,
            "tet_allowed_debt": tet_allowed,
            "required_payment": max(0.0, current_debt - tet_allowed),
            "details": [
                {
                    "name": r["name"],
                    "posting_date": str(r["posting_date"]),
                    "grand_total": flt(r["grand_total"]),
                    "allowed_debt": flt(r["grand_total"]) * 0.5,
                }
                for r in tet_inv
            ],
        }

    # Chính sách thường: HĐ quá 30 ngày kể từ ngày phát hành
    required = 0.0
    details = []
    for r in invoices:
        days = date_diff(today, r["posting_date"])
        if days >= 30:
            bal = flt(r["outstanding_amount"])
            required += bal
            details.append(
                {
                    "name": r["name"],
                    "posting_date": str(r["posting_date"]),
                    "amount": flt(r["grand_total"]),
                    "balance": bal,
                    "days_overdue": days - 30,
                }
            )
    return {
        "policy": "normal",
        "current_debt": current_debt,
        "required_payment": required,
        "next_payment": str(_next_payment_day(today)),
        "details": details,
    }


def _next_payment_day(today):
    """Ngày thanh toán kế tiếp (ngày 5 hoặc 20 hàng tháng)."""
    d = today.day
    if d < 5:
        return today.replace(day=5)
    if d < 20:
        return today.replace(day=20)
    return get_first_day(add_months(today, 1)).replace(day=5)
