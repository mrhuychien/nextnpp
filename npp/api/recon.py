# -*- coding: utf-8 -*-
"""Biên bản đối chiếu công nợ (PDF) — port từ app ketoan (api/npp.py).

Khác bản ketoan: BỎ lọc `company` và join `tabAccount` (account_type='Receivable').
Nhờ vậy số dư cuối kỳ trên PDF **bằng đúng** `outstanding.gl_balance(customer)` —
tức khớp với con số NPP thấy ở /cong-no và quản lý thấy ở /ql-debt.

Quyền: quản lý (MANAGER_ROLES) xuất cho NPP bất kỳ trong nhóm NPP; NPP tự xuất
biên bản của CHÍNH mình qua export_my_reconciliation (require_customer).
"""

from __future__ import annotations

import json
import re

import frappe
from frappe import _
from frappe.utils import escape_html, flt, formatdate, getdate, money_in_words, today

from ._utils import is_manager, require_customer

COMPANY_NAME = "Công ty Cổ phần Hoàng Giang"
BULK_MAX = 50

_RECON_STYLE = """
* { font-family: "Be Vietnam Pro","DejaVu Sans",Arial,sans-serif; }
body { color:#1e293b; font-size:12px; }
h1 { text-align:center; font-size:18px; margin:4px 0; }
.sub { text-align:center; color:#555; margin-bottom:14px; font-size:12px; }
.meta { margin:10px 0; line-height:1.7; }
.meta b { display:inline-block; min-width:130px; }
table.gl { width:100%; border-collapse:collapse; margin-top:8px; }
table.gl th, table.gl td { border:1px solid #cbd5e1; padding:6px 8px; font-size:11px; }
table.gl th { background:#f1f5f9; text-align:left; }
.num { text-align:right; white-space:nowrap; }
.tot td { font-weight:bold; background:#f8fafc; }
.words { font-style:italic; margin:8px 0 18px; }
.sign { width:100%; margin-top:26px; border:none; }
.sign td { border:none; text-align:center; vertical-align:top; width:50%; font-size:12px; }
.sign .role { font-weight:bold; }
.sign .hint { color:#777; font-size:10px; }
.pagebreak { page-break-after:always; }
"""


def format_vnd(amount) -> str:
    """Định dạng tiền kiểu VN: '1.234.567 ₫' (chỉ dùng phía server cho PDF)."""
    n = round(flt(amount))
    return f"{n:,.0f} ₫".replace(",", ".")


def _company_name() -> str:
    """Tên công ty in trên biên bản: lấy từ Company mặc định của site, fallback hằng số."""
    try:
        c = frappe.defaults.get_global_default("company")
        if c:
            return frappe.db.get_value("Company", c, "company_name") or c
    except Exception:
        pass
    return COMPANY_NAME


def _default_period(to_date: str | None):
    """Kỳ mặc định: 01/01 năm của to_date → to_date. LUÔN trả chuỗi ISO đã chuẩn hoá
    (ngày thô lọt vào SQL sẽ so sánh sai và âm thầm rớt dòng → biên bản sai số)."""
    td = (getdate(to_date) if to_date else None) or getdate()
    return str(td.replace(month=1, day=1)), str(td)


def _norm_from(from_date: str | None, fallback: str) -> str:
    fd = getdate(from_date) if from_date else None
    return str(fd) if fd else fallback


