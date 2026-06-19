# -*- coding: utf-8 -*-
"""Manager (sales-channel) analytics — toàn bộ NPP.

Chỉ role quản lý (_utils.MANAGER_ROLES); mọi method gọi _guard().
Doanh số loại HĐ opening; công nợ giữ opening. Tính grouped (không N+1).
So sánh kỳ LUÔN period-aligned (cùng số ngày) — không so partial-vs-full.
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
from .outstanding import channel_debt, debt_breakdown, gl_balance, gl_balances

# Cấu hình
NPP_GROUP = "NPP"
RANK_A = 200_000_000
RANK_B = 100_000_000
DORMANT_DAYS = 14

# 63 tỉnh/thành (dùng để chuẩn hoá cột Tỉnh từ territory/tên NPP) — dài hơn ưu tiên match trước.
PROVINCES = sorted([
    "An Giang", "Bà Rịa - Vũng Tàu", "Bạc Liêu", "Bắc Giang", "Bắc Kạn", "Bắc Ninh",
    "Bến Tre", "Bình Dương", "Bình Định", "Bình Phước", "Bình Thuận", "Cà Mau",
    "Cao Bằng", "Cần Thơ", "Đà Nẵng", "Đắk Lắk", "Đắk Nông", "Điện Biên", "Đồng Nai",
    "Đồng Tháp", "Gia Lai", "Hà Giang", "Hà Nam", "Hà Nội", "Hà Tĩnh", "Hải Dương",
    "Hải Phòng", "Hậu Giang", "Hoà Bình", "Hòa Bình", "Hưng Yên", "Khánh Hòa",
    "Kiên Giang", "Kon Tum", "Lai Châu", "Lâm Đồng", "Lạng Sơn", "Lào Cai", "Long An",
    "Nam Định", "Nghệ An", "Ninh Bình", "Ninh Thuận", "Phú Thọ", "Phú Yên", "Quảng Bình",
    "Quảng Nam", "Quảng Ngãi", "Quảng Ninh", "Quảng Trị", "Sóc Trăng", "Sơn La",
    "Tây Ninh", "Thái Bình", "Thái Nguyên", "Thanh Hóa", "Thừa Thiên Huế", "Tiền Giang",
    "TP HCM", "Hồ Chí Minh", "Trà Vinh", "Tuyên Quang", "Vĩnh Long", "Vĩnh Phúc", "Yên Bái",
], key=len, reverse=True)

_GENERIC_TERR = {"", "vietnam", "việt nam", "viet nam", "all territories", "rest of the world"}


def _guard() -> None:
    if frappe.session.user == "Guest":
        frappe.throw(_("Login required"), frappe.PermissionError)
    if not is_manager():
        frappe.throw(_("Chỉ quản lý kênh mới xem được dữ liệu này."), frappe.PermissionError)


def _sum_by_customer(query: str, params: tuple) -> dict:
    return {r["k"]: flt(r["v"]) for r in frappe.db.sql(query, params, as_dict=True)}


def _npp_names() -> tuple:
    return tuple(c["name"] for c in frappe.get_all(
        "Customer", filters={"customer_group": NPP_GROUP, "disabled": 0}, fields=["name"]))


def _resolve_province(territory: str | None, name: str | None) -> str:
    """Chuẩn hoá về tỉnh thật: ưu tiên territory (nếu không phải 'Vietnam'), else dò trong tên NPP."""
    t = (territory or "").strip()
    if t and t.lower() not in _GENERIC_TERR:
        for p in PROVINCES:
            if p.lower() in t.lower():
                return _canon(p)
        return t
    nm = name or ""
    for p in PROVINCES:
        if p.lower() in nm.lower():
            return _canon(p)
    return "Khác"


def _canon(p: str) -> str:
    if p in ("Hồ Chí Minh",):
        return "TP HCM"
    if p == "Hoà Bình":
        return "Hòa Bình"
    return p


@frappe.whitelist()
def overview(months: int = 3) -> dict:
    """Dashboard điều hành toàn kênh + bảng phân tích từng NPP (so-kỳ period-aligned)."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = today  # P0-1: kỳ hiện tại tính ĐẾN HÔM NAY (partial), không lấy cả tháng

    customers = frappe.get_all(
        "Customer", filters={"customer_group": NPP_GROUP, "disabled": 0},
        fields=["name", "customer_name", "territory"], order_by="customer_name asc")
    if not customers:
        return {"months": months, "policy": "normal", "customers": [], "totals": {},
                "growth": {}, "monthly": [], "by_group": [], "by_territory": [],
                "territory_clean": False, "risk": {}}
    names = tuple(c["name"] for c in customers)
    month = today.month
    is_tet = month >= 11 or month <= 2

    def npp_rev(s, e) -> float:
        return flt(frappe.db.sql(
            """SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice`
               WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
                 AND IFNULL(is_opening,'No')!='Yes'""", (names, s, e))[0][0] or 0)

    # ── Per-customer (kỳ [start, today]) ────────────────────────────────
    rev_rows = frappe.db.sql(
        """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS revenue, COUNT(*) AS orders
           FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""",
        (names, start, end), as_dict=True)
    rev_map = {r["k"]: flt(r["revenue"]) for r in rev_rows}
    ord_map = {r["k"]: int(r["orders"]) for r in rev_rows}
    qty_map = _sum_by_customer(
        """SELECT si.customer AS k, COALESCE(SUM(sii.qty),0) AS v
           FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
             AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') GROUP BY si.customer""",
        (names, start, end))
    # Công nợ theo GL (debit−credit) + phân bổ tuổi nợ cho TỪNG NPP — nguồn chuẩn duy nhất.
    cd = channel_debt(names, today)
    fl_rows = frappe.db.sql(
        "SELECT customer AS k, MAX(posting_date) AS last, MIN(posting_date) AS first "
        "FROM `tabSales Invoice` WHERE docstatus=1 AND customer IN %s GROUP BY customer", (names,), as_dict=True)
    last_map = {r["k"]: r["last"] for r in fl_rows}
    first_map = {r["k"]: r["first"] for r in fl_rows}
    # 90 ngày gần nhất vs 90 ngày trước đó — cho phân khúc vòng đời (P1-1)
    rev90 = _sum_by_customer(
        """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""",
        (names, add_days(today, -90), today))
    prev90 = _sum_by_customer(
        """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""",
        (names, add_days(today, -180), add_days(today, -90)))

    if is_tet:
        tet_year = today.year if month >= 11 else today.year - 1
        tet_map = _sum_by_customer(
            """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
               WHERE docstatus=1 AND customer IN %s AND posting_date >= %s AND IFNULL(is_opening,'No')!='Yes'
               GROUP BY customer""", (names, f"{tet_year}-11-01"))
        # Tết: cần TT = công nợ GL − 50% tổng HĐ Tết
        req_of = lambda n: max(0.0, cd.get(n, {}).get("balance", 0.0) - tet_map.get(n, 0.0) * 0.5)
    else:
        # Thường: cần TT = phần công nợ GL đã quá hạn
        req_of = lambda n: cd.get(n, {}).get("overdue", 0.0)

    rows = []
    t_rev = t_qty = t_debt = t_req = 0.0
    n_active = n_dormant = n_new = 0
    seg_count = {"Mới": 0, "Tăng trưởng": 0, "Ổn định": 0, "Suy giảm": 0, "Ngủ đông": 0, "Mất": 0, "Chưa mua": 0}
    terr: dict = {}
    resolved_ok = 0
    for c in customers:
        name = c["name"]
        rev = rev_map.get(name, 0.0); qty = qty_map.get(name, 0.0)
        debt = cd.get(name, {}).get("balance", 0.0); req = req_of(name)
        orders = ord_map.get(name, 0); last = last_map.get(name); first = first_map.get(name)
        days_since = date_diff(today, last) if last else None

        if last is None:
            status = "Chưa mua"
        elif days_since <= DORMANT_DAYS:
            status = "Hoạt động"; n_active += 1
        else:
            status = "Ngủ đông"; n_dormant += 1

        # Phân khúc vòng đời (P1-1): recency + DS 90 ngày vs 90 ngày trước
        r90 = rev90.get(name, 0.0); p90 = prev90.get(name, 0.0)
        if last is None:
            segment = "Chưa mua"
        elif days_since > 90:
            segment = "Mất"
        elif days_since > 30:
            segment = "Ngủ đông"
        elif first and getdate(first) >= add_days(today, -90):
            segment = "Mới"
        elif r90 > p90 * 1.2:
            segment = "Tăng trưởng"
        elif r90 < p90 * 0.8:
            segment = "Suy giảm"
        else:
            segment = "Ổn định"
        seg_count[segment] = seg_count.get(segment, 0) + 1

        is_new = bool(first and getdate(first) >= start)
        if is_new:
            n_new += 1

        # Chu kỳ đặt hàng (P1-2)
        avg_cycle = (date_diff(last, first) / (orders - 1)) if (orders and orders > 1 and first and last) else None
        overdue_reorder = bool(avg_cycle and days_since is not None and days_since > avg_cycle * 1.5)

        avg_month = rev / months
        rank = "A" if avg_month >= RANK_A else ("B" if avg_month >= RANK_B else "C")
        province = _resolve_province(c.get("territory"), c["customer_name"])
        if province != "Khác":
            resolved_ok += 1
        t_rev += rev; t_qty += qty; t_debt += debt; t_req += req
        tv = terr.setdefault(province, {"territory": province, "revenue": 0.0, "debt": 0.0, "count": 0})
        tv["revenue"] += rev; tv["debt"] += debt; tv["count"] += 1
        rows.append({
            "customer": name, "customer_name": c["customer_name"], "territory": province,
            "revenue": rev, "qty": qty, "debt": debt, "required_payment": req,
            "orders": orders, "aov": (rev / orders) if orders else 0.0,
            "last_order": str(last) if last else None, "days_since": days_since,
            "status": status, "segment": segment, "rank": rank, "is_new": is_new,
            "avg_cycle": round(avg_cycle, 1) if avg_cycle else None, "overdue_reorder": overdue_reorder})

    # Pareto / tập trung rủi ro (P1-3)
    sorted_rev = sorted((r["revenue"] for r in rows), reverse=True)
    _tot = sum(sorted_rev) or 1
    cum = 0.0; npp_for_80 = 0
    for v in sorted_rev:
        cum += v; npp_for_80 += 1
        if cum >= _tot * 0.8:
            break
    concentration = {
        "top5_pct": sum(sorted_rev[:5]) / _tot * 100,
        "top10_pct": sum(sorted_rev[:10]) / _tot * 100,
        "npp_for_80": npp_for_80,
    }

    # ── So-kỳ PERIOD-ALIGNED (dời nguyên cửa sổ [start, today]) ─────────
    prev_rev = npp_rev(add_months(start, -months), add_months(today, -months))
    ly_rev = npp_rev(add_months(start, -12), add_months(today, -12))

    # ── Run-rate tháng hiện tại ─────────────────────────────────────────
    mtd = npp_rev(get_first_day(today), today)
    dim = get_last_day(today).day
    run_rate = (mtd / today.day * dim) if today.day else mtd

    # ── Xu hướng 12 tháng (độc lập kỳ) + overlay cùng kỳ năm trước ──────
    m24_start = get_first_day(add_months(today, -23))
    m_rev = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
        """SELECT DATE_FORMAT(posting_date,'%%m/%%Y') AS m, COALESCE(SUM(grand_total),0) AS v
           FROM `tabSales Invoice` WHERE docstatus=1 AND customer IN %s AND posting_date >= %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY m""", (names, m24_start), as_dict=True)}
    m_qty = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
        """SELECT DATE_FORMAT(si.posting_date,'%%m/%%Y') AS m, COALESCE(SUM(sii.qty),0) AS v
           FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date >= %s
             AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') GROUP BY m""",
        (names, get_first_day(add_months(today, -11))), as_dict=True)}
    monthly = []
    for offset in range(11, -1, -1):
        key = getdate(add_months(today, -offset)).strftime("%m/%Y")
        key_ly = getdate(add_months(today, -offset - 12)).strftime("%m/%Y")
        monthly.append({"month": key, "revenue": m_rev.get(key, 0.0), "qty": m_qty.get(key, 0.0),
                        "revenue_ly": m_rev.get(key_ly, 0.0)})

    by_group = [
        {"item_group": r["item_group"], "revenue": flt(r["revenue"]), "qty": flt(r["qty"])}
        for r in frappe.db.sql(
            """SELECT i.item_group, COALESCE(SUM(sii.amount),0) AS revenue, COALESCE(SUM(sii.qty),0) AS qty
               FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
               JOIN `tabItem` i ON sii.item_code=i.item_code
               WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
                 AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
               GROUP BY i.item_group ORDER BY revenue DESC""", (names, start, end), as_dict=True)]

    # ── Dải rủi ro nợ (P0-7) — theo công nợ GL đã phân bổ tuổi nợ ────────
    overdue_total = sum(v["overdue"] for v in cd.values())
    over_90 = sum(v["buckets"]["over_90"] for v in cd.values())
    dso = (t_debt / t_rev * date_diff(end, start)) if t_rev and date_diff(end, start) else 0.0

    return {
        "months": months,
        "policy": "tet" if is_tet else "normal",
        "customers": rows,
        "segments": seg_count,
        "concentration": concentration,
        "monthly": monthly,
        "by_group": by_group,
        "by_territory": sorted(terr.values(), key=lambda x: x["revenue"], reverse=True),
        "territory_clean": (resolved_ok / len(rows) >= 0.9) if rows else False,
        "totals": {
            "revenue": t_rev, "qty": t_qty, "debt": t_debt, "required_payment": t_req,
            "npp_count": len(rows), "active": n_active, "dormant": n_dormant, "new": n_new,
            "orders": sum(ord_map.values()),
            "aov": (t_rev / sum(ord_map.values())) if sum(ord_map.values()) else 0.0,
            "run_rate": run_rate, "dso": dso,
        },
        "growth": {
            "prev_revenue": prev_rev,
            "growth_pct": ((t_rev - prev_rev) / prev_rev * 100) if prev_rev else None,
            "ly_revenue": ly_rev,
            "yoy_pct": ((t_rev - ly_rev) / ly_rev * 100) if ly_rev else None,
        },
        "risk": {"overdue": overdue_total, "over_90": over_90, "dso": dso},
    }


