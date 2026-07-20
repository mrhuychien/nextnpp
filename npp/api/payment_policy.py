# -*- coding: utf-8 -*-
"""Chính sách thanh toán NPP + thưởng/phạt theo tiến độ thanh toán.

Quy tắc (chốt với nghiệp vụ):
- Đơn đến hạn 30 ngày được CHỐT vào ngày 5 hàng tháng; NPP thanh toán trong cửa sổ
  ngày 5–10 hàng tháng.
- "Quá hạn thanh toán" tính TỪ NGÀY 10 (cuối cửa sổ). Với mỗi hoá đơn, hạn thanh
  toán = ngày 10 của kỳ chốt (ngày 5 đầu tiên >= due_date).
- Thưởng 2% doanh số của tháng đó, áp theo mức trễ (ngày trễ lớn nhất trong các HĐ
  còn quá hạn):
    · trễ 1–5 ngày  → ân hạn, giữ NGUYÊN thưởng 2%
    · trễ 6–10 ngày → PHẠT 50% thưởng (còn 1%)
    · trễ > 10 ngày → CẮT thưởng (0%)
- Chỉ TÍNH & HIỂN THỊ cho kế toán xử lý — KHÔNG tự tạo bút toán/Payment Entry.
"""

from __future__ import annotations

from frappe.utils import add_months, date_diff, flt, get_first_day, getdate

CHOT_DAY = 5           # chốt đơn ngày 5
DUE_DAY = 10           # hạn cuối thanh toán ngày 10
REWARD_RATE = 0.02     # thưởng 2% doanh số
GRACE_DAYS = 5         # trễ 1–5 ngày: chưa phạt
WARN_MAX_DAYS = 10     # trễ 6–10: phạt 50%; > 10: cắt thưởng

POLICY_TEXT = {
    "title": "Chính sách thanh toán NPP",
    "lines": [
        "Đơn đến hạn 30 ngày được chốt vào ngày 5 hàng tháng.",
        "NPP thanh toán trong cửa sổ ngày 5–10 hàng tháng.",
        "Trễ 6–10 ngày (tính từ ngày 10): phạt 50% thưởng 2% doanh số tháng đó.",
        "Trễ trên 10 ngày: cắt toàn bộ thưởng 2% của tháng đó.",
    ],
}


def settlement_deadline(due_date):
    """Hạn thanh toán (ngày 10) của kỳ chốt cho 1 hoá đơn đến hạn `due_date`.
    Chốt vào ngày 5 đầu tiên >= due_date → hạn TT = ngày 10 của tháng đó."""
    due = getdate(due_date)
    base = due if due.day <= CHOT_DAY else get_first_day(add_months(due, 1))
    return getdate(base).replace(day=DUE_DAY)


def days_late_of(overdue_invoices, today=None) -> int:
    """Số ngày trễ LỚN NHẤT (tính từ hạn ngày 10) trong các HĐ còn quá hạn.
    overdue_invoices: list dict có 'due_date' (hoặc 'due'). Trả 0 nếu chưa trễ."""
    today = today or getdate()
    worst = 0
    for inv in overdue_invoices or []:
        due = inv.get("due_date") or inv.get("due")
        if not due:
            continue
        d = date_diff(today, settlement_deadline(due))
        if d > worst:
            worst = d
    return worst


def reward_factor(days_late: int) -> float:
    if days_late <= GRACE_DAYS:
        return 1.0
    if days_late <= WARN_MAX_DAYS:
        return 0.5
    return 0.0


def status(overdue_invoices, today=None, month_revenue: float = 0.0) -> dict:
    """Trạng thái chính sách + thưởng/phạt cho 1 NPP.
    overdue_invoices: các HĐ ĐÃ QUÁ HẠN còn nợ (có due_date). month_revenue: doanh số
    tháng để tính thưởng 2%."""
    today = today or getdate()
    days_late = days_late_of(overdue_invoices, today)
    factor = reward_factor(days_late)
    if days_late <= 0:
        level, label = "ok", "Đúng hạn"
    elif days_late <= GRACE_DAYS:
        level, label = "grace", f"Trễ {days_late} ngày (ân hạn)"
    elif days_late <= WARN_MAX_DAYS:
        level, label = "warn", f"Trễ {days_late} ngày — phạt 50% thưởng"
    else:
        level, label = "critical", f"Trễ {days_late} ngày — cắt thưởng"
    full = flt(month_revenue) * REWARD_RATE
    return {
        "days_late": days_late,
        "level": level,
        "label": label,
        "reward_pct": REWARD_RATE * 100,
        "reward_full": full,
        "reward_effective": full * factor,
        "penalty": full * (1.0 - factor),
        "reward_factor": factor,
        "needs_action": level in ("warn", "critical"),
    }