def _fragment(company_name: str, customer: str, from_date: str, to_date: str) -> str:
    """HTML 1 biên bản cho 1 khách (không kèm <html>/<style>)."""
    opening = flt(frappe.db.sql(
        "SELECT COALESCE(SUM(debit-credit),0) FROM `tabGL Entry` "
        "WHERE is_cancelled=0 AND party_type='Customer' AND party=%s AND posting_date < %s",
        (customer, from_date))[0][0] or 0)
    entries = frappe.db.sql(
        """SELECT posting_date, voucher_type, voucher_no, remarks, debit, credit
           FROM `tabGL Entry`
           WHERE is_cancelled=0 AND party_type='Customer' AND party=%s
             AND posting_date BETWEEN %s AND %s
           ORDER BY posting_date ASC, creation ASC""",
        (customer, from_date, to_date), as_dict=True)

    info = frappe.db.get_value("Customer", customer,
                               ["customer_name", "tax_id", "mobile_no"], as_dict=True) or {}
    total_debit = sum(flt(e["debit"]) for e in entries)
    total_credit = sum(flt(e["credit"]) for e in entries)
    closing = opening + total_debit - total_credit

    running = opening
    rows = []
    for e in entries:
        running += flt(e["debit"]) - flt(e["credit"])
        rows.append(
            "<tr>"
            f"<td>{formatdate(e['posting_date'])}</td>"
            f"<td>{escape_html(e['voucher_no'] or '')}</td>"
            f"<td>{escape_html((e['remarks'] or e['voucher_type'] or '')[:80])}</td>"
            f"<td class='num'>{format_vnd(e['debit']) if flt(e['debit']) else ''}</td>"
            f"<td class='num'>{format_vnd(e['credit']) if flt(e['credit']) else ''}</td>"
            f"<td class='num'>{format_vnd(running)}</td>"
            "</tr>")
    rows_html = "".join(rows) or (
        "<tr><td colspan='6' style='text-align:center;color:#888'>Không có phát sinh trong kỳ</td></tr>")

    cust_name = escape_html(info.get("customer_name") or customer)
    tax = escape_html(info.get("tax_id") or "")
    phone = escape_html(info.get("mobile_no") or "")
    closing_words = money_in_words(abs(closing), "VND")

    return f"""
    <div style="text-align:center;font-weight:bold;font-size:13px">{escape_html(company_name)}</div>
    <h1>BIÊN BẢN ĐỐI CHIẾU CÔNG NỢ</h1>
    <div class="sub">Kỳ: {formatdate(from_date)} — {formatdate(to_date)}</div>
    <div class="meta">
      <div><b>Khách hàng:</b> {cust_name}</div>
      {f'<div><b>Mã số thuế:</b> {tax}</div>' if tax else ''}
      {f'<div><b>Điện thoại:</b> {phone}</div>' if phone else ''}
      <div><b>Dư nợ đầu kỳ:</b> {format_vnd(opening)}</div>
    </div>
    <table class="gl">
      <thead><tr><th>Ngày</th><th>Chứng từ</th><th>Diễn giải</th><th class="num">Phát sinh nợ</th><th class="num">Đã thanh toán</th><th class="num">Lũy kế</th></tr></thead>
      <tbody>
        <tr class="tot"><td colspan="5">Dư nợ đầu kỳ</td><td class="num">{format_vnd(opening)}</td></tr>
        {rows_html}
        <tr class="tot"><td colspan="3">Cộng phát sinh</td><td class="num">{format_vnd(total_debit)}</td><td class="num">{format_vnd(total_credit)}</td><td></td></tr>
        <tr class="tot"><td colspan="5">Dư nợ cuối kỳ</td><td class="num">{format_vnd(closing)}</td></tr>
      </tbody>
    </table>
    <div class="words">Số tiền còn phải thu bằng chữ: {closing_words}</div>
    <p>Hai bên thống nhất số liệu công nợ nêu trên là đúng và đầy đủ tính đến ngày {formatdate(to_date)}.</p>
    <table class="sign"><tr>
      <td><div class="role">ĐẠI DIỆN KHÁCH HÀNG</div><div class="hint">(Ký, ghi rõ họ tên, đóng dấu)</div></td>
      <td><div class="role">ĐẠI DIỆN {escape_html(company_name.upper())}</div><div class="hint">(Ký, ghi rõ họ tên, đóng dấu)</div></td>
    </tr></table>
    """


def _document(fragments: list) -> str:
    body = '<div class="pagebreak"></div>'.join(fragments)
    return ('<!doctype html><html><head><meta charset="utf-8">'
            f'<style>{_RECON_STYLE}</style></head><body>{body}</body></html>')


def _download(html: str, filename: str) -> None:
    from frappe.utils.pdf import get_pdf
    frappe.local.response.filename = filename
    frappe.local.response.filecontent = get_pdf(html, options={"orientation": "Portrait"})
    frappe.local.response.type = "download"


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s or "")[:40]


def _guard_manager() -> None:
    if frappe.session.user == "Guest":
        frappe.throw(_("Login required"), frappe.PermissionError)
    if not is_manager():
        frappe.throw(_("Chỉ quản lý kênh mới xuất được biên bản."), frappe.PermissionError)


@frappe.whitelist()
def export_reconciliation(customer: str, from_date: str | None = None, to_date: str | None = None):
    """Xuất biên bản đối chiếu công nợ 1 NPP ra PDF (download)."""
    _guard_manager()
    from .manager import _assert_npp
    _assert_npp(customer)
    fd, td = _default_period(to_date)
    from_date = _norm_from(from_date, fd)
    _download(_document([_fragment(_company_name(), customer, from_date, td)]),
              f"DoiChieuCongNo_{_safe(customer)}_{td}.pdf")


@frappe.whitelist()
def export_reconciliation_bulk(customers, from_date: str | None = None, to_date: str | None = None):
    """Xuất biên bản hàng loạt nhiều NPP vào 1 PDF (mỗi NPP 1 trang)."""
    _guard_manager()
    from .manager import _assert_npp
    if isinstance(customers, str):
        customers = json.loads(customers)
    customers = [c for c in (customers or []) if c]
    if not customers:
        frappe.throw(_("Chưa chọn NPP nào"))
    if len(customers) > BULK_MAX:
        frappe.throw(_("Tối đa {0} NPP mỗi lần xuất").format(BULK_MAX))
    for c in customers:
        _assert_npp(c)
    fd, td = _default_period(to_date)
    from_date = _norm_from(from_date, fd)
    name = _company_name()
    _download(_document([_fragment(name, c, from_date, td) for c in customers]),
              f"DoiChieuCongNo_{len(customers)}NPP_{td}.pdf")


@frappe.whitelist()
def export_my_reconciliation(from_date: str | None = None, to_date: str | None = None,
                             customer: str | None = None):
    """NPP tự xuất biên bản đối chiếu của CHÍNH mình (scope qua require_customer)."""
    customer = require_customer(customer)
    fd, td = _default_period(to_date)
    from_date = _norm_from(from_date, fd)
    _download(_document([_fragment(_company_name(), customer, from_date, td)]),
              f"DoiChieuCongNo_{_safe(customer)}_{td}.pdf")