@frappe.whitelist()
def products(months: int = 3) -> dict:
    """Phân tích sản phẩm toàn kênh: top, tăng/giảm (movers), độ phủ nhóm hàng."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = today
    prev_start = add_months(start, -months)
    prev_end = add_months(today, -months)
    names = _npp_names()
    if not names:
        return {"months": months, "top": [], "groups": []}

    cur = frappe.db.sql(
        """SELECT sii.item_code, sii.item_name, i.item_group,
                  COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.qty),0) AS qty,
                  COALESCE(SUM(sii.incoming_rate * sii.stock_qty),0) AS cogs
           FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
           JOIN `tabItem` i ON sii.item_code=i.item_code
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
             AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
           GROUP BY sii.item_code, sii.item_name, i.item_group ORDER BY rev DESC""",
        (names, start, end), as_dict=True)
    prev_rows = frappe.db.sql(
        """SELECT sii.item_code, sii.item_name, COALESCE(SUM(sii.amount),0) AS rev
           FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
             AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
           GROUP BY sii.item_code, sii.item_name""",
        (names, prev_start, prev_end), as_dict=True)
    prev = {r["item_code"]: flt(r["rev"]) for r in prev_rows}
    name_of = {r["item_code"]: r["item_name"] for r in prev_rows}
    top = []
    for r in cur:
        rev = flt(r["rev"]); cogs = flt(r["cogs"]); p = prev.get(r["item_code"], 0.0)
        name_of[r["item_code"]] = r["item_name"]
        top.append({"item_code": r["item_code"], "item_name": r["item_name"], "item_group": r["item_group"],
                    "revenue": rev, "qty": flt(r["qty"]), "cogs": cogs,
                    "margin_pct": ((rev - cogs) / rev * 100) if rev else None,
                    "prev_revenue": p, "growth_pct": ((rev - p) / p * 100) if p else None})

    # ── Tăng/giảm mạnh: gộp cả SKU rớt về 0 (kỳ trước có, kỳ này vắng) + SKU mới ──
    cur_rev = {r["item_code"]: flt(r["rev"]) for r in cur}
    movers = []
    for code in set(cur_rev) | set(prev):
        rev = cur_rev.get(code, 0.0); p = prev.get(code, 0.0)
        movers.append({"item_code": code, "item_name": name_of.get(code, code),
                       "revenue": rev, "prev_revenue": p, "delta": rev - p,
                       "growth_pct": ((rev - p) / p * 100) if p else None})
    up_abs = sorted([m for m in movers if m["delta"] > 0], key=lambda x: x["delta"], reverse=True)[:10]
    up_pct = sorted([m for m in movers if m["growth_pct"] is not None and m["growth_pct"] > 0],
                    key=lambda x: x["growth_pct"], reverse=True)[:10]
    down = sorted([m for m in movers if m["delta"] < 0], key=lambda x: x["delta"])[:10]
    new_skus = sorted([m for m in movers if m["prev_revenue"] == 0 and m["revenue"] > 0],
                      key=lambda x: x["revenue"], reverse=True)[:10]

    total_npp = len(names)
    # ── Độ phủ SKU: mã hàng bán cho ÍT NPP nhất (cơ hội mở rộng phân phối) ──
    coverage = sorted([
        {"item_code": r["item_code"], "item_name": r["item_name"], "buyers": int(r["buyers"]),
         "total_npp": total_npp, "missing": total_npp - int(r["buyers"]), "revenue": flt(r["rev"]),
         "coverage_pct": (int(r["buyers"]) / total_npp * 100) if total_npp else 0}
        for r in frappe.db.sql(
            """SELECT sii.item_code, sii.item_name, COUNT(DISTINCT si.customer) AS buyers,
                      COALESCE(SUM(sii.amount),0) AS rev
               FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
               WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
                 AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
               GROUP BY sii.item_code, sii.item_name""", (names, start, end), as_dict=True)
        if int(r["buyers"]) < total_npp],
        key=lambda x: (x["coverage_pct"], -x["revenue"]))[:40]

    groups = [
        {"item_group": r["item_group"], "revenue": flt(r["rev"]), "qty": flt(r["qty"]),
         "buyers": int(r["buyers"]), "total_npp": total_npp,
         "coverage_pct": (int(r["buyers"]) / total_npp * 100) if total_npp else 0}
        for r in frappe.db.sql(
            """SELECT i.item_group, COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.qty),0) AS qty,
                      COUNT(DISTINCT si.customer) AS buyers
               FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
               JOIN `tabItem` i ON sii.item_code=i.item_code
               WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
                 AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
               GROUP BY i.item_group ORDER BY rev DESC""", (names, start, end), as_dict=True)]
    return {"months": months, "top": top, "groups": groups, "coverage": coverage,
            "movers": {"up_abs": up_abs, "up_pct": up_pct, "down": down, "new": new_skus}}


@frappe.whitelist()
def sku_white_space(item_code: str, months: int = 3) -> list[dict]:
    """NPP có doanh số trong kỳ nhưng CHƯA mua mã hàng `item_code` → cần thúc đẩy."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = today
    names = _npp_names()
    if not names or not item_code:
        return []
    bought = {r[0] for r in frappe.db.sql(
        """SELECT DISTINCT si.customer FROM `tabSales Invoice Item` sii
           JOIN `tabSales Invoice` si ON sii.parent=si.name
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
             AND sii.item_code=%s AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')""",
        (names, start, end, item_code))}
    rev_rows = frappe.db.sql(
        """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""", (names, start, end), as_dict=True)
    info = {c["name"]: c for c in frappe.get_all(
        "Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name"])}
    out = [{"customer": r["k"], "customer_name": (info.get(r["k"]) or {}).get("customer_name") or r["k"],
            "revenue": flt(r["v"])} for r in rev_rows if r["k"] not in bought and flt(r["v"]) > 0]
    out.sort(key=lambda x: x["revenue"], reverse=True)
    return out


