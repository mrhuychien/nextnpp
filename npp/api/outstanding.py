# -*- coding: utf-8 -*-
"""Outstanding receivables (công nợ) endpoints."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, add_months, date_diff, flt, get_first_day, getdate

from ._utils import require_customer


@frappe.whitelist()
def summary(customer: str | None = None) -> dict:
    customer = require_customer(customer)
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
def aging(customer: str | None = None) -> dict:
    customer = require_customer(customer)
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
def payment_due(customer: str | None = None) -> dict:
    """'Cần thanh toán' theo chính sách Tết/thường — CHỈ cho NPP đang đăng nhập.

    - Tết (tháng 11..2): được nợ 50% tổng HĐ từ 01/11; cần TT = nợ - 50%.
    - Thường: cần TT = tổng dư nợ của HĐ đã quá 30 ngày kể từ ngày HĐ.
    Mọi truy vấn lọc theo require_customer() → KHÔNG lộ dữ liệu NPP khác.
    """
    customer = require_customer(customer)
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


# ─── Sổ công nợ chi tiết (GL ledger) — tham khảo trang "Công Nợ Chi Tiết" ──────

def _day_of(today, months_ahead: int, day: int):
    """Ngày `day` của tháng (today + months_ahead). add_months tự xử lý tràn năm."""
    return getdate(get_first_day(add_months(today, months_ahead))).replace(day=day)


def _inv_due(inv):
    return getdate(inv["due_date"]) if inv.get("due_date") else add_days(getdate(inv["posting_date"]), 30)


def _inv_brief(inv, today):
    d = _inv_due(inv)
    return {
        "name": inv["name"], "posting_date": str(getdate(inv["posting_date"])),
        "due_date": str(d), "outstanding_amount": flt(inv["outstanding_amount"]),
        "days_diff": date_diff(d, today),  # >0 còn hạn, <0 quá hạn
    }


def _payment_schedule(today, in_term, need_pay, need_to_pay_amount):
    """Phân bổ HĐ vào kỳ thanh toán ngày 5 & 20 (HĐ đến hạn 30 ngày tại kỳ TT)."""
    d = today.day
    if d < 5:
        p1, p2 = _day_of(today, 0, 5), _day_of(today, 0, 20)
    elif d < 20:
        p1, p2 = _day_of(today, 0, 20), _day_of(today, 1, 5)
    else:
        p1, p2 = _day_of(today, 1, 5), _day_of(today, 1, 20)

    inv1, inv2 = list(need_pay), []
    total1, total2 = need_to_pay_amount, 0.0
    for inv in in_term:
        posting = getdate(inv["posting_date"])
        out = flt(inv["outstanding_amount"])
        if date_diff(p1, posting) >= 30:
            inv1.append(inv); total1 += out
        elif date_diff(p2, posting) >= 30:
            inv2.append(inv); total2 += out

    first_is_5 = p1.day == 5
    d5 = {"date": p1, "total": total1, "invoices": inv1} if first_is_5 else {"date": p2, "total": total2, "invoices": inv2}
    d20 = {"date": p2, "total": total2, "invoices": inv2} if first_is_5 else {"date": p1, "total": total1, "invoices": inv1}
    return {
        "day5": {"date": str(d5["date"]), "total": d5["total"], "invoices": [_inv_brief(i, today) for i in d5["invoices"]]},
        "day20": {"date": str(d20["date"]), "total": d20["total"], "invoices": [_inv_brief(i, today) for i in d20["invoices"]]},
    }


@frappe.whitelist()
def ledger_detail(customer: str | None = None) -> dict:
    """Sổ công nợ chi tiết của NPP đang đăng nhập: GL ledger (số dư luỹ kế) + tóm
    tắt trong-hạn/cần-TT + lịch thanh toán ngày 5/20 + chính sách Tết.

    Mọi truy vấn scope theo require_customer() → NPP CHỈ thấy dữ liệu của chính mình
    (không nhận `party`/`customer` tuỳ ý từ client trừ khi là quản lý).
    """
    customer = require_customer(customer)
    today = getdate()

    # 1) GL ledger (công nợ phải thu) — số dư luỹ kế theo thời gian
    gl = frappe.db.sql(
        """SELECT name, posting_date, account, voucher_type, voucher_no, debit, credit, remarks
           FROM `tabGL Entry`
           WHERE is_cancelled=0 AND party_type='Customer' AND party=%s
           ORDER BY posting_date ASC, creation ASC""",
        (customer,), as_dict=True)
    running = 0.0
    for e in gl:
        running += flt(e["debit"]) - flt(e["credit"])
        e["running_balance"] = running
        e["debit"] = flt(e["debit"]); e["credit"] = flt(e["credit"])
        e["posting_date"] = str(getdate(e["posting_date"]))
    current_balance = running
    ledger = list(reversed(gl))  # mới nhất trước (cho bảng)

    # 2) HĐ còn nợ (mới nhất trước)
    invoices = frappe.db.sql(
        """SELECT name, posting_date, due_date, grand_total, outstanding_amount, status
           FROM `tabSales Invoice`
           WHERE customer=%s AND docstatus=1 AND outstanding_amount>0
           ORDER BY posting_date DESC""",
        (customer,), as_dict=True)

    # 3) "Real unpaid": phân bổ current_balance vào HĐ mới nhất (GL có thể < tổng
    #    outstanding nếu có khoản thu chưa đối trừ hết).
    real_unpaid, remaining = [], current_balance
    if current_balance > 0:
        for inv in invoices:
            if remaining <= 0:
                break
            real_unpaid.append(inv)
            remaining -= flt(inv["outstanding_amount"])

    in_term, need_pay = [], []
    for inv in real_unpaid:
        (in_term if date_diff(_inv_due(inv), today) > 0 else need_pay).append(inv)
    in_term_amount = sum(flt(i["outstanding_amount"]) for i in in_term)
    need_to_pay_amount = max(0.0, current_balance - in_term_amount)
    if need_to_pay_amount <= 0:
        need_pay = []

    # 4) Tết: HĐ từ 01/11, cần TT thêm = max(0, công nợ − 50% tổng HĐ Tết)
    month = today.month
    tet = {"active": False}
    if month >= 11 or month <= 2:
        tet_year = today.year if month >= 11 else today.year - 1
        tet_start = getdate(f"{tet_year}-11-01")
        tet_inv = [i for i in invoices if getdate(i["posting_date"]) >= tet_start]
        if tet_inv:
            tet_total = sum(flt(i["outstanding_amount"]) for i in tet_inv)
            half = tet_total * 0.5
            tet = {"active": True, "year": tet_year, "total_amount": tet_total,
                   "current_balance": current_balance, "half": half,
                   "payment50": max(0.0, current_balance - half), "count": len(tet_inv),
                   "invoices": [_inv_brief(i, today) for i in tet_inv]}

    return {
        "customer": customer,
        "current_balance": current_balance,
        "transaction_count": len(gl),
        "ledger": ledger,
        "summary": {
            "in_term_amount": in_term_amount, "in_term_count": len(in_term),
            "need_to_pay_amount": need_to_pay_amount, "need_to_pay_count": len(need_pay),
            "in_term_invoices": [_inv_brief(i, today) for i in in_term],
            "need_to_pay_invoices": [_inv_brief(i, today) for i in need_pay],
        },
        "schedule": _payment_schedule(today, in_term, need_pay, need_to_pay_amount),
        "tet": tet,
    }


def _voucher_gl(voucher_type, voucher_no, customer):
    rows = frappe.db.sql(
        """SELECT posting_date, account, debit, credit, remarks FROM `tabGL Entry`
           WHERE voucher_type=%s AND voucher_no=%s AND is_cancelled=0
             AND (party=%s OR IFNULL(party,'')='') ORDER BY posting_date ASC, creation ASC""",
        (voucher_type, voucher_no, customer), as_dict=True)
    for r in rows:
        r["posting_date"] = str(getdate(r["posting_date"]))
        r["debit"] = flt(r["debit"]); r["credit"] = flt(r["credit"])
    return rows


@frappe.whitelist()
def voucher_detail(voucher_type: str, voucher_no: str, customer: str | None = None) -> dict:
    """Chi tiết 1 chứng từ cho modal. Bảo mật: NPP phải là 'party' của chứng từ."""
    customer = require_customer(customer)
    owns = frappe.db.exists("GL Entry", {
        "voucher_type": voucher_type, "voucher_no": voucher_no, "party": customer, "is_cancelled": 0})
    if not owns and not (voucher_type == "Sales Invoice"
                         and frappe.db.get_value("Sales Invoice", voucher_no, "customer") == customer):
        frappe.throw(_("Không có quyền xem chứng từ này."), frappe.PermissionError)

    if voucher_type == "Sales Invoice":
        si = frappe.db.get_value(
            "Sales Invoice", voucher_no,
            ["name", "posting_date", "due_date", "status", "net_total", "discount_amount",
             "grand_total", "outstanding_amount"], as_dict=True) or {}
        for k in ("posting_date", "due_date"):
            if si.get(k):
                si[k] = str(getdate(si[k]))
        items = frappe.get_all("Sales Invoice Item", filters={"parent": voucher_no},
                               fields=["item_code", "item_name", "qty", "uom", "rate", "amount"], order_by="idx")
        taxes = frappe.get_all("Sales Taxes and Charges", filters={"parent": voucher_no},
                               fields=["description", "account_head", "tax_amount"], order_by="idx")
        attachments = frappe.get_all(
            "File", filters={"attached_to_doctype": "Sales Invoice", "attached_to_name": voucher_no},
            fields=["file_name", "file_url", "file_size", "is_private"])
        return {"voucher_type": "Sales Invoice", "invoice": si, "items": items,
                "taxes": taxes, "attachments": attachments}

    if voucher_type == "Payment Entry":
        pe = frappe.db.get_value("Payment Entry", voucher_no,
                                 ["name", "posting_date", "paid_amount", "reference_no"], as_dict=True) or {}
        if pe.get("posting_date"):
            pe["posting_date"] = str(getdate(pe["posting_date"]))
        refs = frappe.get_all("Payment Entry Reference", filters={"parent": voucher_no},
                              fields=["reference_doctype", "reference_name", "allocated_amount"], order_by="idx")
        return {"voucher_type": "Payment Entry", "payment": pe, "references": refs,
                "gl": _voucher_gl(voucher_type, voucher_no, customer)}

    return {"voucher_type": voucher_type, "voucher_no": voucher_no,
            "gl": _voucher_gl(voucher_type, voucher_no, customer)}