@frappe.whitelist()
def white_space(item_group: str, months: int = 3) -> list[dict]:
    """NPP đang phát sinh doanh số nhưng CHƯA mua nhóm `item_group` trong kỳ → cross-sell."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = today
    names = _npp_names()
    if not names or not item_group:
        return []
    bought = {r[0] for r in frappe.db.sql(
        """SELECT DISTINCT si.customer FROM `tabSales Invoice Item` sii
           JOIN `tabSales Invoice` si ON sii.parent=si.name JOIN `tabItem` i ON sii.item_code=i.item_code
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
             AND i.item_group=%s AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')""",
        (names, start, end, item_group))}
    rev_rows = frappe.db.sql(
        """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""", (names, start, end), as_dict=True)
    info = {c["name"]: c for c in frappe.get_all(
        "Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
    out = [{"customer": r["k"], "customer_name": (info.get(r["k"]) or {}).get("customer_name") or r["k"],
            "territory": _resolve_province((info.get(r["k"]) or {}).get("territory"), (info.get(r["k"]) or {}).get("customer_name")),
            "revenue": flt(r["v"])}
           for r in rev_rows if r["k"] not in bought and flt(r["v"]) > 0]
    out.sort(key=lambda x: x["revenue"], reverse=True)
    return out


@frappe.whitelist()
def targets(months: int = 1) -> dict:
    """% hoàn thành mục tiêu. So theo TIẾN ĐỘ tháng (expected pace), không so target cả tháng."""
    _guard()
    months = max(1, min(int(months or 1), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = today
    customers = frappe.get_all(
        "Customer", filters={"customer_group": NPP_GROUP, "disabled": 0},
        fields=["name", "customer_name", "territory", "custom_monthly_target"], order_by="customer_name asc")
    if not customers:
        return {"months": months, "rows": [], "totals": {}, "expected_pace_pct": 0}
    names = tuple(c["name"] for c in customers)
    rev_map = _sum_by_customer(
        """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""", (names, start, end))
    # Gợi ý target: TB doanh số 3 tháng gần nhất × 1.1
    sug_map = _sum_by_customer(
        """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""",
        (names, get_first_day(add_months(today, -2)), today))
    # Tiến độ kỳ vọng: số ngày đã qua / tổng số ngày của kỳ (để biết "đang đúng nhịp" chưa)
    total_days = (months - 1) * 30 + get_last_day(today).day
    elapsed_days = (months - 1) * 30 + today.day
    expected_pace = (elapsed_days / total_days * 100) if total_days else 0
    rows = []
    t_target = t_rev = 0.0
    for c in customers:
        monthly_t = flt(c.get("custom_monthly_target"))
        target = monthly_t * months
        rev = rev_map.get(c["name"], 0.0)
        t_target += target; t_rev += rev
        rows.append({"customer": c["name"], "customer_name": c["customer_name"],
                     "territory": _resolve_province(c.get("territory"), c["customer_name"]),
                     "monthly_target": monthly_t, "target": target, "revenue": rev,
                     "suggested": round(sug_map.get(c["name"], 0.0) / 3 * 1.1, -3),
                     "attainment_pct": (rev / target * 100) if target else None})
    rows.sort(key=lambda x: (x["attainment_pct"] is None, x["attainment_pct"] or 0))
    return {"months": months, "rows": rows, "expected_pace_pct": expected_pace,
            "totals": {"target": t_target, "revenue": t_rev,
                       "attainment_pct": (t_rev / t_target * 100) if t_target else None}}


@frappe.whitelist()
def set_target(customer: str, amount) -> dict:
    """Nhập/cập nhật mục tiêu doanh số THÁNG cho 1 NPP."""
    _guard()
    if not frappe.db.exists("Customer", customer):
        frappe.throw(_("Customer không tồn tại: {0}").format(customer))
    frappe.db.set_value("Customer", customer, "custom_monthly_target", flt(amount))
    return {"customer": customer, "monthly_target": flt(amount)}


@frappe.whitelist()
def set_targets_bulk(data) -> dict:
    """Nhập target hàng loạt: data = [{customer, amount}]."""
    _guard()
    if isinstance(data, str):
        data = frappe.parse_json(data)
    n = 0
    for row in (data or []):
        cust = (row.get("customer") or "").strip()
        if cust and frappe.db.exists("Customer", cust):
            frappe.db.set_value("Customer", cust, "custom_monthly_target", flt(row.get("amount")))
            n += 1
    return {"updated": n}


def _acc(d: dict, k: str, v: float) -> None:
    d[k] = d.get(k, 0.0) + v


@frappe.whitelist()
def receivables() -> dict:
    """Tuổi nợ (aging) toàn kênh + top NPP nợ quá hạn + % sử dụng hạn mức tín dụng.

    Công nợ quá hạn tính theo SỐ DƯ GL (debit−credit) của từng NPP, phân bổ vào HĐ
    mới nhất rồi lấy phần đã tới hạn — KHÔNG cộng dồn outstanding của HĐ cũ đã được
    khoản thu chưa đối trừ bù trừ (cách cũ làm overdue & thứ hạng bị sai/phình to).
    Khớp với cách trang Công nợ chi tiết tính.
    """
    _guard()
    today = getdate()
    names = _npp_names()
    if not names:
        return {"buckets": {}, "top": [], "credit": [], "totals": {}}

    # Công nợ GL + tuổi nợ theo từng NPP (nhóm customer_group='NPP') — chuẩn duy nhất.
    cd = channel_debt(names, today)
    buckets = {"current": 0.0, "d1_30": 0.0, "d31_60": 0.0, "d61_90": 0.0, "over_90": 0.0}
    overdue_by: dict = {}
    total_debt = 0.0
    for c, v in cd.items():
        total_debt += v["balance"]
        for k in buckets:
            buckets[k] += v["buckets"][k]
        if v["overdue"] > 0:
            overdue_by[c] = v["overdue"]
    total_overdue = sum(overdue_by.values())

    info = {c["name"]: c for c in frappe.get_all(
        "Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
    top = sorted([
        {"customer": k, "customer_name": (info.get(k) or {}).get("customer_name") or k,
         "territory": _resolve_province((info.get(k) or {}).get("territory"), (info.get(k) or {}).get("customer_name")),
         "overdue": v} for k, v in overdue_by.items()], key=lambda x: x["overdue"], reverse=True)[:20]

    # Hạn mức tín dụng: dư nợ dùng số dư GL (đúng), so với hạn mức
    credit = []
    try:
        lim: dict = {}
        for r in frappe.get_all("Customer Credit Limit",
                                filters={"parenttype": "Customer", "parent": ["in", list(names)]},
                                fields=["parent", "credit_limit"]):
            _acc(lim, r["parent"], flt(r["credit_limit"]))
        for k, climit in lim.items():
            if climit <= 0:
                continue
            out = max(0.0, cd.get(k, {}).get("balance", 0.0))
            credit.append({"customer": k, "customer_name": (info.get(k) or {}).get("customer_name") or k,
                           "credit_limit": climit, "outstanding": out, "usage_pct": out / climit * 100})
        credit.sort(key=lambda x: x["usage_pct"], reverse=True)
    except Exception:
        credit = []
    return {"buckets": buckets, "top": top, "credit": credit,
            "totals": {"debt": total_debt, "overdue": total_overdue,
                       "current": buckets["current"], "npp_with_debt": len(overdue_by)}}


@frappe.whitelist()
def tet_tracking() -> dict:
    """Theo dõi mùa Tết (Item Group 'Hàng Tết'): độ phủ, DS lũy kế vs LY, NPP chủ lực chưa nhập."""
    _guard()
    today = getdate()
    names = _npp_names()
    if not names:
        return {}
    tet_group = "Hàng Tết"
    tet_year = today.year if today.month >= 11 else today.year - 1
    tet_start = getdate(f"{tet_year}-11-01")
    days_elapsed = max(1, date_diff(today, tet_start))
    ly_start = getdate(f"{tet_year - 1}-11-01")
    ly_to = add_days(ly_start, days_elapsed)
    total_npp = len(names)

    def tet_rev(s, e):
        return flt(frappe.db.sql(
            """SELECT COALESCE(SUM(sii.amount),0) FROM `tabSales Invoice Item` sii
               JOIN `tabSales Invoice` si ON sii.parent=si.name JOIN `tabItem` i ON sii.item_code=i.item_code
               WHERE si.docstatus=1 AND si.customer IN %s AND i.item_group=%s AND si.posting_date BETWEEN %s AND %s
                 AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')""",
            (names, tet_group, s, e))[0][0] or 0)

    this_rev = tet_rev(tet_start, today)
    ly_rev = tet_rev(ly_start, ly_to)
    buyers = {r[0] for r in frappe.db.sql(
        """SELECT DISTINCT si.customer FROM `tabSales Invoice Item` sii
           JOIN `tabSales Invoice` si ON sii.parent=si.name JOIN `tabItem` i ON sii.item_code=i.item_code
           WHERE si.docstatus=1 AND si.customer IN %s AND i.item_group=%s AND si.posting_date >= %s
             AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')""",
        (names, tet_group, tet_start))}
    weekly = [{"week": r["w"], "revenue": flt(r["v"])} for r in frappe.db.sql(
        """SELECT DATE_FORMAT(si.posting_date, '%%x-W%%v') AS w, COALESCE(SUM(sii.amount),0) AS v
           FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
           JOIN `tabItem` i ON sii.item_code=i.item_code
           WHERE si.docstatus=1 AND si.customer IN %s AND i.item_group=%s AND si.posting_date >= %s
             AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') GROUP BY w ORDER BY w""",
        (names, tet_group, tet_start), as_dict=True)]
    rev90 = _sum_by_customer(
        "SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s AND posting_date >= %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
        (names, add_days(today, -90)))
    info = {c["name"]: c for c in frappe.get_all(
        "Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
    not_buying = sorted([
        {"customer": k, "customer_name": (info.get(k) or {}).get("customer_name") or k,
         "territory": _resolve_province((info.get(k) or {}).get("territory"), (info.get(k) or {}).get("customer_name")),
         "revenue": v} for k, v in rev90.items() if k not in buyers and v > 0],
        key=lambda x: x["revenue"], reverse=True)[:20]
    return {
        "tet_year": tet_year, "tet_start": str(tet_start),
        "coverage_pct": (len(buyers) / total_npp * 100) if total_npp else 0,
        "buyers": len(buyers), "total_npp": total_npp,
        "this_revenue": this_rev, "ly_revenue": ly_rev,
        "yoy_pct": ((this_rev - ly_rev) / ly_rev * 100) if ly_rev else None,
        "forecast": (this_rev / days_elapsed * 120),  # mùa Tết ~120 ngày (1/11–28/2)
        "weekly": weekly, "not_buying": not_buying,
    }


@frappe.whitelist()
def insights() -> dict:
    """Cảnh báo hành động — 1 dòng/NPP (cờ nặng nhất). So sánh MTD-aligned (cùng số ngày)."""
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
    debt_map = gl_balances(names)  # công nợ thực theo GL (debit−credit)

    # MTD aligned: cùng số ngày đã qua của tháng
    elapsed = today.day
    this_start = get_first_day(today)
    prev_first = get_first_day(add_months(today, -1))
    prev_end = add_days(prev_first, elapsed - 1)
    this_mtd = _sum_by_customer(
        "SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
        (names, this_start, today))
    prev_mtd = _sum_by_customer(
        "SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
        (names, prev_first, prev_end))

    alerts = []
    for c in names:
        nm = (info.get(c) or {}).get("customer_name") or c
        terr = _resolve_province((info.get(c) or {}).get("territory"), nm)
        last_d = last.get(c)
        debt = debt_map.get(c, 0.0)
        days = date_diff(today, last_d) if last_d else None

        # 1 dòng/NPP — cờ nặng nhất (P0-3). "Tụt 100%" đã gộp vào "ngủ đông".
        if debt > 0 and days is not None and days > 30:
            alerts.append({"type": "debt_risk", "level": "danger", "customer": c, "customer_name": nm,
                           "territory": terr, "value": debt,
                           "message": f"Còn nợ {debt:,.0f}đ nhưng đã {days} ngày không mua"})
        elif last_d is not None and days is not None and days > DORMANT_DAYS:
            alerts.append({"type": "dormant", "level": "warning", "customer": c, "customer_name": nm,
                           "territory": terr, "value": debt,
                           "message": f"Ngủ đông — {days} ngày chưa đặt hàng"})
        else:
            pr = prev_mtd.get(c, 0.0)
            tr = this_mtd.get(c, 0.0)
            if pr > 0 and tr < pr * 0.5:
                drop = (1 - tr / pr) * 100
                alerts.append({"type": "declining", "level": "warning", "customer": c, "customer_name": nm,
                               "territory": terr, "value": pr - tr,
                               "message": f"DS {elapsed} ngày đầu tháng giảm {drop:.0f}% so cùng kỳ tháng trước"})

    order = {"danger": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: (order.get(a["level"], 9), -a["value"]))
    return {"alerts": alerts}


@frappe.whitelist()
def action_center() -> dict:
    """1 dòng/NPP: health score + giá trị rủi ro (tiền) + hành động gợi ý. Sort theo rủi ro."""
    _guard()
    today = getdate()
    names = _npp_names()
    if not names:
        return {"rows": []}
    cust = {c["name"]: c for c in frappe.get_all(
        "Customer", filters={"name": ["in", list(names)]}, fields=["name", "customer_name", "territory"])}
    fl = {r["k"]: r for r in frappe.db.sql(
        "SELECT customer AS k, MAX(posting_date) AS last, MIN(posting_date) AS first, COUNT(*) AS orders "
        "FROM `tabSales Invoice` WHERE docstatus=1 AND customer IN %s GROUP BY customer", (names,), as_dict=True)}
    cd = channel_debt(names, today)  # công nợ GL + tuổi nợ theo từng NPP (chuẩn duy nhất)
    rev90 = _sum_by_customer(
        "SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
        (names, add_days(today, -90), today))
    prev90 = _sum_by_customer(
        "SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice` "
        "WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer",
        (names, add_days(today, -180), add_days(today, -90)))

    rows = []
    for c in names:
        info = cust.get(c, {})
        flc = fl.get(c, {})
        last = flc.get("last"); first = flc.get("first"); orders = int(flc.get("orders") or 0)
        days_since = date_diff(today, last) if last else None
        _cd = cd.get(c, {}); d = _cd.get("balance", 0.0); od = _cd.get("overdue", 0.0)
        o90 = _cd.get("buckets", {}).get("over_90", 0.0)
        r90 = rev90.get(c, 0.0); p90 = prev90.get(c, 0.0)

        if last is None:
            seg = "Chưa mua"
        elif days_since > 90:
            seg = "Mất"
        elif days_since > 30:
            seg = "Ngủ đông"
        elif first and getdate(first) >= add_days(today, -90):
            seg = "Mới"
        elif r90 > p90 * 1.2:
            seg = "Tăng trưởng"
        elif r90 < p90 * 0.8:
            seg = "Suy giảm"
        else:
            seg = "Ổn định"

        avg_cycle = (date_diff(last, first) / (orders - 1)) if (orders > 1 and first and last) else None
        overdue_reorder = bool(avg_cycle and days_since is not None and days_since > avg_cycle * 1.5)

        health = 100
        if seg == "Mất":
            health -= 50
        elif seg == "Ngủ đông":
            health -= 30
        elif seg == "Suy giảm":
            health -= 20
        if od > 0:
            health -= 20
        if o90 > 0:
            health -= 15
        if overdue_reorder:
            health -= 10
        health = max(0, min(100, health))

        losing = (r90 / 3.0) if seg in ("Suy giảm", "Ngủ đông", "Mất") else 0.0
        risk_value = od + losing

        if od > 0:
            action = "Gọi thu nợ"
        elif seg in ("Ngủ đông", "Mất"):
            action = "Chào tái đặt / thăm"
        elif seg == "Suy giảm":
            action = "Tìm hiểu & đẩy KM"
        elif overdue_reorder:
            action = "Nhắc tái đặt"
        else:
            action = "Theo dõi"

        # Bỏ qua NPP khỏe, không rủi ro
        if risk_value <= 0 and health >= 85 and not overdue_reorder:
            continue

        rows.append({
            "customer": c, "customer_name": info.get("customer_name") or c,
            "territory": _resolve_province(info.get("territory"), info.get("customer_name")),
            "segment": seg, "health": health, "debt": d, "overdue": od, "over90": o90,
            "days_since": days_since, "avg_cycle": round(avg_cycle, 1) if avg_cycle else None,
            "risk_value": risk_value, "action": action,
        })

    rows.sort(key=lambda x: x["risk_value"], reverse=True)
    return {"rows": rows}


@frappe.whitelist()
def slow_skus(days: int = 60) -> list[dict]:
    """SKU từng bán (12 tháng) nhưng KHÔNG phát sinh đơn trong `days` ngày gần nhất."""
    _guard()
    days = max(7, min(int(days or 60), 365))
    today = getdate()
    names = _npp_names()
    if not names:
        return []
    recent = {r[0] for r in frappe.db.sql(
        "SELECT DISTINCT sii.item_code FROM `tabSales Invoice Item` sii "
        "JOIN `tabSales Invoice` si ON sii.parent=si.name "
        "WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date >= %s AND sii.uom IN ('Thùng','Box')",
        (names, add_days(today, -days)))}
    rows = frappe.db.sql(
        """SELECT sii.item_code, sii.item_name, MAX(si.posting_date) AS last_sold, COALESCE(SUM(sii.qty),0) AS qty
           FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date >= %s AND sii.uom IN ('Thùng','Box')
           GROUP BY sii.item_code, sii.item_name ORDER BY last_sold ASC""",
        (names, add_days(today, -365)), as_dict=True)
    return [
        {"item_code": r["item_code"], "item_name": r["item_name"], "last_sold": str(r["last_sold"]),
         "qty": flt(r["qty"]), "days_since": date_diff(today, r["last_sold"])}
        for r in rows if r["item_code"] not in recent
    ]


@frappe.whitelist()
def catalog_depth(months: int = 3, thin: int = 5) -> dict:
    """Số SKU phân biệt mỗi NPP mua (chiều sâu danh mục) — cờ NPP 'mỏng danh mục'."""
    _guard()
    months = max(1, min(int(months or 3), 36))
    thin = max(1, int(thin or 5))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    customers = frappe.get_all(
        "Customer", filters={"customer_group": NPP_GROUP, "disabled": 0},
        fields=["name", "customer_name", "territory"])
    if not customers:
        return {"months": months, "thin": thin, "rows": []}
    names = tuple(c["name"] for c in customers)
    sku_map = {r["k"]: int(r["v"]) for r in frappe.db.sql(
        """SELECT si.customer AS k, COUNT(DISTINCT sii.item_code) AS v
           FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
           WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
             AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') GROUP BY si.customer""",
        (names, start, today), as_dict=True)}
    rev_map = _sum_by_customer(
        """SELECT customer AS k, COALESCE(SUM(grand_total),0) AS v FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes' GROUP BY customer""", (names, start, today))
    rows = []
    for c in customers:
        rev = rev_map.get(c["name"], 0.0)
        if rev <= 0:
            continue
        skus = sku_map.get(c["name"], 0)
        rows.append({"customer": c["name"], "customer_name": c["customer_name"],
                     "territory": _resolve_province(c.get("territory"), c["customer_name"]),
                     "sku_count": skus, "revenue": rev, "thin": skus < thin})
    # NPP doanh số cao mà danh mục mỏng = ưu tiên cross-sell
    rows.sort(key=lambda x: (not x["thin"], -x["revenue"]))
    return {"months": months, "thin": thin, "rows": rows}


@frappe.whitelist()
def npp_list() -> list[dict]:
    """Danh sách NPP gọn cho ô chọn ở trang phân tích chi tiết."""
    _guard()
    rows = frappe.get_all(
        "Customer", filters={"customer_group": NPP_GROUP, "disabled": 0},
        fields=["name", "customer_name", "territory"], order_by="customer_name asc")
    return [{"customer": r["name"], "customer_name": r["customer_name"],
             "territory": _resolve_province(r.get("territory"), r["customer_name"])} for r in rows]


@frappe.whitelist()
def npp_detail(customer: str, months: int = 12) -> dict:
    """Phân tích sâu 1 NPP: kinh doanh, tài chính, sản phẩm, nhóm hàng + khuyến nghị thị trường."""
    _guard()
    if not customer or not frappe.db.exists("Customer", customer):
        frappe.throw(_("NPP không tồn tại"))
    cinfo = frappe.db.get_value(
        "Customer", customer,
        ["customer_name", "territory", "customer_group", "creation", "custom_monthly_target"],
        as_dict=True) or {}
    if cinfo.get("customer_group") != NPP_GROUP:
        frappe.throw(_("Khách hàng này không thuộc nhóm NPP"))

    months = max(1, min(int(months or 12), 36))
    today = getdate()
    start = get_first_day(add_months(today, -(months - 1)))
    end = today
    prev_start = add_months(start, -months)
    prev_end = add_months(today, -months)
    ly_start = add_months(start, -12)
    ly_end = add_months(today, -12)

    def rev_between(s, e) -> float:
        return flt(frappe.db.sql(
            "SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice` "
            "WHERE docstatus=1 AND customer=%s AND posting_date BETWEEN %s AND %s "
            "AND IFNULL(is_opening,'No')!='Yes'", (customer, s, e))[0][0] or 0)

    # ── Kinh doanh ──────────────────────────────────────────────────────
    revenue = rev_between(start, end)
    prev_rev = rev_between(prev_start, prev_end)
    ly_rev = rev_between(ly_start, ly_end)
    rev_12 = rev_between(get_first_day(add_months(today, -11)), today)
    avg_monthly = rev_12 / 12.0
    rank = "A" if avg_monthly >= RANK_A else ("B" if avg_monthly >= RANK_B else "C")

    inv = frappe.db.sql(
        "SELECT COUNT(*) AS n FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s "
        "AND posting_date BETWEEN %s AND %s AND IFNULL(is_opening,'No')!='Yes'",
        (customer, start, end), as_dict=True)[0]
    orders = int(inv["n"] or 0)
    aov = (revenue / orders) if orders else 0.0
    qg = frappe.db.sql(
        "SELECT COALESCE(SUM(sii.qty),0) AS qty, COUNT(DISTINCT sii.item_code) AS skus, "
        "COUNT(DISTINCT i.item_group) AS grps "
        "FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
        "JOIN `tabItem` i ON sii.item_code=i.item_code "
        "WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
        "AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')",
        (customer, start, end), as_dict=True)[0]
    qty = flt(qg["qty"]); skus = int(qg["skus"] or 0); groups_bought_n = int(qg["grps"] or 0)

    # ── Vòng đời / nhịp đặt (all-time) ──────────────────────────────────
    fl = frappe.db.sql(
        "SELECT MAX(posting_date) AS last, MIN(posting_date) AS first, COUNT(*) AS n "
        "FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s", (customer,), as_dict=True)[0]
    last = fl["last"]; first = fl["first"]; n_all = int(fl["n"] or 0)
    days_since = date_diff(today, last) if last else None
    avg_cycle = (date_diff(last, first) / (n_all - 1)) if (n_all > 1 and first and last) else None
    next_expected = str(add_days(last, int(round(avg_cycle)))) if (avg_cycle and last) else None
    overdue_reorder = bool(avg_cycle and days_since is not None and days_since > avg_cycle * 1.5)

    r90 = rev_between(add_days(today, -90), today)
    p90 = rev_between(add_days(today, -180), add_days(today, -90))
    if last is None:
        seg = "Chưa mua"
    elif days_since > 90:
        seg = "Mất"
    elif days_since > 30:
        seg = "Ngủ đông"
    elif first and getdate(first) >= add_days(today, -90):
        seg = "Mới"
    elif r90 > p90 * 1.2:
        seg = "Tăng trưởng"
    elif r90 < p90 * 0.8:
        seg = "Suy giảm"
    else:
        seg = "Ổn định"

    # ── Xu hướng 12 tháng + overlay năm trước ───────────────────────────
    trend_start = get_first_day(add_months(today, -11))
    rev_by_m = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
        "SELECT DATE_FORMAT(posting_date,'%%Y-%%m') AS m, COALESCE(SUM(grand_total),0) AS v "
        "FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s AND posting_date>=%s "
        "AND IFNULL(is_opening,'No')!='Yes' GROUP BY m", (customer, trend_start), as_dict=True)}
    qty_by_m = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
        "SELECT DATE_FORMAT(si.posting_date,'%%Y-%%m') AS m, COALESCE(SUM(sii.qty),0) AS v "
        "FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
        "WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date>=%s "
        "AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') GROUP BY m",
        (customer, trend_start), as_dict=True)}
    ly_by_m = {r["m"]: flt(r["v"]) for r in frappe.db.sql(
        "SELECT DATE_FORMAT(posting_date,'%%Y-%%m') AS m, COALESCE(SUM(grand_total),0) AS v "
        "FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s AND posting_date>=%s AND posting_date<%s "
        "AND IFNULL(is_opening,'No')!='Yes' GROUP BY m",
        (customer, add_months(trend_start, -12), trend_start), as_dict=True)}
    monthly = []
    for i in range(12):
        d = getdate(add_months(trend_start, i))
        k = d.strftime("%Y-%m")
        lk = getdate(add_months(d, -12)).strftime("%Y-%m")
        monthly.append({"month": d.strftime("%m/%Y"), "revenue": rev_by_m.get(k, 0.0),
                        "qty": qty_by_m.get(k, 0.0), "revenue_ly": ly_by_m.get(lk, 0.0)})

    # ── Tài chính ───────────────────────────────────────────────────────
    # Công nợ = số dư GL (đúng); tuổi nợ/quá hạn phân bổ vào HĐ mới nhất (debt_breakdown).
    debt = gl_balance(customer)
    _open_inv = frappe.db.sql(
        "SELECT name, posting_date, due_date, grand_total, outstanding_amount "
        "FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s AND outstanding_amount>0 "
        "ORDER BY COALESCE(due_date,posting_date) ASC", (customer,), as_dict=True)
    _bd = debt_breakdown(debt, _open_inv, today)
    buckets = _bd["buckets"]
    overdue = _bd["overdue"]
    dso = (debt / rev_12 * 365) if rev_12 else None

    credit_limit = 0.0
    try:
        for r in frappe.get_all("Customer Credit Limit",
                                filters={"parenttype": "Customer", "parent": customer},
                                fields=["credit_limit"]):
            credit_limit += flt(r["credit_limit"])
    except Exception:
        credit_limit = 0.0
    credit_usage_pct = (debt / credit_limit * 100) if credit_limit else None

    mrow = frappe.db.sql(
        "SELECT COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.incoming_rate*sii.stock_qty),0) AS cogs "
        "FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
        "WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
        "AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')",
        (customer, start, end), as_dict=True)[0]
    m_rev = flt(mrow["rev"]); m_cogs = flt(mrow["cogs"])
    margin_pct = ((m_rev - m_cogs) / m_rev * 100) if m_rev else None

    # ── Mục tiêu ────────────────────────────────────────────────────────
    monthly_target = flt(cinfo.get("custom_monthly_target"))
    target = monthly_target * months
    attainment_pct = (revenue / target * 100) if target else None
    total_days = (months - 1) * 30 + get_last_day(today).day
    elapsed_days = (months - 1) * 30 + today.day
    pace = (elapsed_days / total_days * 100) if total_days else 0

    # ── Sản phẩm ────────────────────────────────────────────────────────
    cur_sku = frappe.db.sql(
        "SELECT sii.item_code, sii.item_name, i.item_group, COALESCE(SUM(sii.amount),0) AS rev, "
        "COALESCE(SUM(sii.qty),0) AS qty, COALESCE(SUM(sii.incoming_rate*sii.stock_qty),0) AS cogs "
        "FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
        "JOIN `tabItem` i ON sii.item_code=i.item_code "
        "WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
        "AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') "
        "GROUP BY sii.item_code, sii.item_name, i.item_group ORDER BY rev DESC",
        (customer, start, end), as_dict=True)
    prev_sku = {r["item_code"]: flt(r["rev"]) for r in frappe.db.sql(
        "SELECT sii.item_code, COALESCE(SUM(sii.amount),0) AS rev "
        "FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
        "WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
        "AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') GROUP BY sii.item_code",
        (customer, prev_start, prev_end), as_dict=True)}
    total_rev_sku = sum(flt(r["rev"]) for r in cur_sku) or 0.0
    products = []
    for r in cur_sku:
        rev = flt(r["rev"]); cogs = flt(r["cogs"]); p = prev_sku.get(r["item_code"], 0.0)
        products.append({
            "item_code": r["item_code"], "item_name": r["item_name"], "item_group": r["item_group"],
            "revenue": rev, "qty": flt(r["qty"]),
            "margin_pct": ((rev - cogs) / rev * 100) if rev else None,
            "pct_of_total": (rev / total_rev_sku * 100) if total_rev_sku else 0,
            "prev_revenue": p, "delta": rev - p,
            "growth_pct": ((rev - p) / p * 100) if p else None})
    bought_skus = {r["item_code"] for r in cur_sku}

    # ── Nhóm hàng ───────────────────────────────────────────────────────
    cur_grp = frappe.db.sql(
        "SELECT i.item_group, COALESCE(SUM(sii.amount),0) AS rev, COALESCE(SUM(sii.qty),0) AS qty "
        "FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
        "JOIN `tabItem` i ON sii.item_code=i.item_code "
        "WHERE si.docstatus=1 AND si.customer=%s AND si.posting_date BETWEEN %s AND %s "
        "AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') "
        "GROUP BY i.item_group ORDER BY rev DESC", (customer, start, end), as_dict=True)
    bought_groups = {r["item_group"] for r in cur_grp}
    total_grp_rev = sum(flt(r["rev"]) for r in cur_grp) or 0.0
    by_group = [{"item_group": r["item_group"], "revenue": flt(r["rev"]), "qty": flt(r["qty"]),
                 "pct": (flt(r["rev"]) / total_grp_rev * 100) if total_grp_rev else 0} for r in cur_grp]
    names = _npp_names()
    chan_groups = [r[0] for r in frappe.db.sql(
        "SELECT i.item_group FROM `tabSales Invoice Item` sii "
        "JOIN `tabSales Invoice` si ON sii.parent=si.name JOIN `tabItem` i ON sii.item_code=i.item_code "
        "WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date>=%s "
        "AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') "
        "GROUP BY i.item_group ORDER BY COALESCE(SUM(sii.amount),0) DESC",
        (names, add_days(today, -365)))]
    total_groups = len(chan_groups)
    coverage_pct = (len(bought_groups) / total_groups * 100) if total_groups else 0
    not_bought = [g for g in chan_groups if g not in bought_groups]

    # ── SKU chưa nhập: mã hàng kênh đang bán mà NPP này CHƯA nhập (cơ hội) ──
    total_npp = len(names)
    products_not_bought = [
        {"item_code": r["item_code"], "item_name": r["item_name"], "channel_revenue": flt(r["rev"]),
         "buyers": int(r["buyers"]), "total_npp": total_npp}
        for r in frappe.db.sql(
            "SELECT sii.item_code, sii.item_name, COALESCE(SUM(sii.amount),0) AS rev, "
            "COUNT(DISTINCT si.customer) AS buyers "
            "FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name "
            "WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date>=%s "
            "AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box') "
            "GROUP BY sii.item_code, sii.item_name ORDER BY rev DESC",
            (names, add_days(today, -365)), as_dict=True)
        if r["item_code"] not in bought_skus][:25]

    # ── Lịch thanh toán (hoá đơn còn nợ, theo hạn) + các khoản đã thu ────
    open_invoices = [
        {"invoice": r["name"], "posting_date": str(getdate(r["posting_date"])),
         "due_date": str(getdate(r["due_date"])) if r.get("due_date") else None,
         "grand_total": flt(r["grand_total"]), "outstanding": flt(r["outstanding_amount"]),
         "days_overdue": max(0, date_diff(today, getdate(r["due_date"]) if r.get("due_date") else add_days(getdate(r["posting_date"]), 30)))}
        for r in _open_inv]
    payments = []
    try:
        payments = [
            {"name": r["name"], "posting_date": str(r["posting_date"]), "amount": flt(r["paid_amount"])}
            for r in frappe.get_all(
                "Payment Entry",
                filters={"party_type": "Customer", "party": customer, "docstatus": 1, "payment_type": "Receive"},
                fields=["name", "posting_date", "paid_amount"], order_by="posting_date desc", limit=15)]
    except Exception:
        payments = []

    # ── Khuyến nghị thị trường ──────────────────────────────────────────
    recs = []
    if overdue > 0:
        det = f"Nợ quá hạn {overdue:,.0f}đ"
        if buckets["over_90"] > 0:
            det += f", trong đó >90 ngày {buckets['over_90']:,.0f}đ"
        recs.append({"icon": "🔴", "level": "danger", "title": "Thu hồi nợ quá hạn", "detail": det})
    if credit_usage_pct is not None and credit_usage_pct >= 80:
        recs.append({"icon": "⚠️", "level": "warning", "title": "Sắp chạm hạn mức tín dụng",
                     "detail": f"Đã dùng {credit_usage_pct:.0f}% hạn mức ({debt:,.0f}/{credit_limit:,.0f}đ)"})
    if seg in ("Ngủ đông", "Mất"):
        recs.append({"icon": "📞", "level": "warning", "title": "Chào tái đặt / thăm NPP",
                     "detail": f"{seg} — đã {days_since} ngày không phát sinh đơn"})
    elif overdue_reorder:
        recs.append({"icon": "⏰", "level": "primary", "title": "Nhắc tái đặt",
                     "detail": f"Quá nhịp: {days_since} ngày (chu kỳ TB ~{round(avg_cycle)}d)"})
    elif seg == "Suy giảm":
        recs.append({"icon": "📉", "level": "warning", "title": "Tìm hiểu nguyên nhân & đẩy KM",
                     "detail": "Doanh số 90 ngày giảm so với kỳ trước"})
    if target and attainment_pct is not None and attainment_pct < pace * 0.8:
        recs.append({"icon": "🎯", "level": "warning", "title": "Chậm so với mục tiêu",
                     "detail": f"Mới đạt {attainment_pct:.0f}% (nhịp kỳ vọng ~{pace:.0f}%)"})
    if margin_pct is not None and margin_pct < 10:
        recs.append({"icon": "💧", "level": "warning", "title": "Biên lợi nhuận thấp",
                     "detail": f"Biên LN chỉ {margin_pct:.1f}% — soát lại chiết khấu/giá bán"})
    if not_bought:
        recs.append({"icon": "🧩", "level": "primary", "title": "Cross-sell nhóm hàng chưa nhập",
                     "detail": "Chưa nhập: " + ", ".join(not_bought[:5])})
    drop_skus = [p for p in products if p["growth_pct"] is not None and p["growth_pct"] <= -40][:5]
    if drop_skus:
        recs.append({"icon": "🛒", "level": "muted", "title": "SKU đang rớt mạnh",
                     "detail": ", ".join(p["item_name"] for p in drop_skus)})
    if not recs:
        recs.append({"icon": "✅", "level": "success", "title": "NPP khỏe mạnh",
                     "detail": "Không có cảnh báo nổi bật — duy trì chăm sóc định kỳ."})

    return {
        "months": months,
        "profile": {
            "customer": customer, "customer_name": cinfo.get("customer_name") or customer,
            "territory": _resolve_province(cinfo.get("territory"), cinfo.get("customer_name")),
            "since": str(getdate(cinfo.get("creation"))) if cinfo.get("creation") else None,
            "segment": seg, "rank": rank, "avg_monthly": avg_monthly,
            "first_order": str(first) if first else None, "last_order": str(last) if last else None,
            "days_since": days_since, "orders_all": n_all,
            "avg_cycle": round(avg_cycle, 1) if avg_cycle else None,
            "next_expected": next_expected, "overdue_reorder": overdue_reorder,
        },
        "sales": {
            "revenue": revenue, "prev_revenue": prev_rev,
            "growth_pct": ((revenue - prev_rev) / prev_rev * 100) if prev_rev else None,
            "ly_revenue": ly_rev, "yoy_pct": ((revenue - ly_rev) / ly_rev * 100) if ly_rev else None,
            "qty": qty, "orders": orders, "aov": aov, "skus": skus, "groups_bought": groups_bought_n,
            "monthly": monthly,
        },
        "finance": {
            "debt": debt, "overdue": overdue, "buckets": buckets, "dso": dso,
            "credit_limit": credit_limit, "credit_usage_pct": credit_usage_pct,
            "revenue": m_rev, "cogs": m_cogs, "gross_profit": m_rev - m_cogs, "margin_pct": margin_pct,
            "open_invoices": open_invoices, "payments": payments,
        },
        "target": {"monthly_target": monthly_target, "target": target,
                   "attainment_pct": attainment_pct, "expected_pace_pct": pace},
        "products": products[:40],
        "products_not_bought": products_not_bought,
        "item_groups": {"by_group": by_group, "coverage_pct": coverage_pct,
                        "bought": len(bought_groups), "total_groups": total_groups,
                        "not_bought": not_bought[:12]},
        "recommendations": recs,
    }
