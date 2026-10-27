# -*- coding: utf-8 -*-
"""Quản lý khuyến mại cấp KÊNH (Channel Manager) — quản trị toàn bộ NPP.

Dữ liệu app `salep` (cùng site). KHÔNG scope theo 1 NPP (quản lý xem tất cả NPP).
Gate: System Manager / Channel Manager / Sales Manager / Accounts Manager.
Phê duyệt tham gia (Display Participation) chỉ đổi workflow_state + approved_by/on
(không có side-effect tạo điểm thưởng — theo workflow blueprint của salep).
Trả thưởng điểm bán 2 lần (salep doc/09): gọi hàm lõi `salep.api.payout` qua `_payout()`
(quản lý kênh — kể cả kế toán Accounts Manager — ghi/xoá được cho mọi NPP).
"""

from __future__ import annotations

from collections import Counter

import frappe
from frappe import _
from frappe.utils import add_days, add_months, get_first_day, get_last_day, getdate, now_datetime

from ._utils import salep_photos, salep_photos_map

APPROVED = "Đã duyệt"
PENDING = "Chờ duyệt"
REJECTED = "Từ chối"
# "Cần duyệt" = mọi lượt CHƯA quyết định. Định nghĩa theo phủ định (không Đã duyệt,
# không Từ chối) để KHÔNG bỏ sót khi state thật là "Nháp", rỗng/None, hay biến thể
# chuỗi khác với "Chờ duyệt" (vd điểm bán tạo qua portal /dp ở trạng thái nháp).
DECIDED = {APPROVED, REJECTED}
ADMIN_ROLES = {"System Manager", "Channel Manager", "Sales Manager", "Accounts Manager"}
PAYOUT_DOCTYPE = "Display Reward Payout"  # trả thưởng 2 lần (salep doc/09, có sau bench migrate)
NPP_HOLD_LABEL = "NPP (chưa giao)"  # điểm do chính tài khoản NPP giữ (cùng nhãn /npp, salep doc/08)
# Display Point: MST + tài khoản nhận thưởng — cột xuất Excel danh sách điểm bán (salep doc/10 §4)
POINT_EXPORT_FIELDS = ("tax_code", "bank_account_name", "bank_account_no", "bank_name")
STAFF_WORKING = "Đang làm"  # Sales Staff Profile.employment_status (salep doc/08) — cùng nhãn /npp
STAFF_LEFT = "Nghỉ việc"


def _is_pending(state) -> bool:
    return (state or "") not in DECIDED


def _guard() -> None:
    if frappe.session.user == "Guest":
        frappe.throw(_("Login required"), frappe.PermissionError)
    if not (set(frappe.get_roles()) & ADMIN_ROLES):
        frappe.throw(_("Chỉ quản lý kênh mới xem được dữ liệu này."), frappe.PermissionError)


def _require_salep() -> None:
    if not (frappe.db.table_exists("Promotion Program")
            and frappe.db.table_exists("Display Participation")
            and frappe.db.table_exists("Display Point")):
        frappe.throw(_("Site chưa cài module Khuyến mại (salep)."))


def _payout():
    """Module lõi `salep.api.payout` (trả thưởng 2 lần — luật R1–R7 + ghi nằm MỘT chỗ ở app salep).
    Nạp lười: salep cũ chưa có module, hoặc đã có code nhưng chưa bench migrate (chưa có bảng
    Display Reward Payout) → báo cần cập nhật."""
    try:
        from salep.api import payout
    except ImportError:
        payout = None
    if payout is None or not frappe.db.table_exists(PAYOUT_DOCTYPE):
        frappe.throw(_("Cần cập nhật app salep (bench migrate) để dùng chức năng này."))
    return payout


def _participation_name(name) -> str:
    """Tên lượt tham gia đã kiểm tồn tại. Chỉ nhận chuỗi: dict/list (JSON body) lọt vào db.exists /
    get_value sẽ thành bộ lọc."""
    name = name.strip() if isinstance(name, str) else ""
    if not name or not frappe.db.exists("Display Participation", name):
        frappe.throw(_("Không tìm thấy lượt tham gia"))
    return name


def _cust_names(names) -> dict:
    names = [n for n in names if n]
    if not names:
        return {}
    return {c["name"]: c["customer_name"] for c in frappe.get_all(
        "Customer", filters={"name": ["in", names]}, fields=["name", "customer_name"])}


def _staff_names() -> dict:
    return {s["user"]: s["full_name"] for s in frappe.get_all(
        "Sales Staff Profile", fields=["user", "full_name"]) if s.get("user")}


def _owner_accounts(users) -> tuple[dict, dict]:
    """Cho LÔ user: (user → set NPP mà user là tài khoản NPP, user → họ tên User). Tài khoản NPP =
    User.custom_customer ∪ Portal User của Customer (cùng định nghĩa salep / promo._npp_users).
    1–2 truy vấn cho cả lô (không N+1)."""
    users = [u for u in users if u]
    if not users:
        return {}, {}
    npp_of: dict = {}
    full: dict = {}
    for u in frappe.get_all("User", filters={"name": ["in", users]},
                            fields=["name", "full_name", "custom_customer"]):
        full[u["name"]] = u.get("full_name")
        if u.get("custom_customer"):
            npp_of.setdefault(u["name"], set()).add(u["custom_customer"])
    try:
        for r in frappe.get_all("Portal User", filters={"parenttype": "Customer", "user": ["in", users]},
                                fields=["parent", "user"]):
            npp_of.setdefault(r["user"], set()).add(r["parent"])
    except Exception:  # site không có doctype Portal User → chỉ dùng custom_customer
        pass
    return npp_of, full


def _point_export_fields() -> list[str]:
    """Cột xuất Excel đã có trên Display Point (salep trước 2026-07 chưa có tax_code) → chỉ đọc cột có;
    key thiếu trả None (không vỡ tab Điểm bán vì "Unknown column")."""
    meta = frappe.get_meta("Display Point")
    return [f for f in POINT_EXPORT_FIELDS if meta.has_field(f)]


def _point_names() -> dict:
    return {r["name"]: r["point_name"] for r in frappe.get_all("Display Point", fields=["name", "point_name"])}


def _point_info() -> dict:
    """name → {point_name, phone, address_line} của mọi điểm bán — 1 truy vấn (thay _point_names ở danh sách
    lượt tham gia: thêm cột SĐT điểm + Địa chỉ cho file Excel, salep doc/10 §3, không thêm truy vấn)."""
    return {r["name"]: r for r in frappe.get_all(
        "Display Point", fields=["name", "point_name", "phone", "address_line"])}


def _staff_has(fieldname: str) -> bool:
    """Sales Staff Profile đã có field này chưa (salep cũ thiếu employment_status/left_on) — như promo."""
    return frappe.get_meta("Sales Staff Profile").has_field(fieldname)


def _program_names() -> dict:
    return {r["name"]: r["program_name"] for r in frappe.get_all("Promotion Program", fields=["name", "program_name"])}


# ─── Tab 1: Điểm bán theo NPP ─────────────────────────────────────────────
@frappe.whitelist()
def points_by_npp() -> dict:
    """Điểm bán MỌI NPP, nhóm theo NPP (+ MST / TK nhận thưởng / ngày tạo / NV phụ trách / số lượt, lượt đã duyệt
    cho file Excel — salep doc/10). Permission: quản lý kênh (_guard)."""
    _guard()
    _require_salep()
    pts = frappe.get_all(
        "Display Point",
        fields=["name", "point_name", "distributor", "address_line", "phone", "is_active", "latitude", "longitude",
                # cột xuất Excel (salep doc/10 §4): MST, TK nhận thưởng, ngày tạo, NV phụ trách (= owner)
                *_point_export_fields(), "creation", "owner"],
        order_by="point_name asc")
    cn = _cust_names({p["distributor"] for p in pts})
    # Nhãn NV phụ trách điểm (cùng nghĩa /npp): tài khoản của chính NPP đó → "NPP (chưa giao)";
    # có hồ sơ NV → họ tên; còn lại → họ tên User / user id. Tra theo lô.
    sn = _staff_names()
    npp_of, full = _owner_accounts({p.get("owner") for p in pts})
    # Số lượt tham gia / lượt đã duyệt của từng điểm (cột Excel doc/10 §3; cùng nghĩa point_detail.stats:
    # mọi chương trình). 1 truy vấn cho CẢ danh sách, đếm trong Python (không N+1).
    n_parts, n_appr = Counter(), Counter()
    if pts:
        for r in frappe.get_all("Display Participation", fields=["display_point", "workflow_state"]):
            n_parts[r.get("display_point")] += 1
            if r.get("workflow_state") == APPROVED:
                n_appr[r.get("display_point")] += 1
    groups: dict = {}
    for p in pts:
        d = p.get("distributor") or "—"
        g = groups.setdefault(d, {"customer": d, "customer_name": cn.get(d, d), "count": 0, "active": 0, "points": []})
        g["count"] += 1
        if p.get("is_active"):
            g["active"] += 1
        owner = p.get("owner")
        if not owner:
            staff_name = ""
        elif p.get("distributor") and p["distributor"] in npp_of.get(owner, ()):
            staff_name = NPP_HOLD_LABEL
        else:
            staff_name = sn.get(owner) or full.get(owner) or owner
        g["points"].append({
            "name": p["name"], "point_name": p.get("point_name") or p["name"],
            "address_line": p.get("address_line"), "phone": p.get("phone"),
            "is_active": bool(p.get("is_active")), "latitude": p.get("latitude"), "longitude": p.get("longitude"),
            "tax_code": p.get("tax_code"), "bank_account_name": p.get("bank_account_name"),
            "bank_account_no": p.get("bank_account_no"), "bank_name": p.get("bank_name"),
            "creation": str(p["creation"]) if p.get("creation") else None,
            "owner": owner, "staff_name": staff_name,
            "participations": n_parts.get(p["name"], 0), "approved": n_appr.get(p["name"], 0)})
    return {"npps": sorted(groups.values(), key=lambda x: x["count"], reverse=True), "total": len(pts)}


# ─── Tab 3: Nhân viên theo NPP ────────────────────────────────────────────
@frappe.whitelist()
def staff_by_npp() -> dict:
    """Nhân viên MỌI NPP, nhóm theo NPP + tiến độ (+ CCCD / trạng thái làm việc / ngày nghỉ / số điểm phụ trách cho
    file Excel — salep doc/10). Permission: quản lý kênh (_guard)."""
    _guard()
    _require_salep()
    # + CCCD / trạng thái làm việc / ngày nghỉ cho file Excel (doc/10 §3). Field nghỉ việc chỉ đọc khi đã có
    # (salep cũ thiếu → coi như Đang làm, như /npp).
    fields = ["name", "user", "full_name", "phone", "distributor", "cccd"]
    fields += [f for f in ("employment_status", "left_on") if _staff_has(f)]
    staff = frappe.get_all("Sales Staff Profile", fields=fields, order_by="full_name asc")
    by_owner: dict = {}
    for p in frappe.get_all("Display Participation", fields=["owner", "workflow_state"]):
        b = by_owner.setdefault(p.get("owner"), {"total": 0, "approved": 0})
        b["total"] += 1
        if p.get("workflow_state") == APPROVED:
            b["approved"] += 1
    users = [s["user"] for s in staff if s.get("user")]
    enabled = {u["name"]: u["enabled"] for u in frappe.get_all(
        "User", filters={"name": ["in", users]}, fields=["name", "enabled"])} if users else {}
    # Số điểm phụ trách = Display Point.owner == user TRONG NPP của hồ sơ (cùng nghĩa /npp staff[].points).
    # 1 truy vấn cho cả lô user, đếm theo (owner, distributor) — không N+1.
    pts_by = Counter((p.get("owner"), p.get("distributor")) for p in frappe.get_all(
        "Display Point", filters={"owner": ["in", users]}, fields=["owner", "distributor"])
    ) if users else Counter()
    cn = _cust_names({s["distributor"] for s in staff})
    groups: dict = {}
    for s in staff:
        d = s.get("distributor") or "—"
        g = groups.setdefault(d, {"customer": d, "customer_name": cn.get(d, d), "staff": []})
        b = by_owner.get(s.get("user"), {"total": 0, "approved": 0})
        status = s.get("employment_status") or STAFF_WORKING  # salep cũ/rỗng → coi như Đang làm (như /npp)
        g["staff"].append({
            "name": s["name"], "user": s["user"], "full_name": s.get("full_name") or s["user"],
            "phone": s.get("phone"), "total": b["total"], "approved": b["approved"],
            "active": bool(enabled.get(s["user"], 1)) if s.get("user") else True,
            "cccd": s.get("cccd"), "employment_status": status, "resigned": status == STAFF_LEFT,
            "left_on": str(s["left_on"]) if s.get("left_on") else None,
            "points": pts_by.get((s["user"], s.get("distributor")), 0) if s.get("user") else 0})
    return {"npps": sorted(groups.values(), key=lambda x: len(x["staff"]), reverse=True), "total": len(staff)}


# ─── Tab 2: Chương trình ──────────────────────────────────────────────────
@frappe.whitelist()
def programs() -> list[dict]:
    """Danh sách chương trình + tiến độ toàn kênh (+ điểm đã duyệt / độ phủ % cho file Excel — salep doc/10).
    Permission: quản lý kênh (_guard)."""
    _guard()
    _require_salep()
    progs = frappe.get_all(
        "Promotion Program",
        fields=["name", "program_name", "status", "start_date", "end_date", "budget", "reward_per_point", "target_points"],
        order_by="start_date desc")
    agg: dict = {}
    for p in frappe.get_all("Display Participation",
                            fields=["promotion_program", "workflow_state", "display_point", "distributor"]):
        a = agg.setdefault(p["promotion_program"], {"total": 0, "approved": 0, "pending": 0, "pts": set(),
                                                    "npps": set(), "appr_pts": set()})
        a["total"] += 1
        if p.get("display_point"):
            a["pts"].add(p["display_point"])
        if p.get("distributor"):
            a["npps"].add(p["distributor"])
        st = p.get("workflow_state")
        if st == APPROVED:
            a["approved"] += 1
            if p.get("display_point"):
                a["appr_pts"].add(p["display_point"])
        elif st != REJECTED:        # chưa quyết định (Chờ duyệt/Nháp/…) = cần duyệt
            a["pending"] += 1
    # Mẫu số độ phủ = điểm đang hoạt động của MỌI NPP (cùng nghĩa program_detail.coverage) — 1 lệnh count
    total_active = frappe.db.count("Display Point", {"is_active": 1}) if progs else 0
    rows = []
    for pg in progs:
        a = agg.get(pg["name"], {"total": 0, "approved": 0, "pending": 0, "pts": set(), "npps": set(),
                                 "appr_pts": set()})
        rows.append({
            "program": pg["name"], "program_name": pg.get("program_name") or pg["name"], "status": pg.get("status"),
            "start_date": str(pg["start_date"]) if pg.get("start_date") else None,
            "end_date": str(pg["end_date"]) if pg.get("end_date") else None,
            "budget": pg.get("budget") or 0, "reward_per_point": pg.get("reward_per_point") or 0,
            "target_points": pg.get("target_points") or 0,
            "participations": a["total"], "approved": a["approved"], "pending": a["pending"],
            "points": len(a["pts"]), "npp_count": len(a["npps"]),
            # cột Excel sheet Chương trình (doc/10 §3): Điểm đã duyệt (điểm ≥1 lượt duyệt) · Độ phủ %
            "approved_points": len(a["appr_pts"]),
            "coverage_pct": (len(a["appr_pts"]) / total_active * 100) if total_active else 0})
    rows.sort(key=lambda x: (x["status"] != "Đang chạy", -x["pending"], -x["participations"]))
    return rows


@frappe.whitelist()
def program_detail(program: str) -> dict:
    """Chi tiết 1 chương trình: cần duyệt, theo NPP / NV, bản đồ, mọi lượt tham gia theo NPP (+ SĐT / địa chỉ
    điểm, toạ độ lượt, lý do từ chối cho file Excel — salep doc/10). Permission: quản lý kênh (_guard)."""
    _guard()
    _require_salep()
    pg = frappe.db.get_value(
        "Promotion Program", program,
        ["name", "program_name", "status", "start_date", "end_date", "budget", "reward_per_point", "target_points"],
        as_dict=True)
    if not pg:
        frappe.throw(_("Chương trình không tồn tại"))
    parts = frappe.get_all("Display Participation", filters={"promotion_program": program},
                           fields=["name", "display_point", "distributor", "owner", "workflow_state", "modified",
                                   # cột Excel Tham gia trưng bày (doc/10 §3): toạ độ lượt + lý do từ chối
                                   "latitude", "longitude", "reject_reason"],
                           order_by="modified desc")
    cn = _cust_names({p["distributor"] for p in parts})
    sn = _staff_names()
    pt_names = _point_names()

    # Điểm bán tham gia chương trình: tên/địa chỉ/toạ độ (bản đồ) + SĐT / địa chỉ điểm (cột Excel)
    # — 1 truy vấn theo lô
    dp_ids = list({p["display_point"] for p in parts if p.get("display_point")})
    coords = {}
    if dp_ids:
        coords = {r["name"]: r for r in frappe.get_all(
            "Display Point", filters={"name": ["in", dp_ids]},
            fields=["name", "point_name", "address_line", "latitude", "longitude", "distributor", "phone"])}

    # Active points per NPP (mẫu số độ phủ)
    npp_active: dict = {}
    for r in frappe.get_all("Display Point", filters={"is_active": 1}, fields=["distributor"]):
        npp_active[r["distributor"]] = npp_active.get(r["distributor"], 0) + 1

    pending, by_npp_map, by_staff_map, parts_by_npp = [], {}, {}, {}
    for p in parts:
        st = p.get("workflow_state")
        if _is_pending(st):
            pending.append({"name": p["name"], "point_name": pt_names.get(p["display_point"]) or p["display_point"],
                            "npp": cn.get(p.get("distributor")) or p.get("distributor"),
                            "staff": sn.get(p.get("owner")) or p.get("owner"),
                            "workflow_state": st,
                            "modified": str(p["modified"]) if p.get("modified") else None})
        d = p.get("distributor") or "—"
        b = by_npp_map.setdefault(d, {"customer": d, "customer_name": cn.get(d, d),
                                      "total": 0, "approved": 0, "pts": set(), "appr_pts": set()})
        b["total"] += 1
        # Danh sách điểm bán tham gia (đầy đủ) theo NPP — cho list xổ/thu ở UI.
        grp = parts_by_npp.setdefault(d, {"customer": d, "customer_name": cn.get(d, d), "approved": 0, "items": []})
        info = coords.get(p.get("display_point")) or {}   # điểm đã xoá → SĐT / địa chỉ = None
        grp["items"].append({"name": p["name"], "display_point": p.get("display_point"),
                             "point_name": pt_names.get(p["display_point"]) or p["display_point"],
                             "workflow_state": st, "staff": sn.get(p.get("owner")) or p.get("owner"),
                             "date": str(p["modified"]) if p.get("modified") else None,
                             "point_phone": info.get("phone"), "point_address": info.get("address_line"),
                             "latitude": p.get("latitude"), "longitude": p.get("longitude"),
                             "reject_reason": p.get("reject_reason")})
        if st == APPROVED:
            grp["approved"] += 1
        if p.get("display_point"):
            b["pts"].add(p["display_point"])
        o = p.get("owner") or "—"
        bs = by_staff_map.setdefault(o, {"user": o, "full_name": sn.get(o, o),
                                         "distributor": p.get("distributor"), "total": 0, "approved": 0, "items": []})
        bs["total"] += 1
        bs["items"].append({"name": p["name"], "display_point": p.get("display_point"),
                            "point_name": pt_names.get(p["display_point"]) or p["display_point"],
                            "workflow_state": st, "date": str(p["modified"]) if p.get("modified") else None})
        if st == APPROVED:
            b["approved"] += 1
            bs["approved"] += 1
            if p.get("display_point"):
                b["appr_pts"].add(p["display_point"])

    by_npp = []
    for d, b in by_npp_map.items():
        tot = npp_active.get(d, 0)
        by_npp.append({"customer": d, "customer_name": b["customer_name"], "total": b["total"],
                       "approved": b["approved"], "points": len(b["pts"]), "approved_points": len(b["appr_pts"]),
                       "active_points": tot, "coverage_pct": (len(b["appr_pts"]) / tot * 100) if tot else 0})
    by_npp.sort(key=lambda x: x["approved"], reverse=True)
    by_staff = sorted(by_staff_map.values(), key=lambda x: x["approved"], reverse=True)
    for x in by_staff:   # nhãn NPP của nhân viên (theo distributor của lượt tham gia)
        x["customer_name"] = cn.get(x.get("distributor")) or x.get("distributor") or "—"

    total_active = sum(npp_active.values())
    participated = len({p["display_point"] for p in parts if p.get("display_point")})
    approved_pts = len({p["display_point"] for p in parts if p.get("workflow_state") == APPROVED and p.get("display_point")})

    # Độ mở: điểm bán TẠO MỚI trong thời gian chương trình
    new_points = 0
    if pg.get("start_date"):
        end = getdate(pg["end_date"]) if pg.get("end_date") else getdate()
        new_points = frappe.db.count(
            "Display Point", {"creation": ["between", [str(getdate(pg["start_date"])), str(add_days(end, 1))]]})

    # Điểm bán tham gia chương trình (gộp theo điểm, `coords` tải ở trên) + toạ độ cho bản đồ.
    # Trạng thái điểm = "đã duyệt" nếu có ÍT NHẤT 1 lượt được duyệt, ngược lại "chờ".
    pmap = {}
    for p in parts:
        dp = p.get("display_point")
        info = coords.get(dp)
        if not info:
            continue
        e = pmap.setdefault(dp, {
            "name": info.get("point_name") or dp, "address_line": info.get("address_line"),
            "latitude": info.get("latitude"), "longitude": info.get("longitude"),
            "npp": cn.get(info.get("distributor")) or info.get("distributor"), "approved": False})
        if p.get("workflow_state") == APPROVED:
            e["approved"] = True
    points = list(pmap.values())

    return {
        "program": {**pg, "start_date": str(pg["start_date"]) if pg.get("start_date") else None,
                    "end_date": str(pg["end_date"]) if pg.get("end_date") else None},
        "pending": pending, "by_npp": by_npp, "by_staff": by_staff, "points": points,
        "participants_by_npp": sorted(parts_by_npp.values(), key=lambda x: len(x["items"]), reverse=True),
        "coverage": {"total_active": total_active, "participated": participated, "approved_points": approved_pts,
                     "pct": (approved_pts / total_active * 100) if total_active else 0},
        "new_points": new_points,
        "totals": {"participations": len(parts), "pending": len(pending),
                   "approved": sum(1 for p in parts if p.get("workflow_state") == APPROVED)},
    }


# ─── Tab 4: Điểm bán cần duyệt ────────────────────────────────────────────
@frappe.whitelist()
def pending_participations(program: str | None = None) -> list[dict]:
    """Lượt tham gia CHƯA quyết định (mọi NPP, lọc chương trình nếu có) + SĐT / địa chỉ điểm, toạ độ lượt cho
    file Excel (salep doc/10). Permission: quản lý kênh (_guard)."""
    _guard()
    _require_salep()
    # Lấy mọi lượt rồi lọc "chưa quyết định" trong Python (NULL-safe; SQL NOT IN bỏ
    # sót NULL). Trả kèm workflow_state để UI hiện badge phân biệt Nháp/Chờ duyệt.
    filters = {"promotion_program": program} if program else {}
    rows = frappe.get_all("Display Participation", filters=filters,
                          fields=["name", "display_point", "promotion_program", "distributor",
                                  "owner", "workflow_state", "modified",
                                  "latitude", "longitude"],   # toạ độ lượt — cột Excel (doc/10 §3)
                          order_by="modified asc")
    rows = [r for r in rows if _is_pending(r.get("workflow_state"))]
    if not rows:
        return []
    pt, pg, sn = _point_info(), _program_names(), _staff_names()
    cn = _cust_names({r["distributor"] for r in rows})
    for r in rows:
        info = pt.get(r["display_point"]) or {}
        r["point_name"] = info.get("point_name") or r["display_point"]
        r["point_phone"] = info.get("phone")  # SĐT điểm — cột Excel (doc/10 §3)
        r["point_address"] = info.get("address_line")  # Địa chỉ điểm — cột Excel (doc/10 §3)
        r["program_name"] = pg.get(r["promotion_program"]) or r["promotion_program"]
        r["npp"] = cn.get(r.get("distributor")) or r.get("distributor")
        r["staff"] = sn.get(r.get("owner")) or r.get("owner")
        r["modified"] = str(r["modified"]) if r.get("modified") else None
    return rows


@frappe.whitelist()
def participation_detail(name: str) -> dict:
    _guard()
    _require_salep()
    p = frappe.db.get_value(
        "Display Participation", name,
        ["name", "display_point", "promotion_program", "distributor", "display_photo", "latitude", "longitude",
         "gps_accuracy", "workflow_state", "reject_reason", "approved_by", "approved_on", "owner", "modified"],
        as_dict=True)
    if not p:
        frappe.throw(_("Không tìm thấy lượt tham gia"))
    pt = frappe.db.get_value("Display Point", p["display_point"],
                             ["point_name", "address_line", "phone", "store_photo", "latitude", "longitude", "is_active"],
                             as_dict=True) or {}
    pg = frappe.db.get_value("Promotion Program", p["promotion_program"],
                             ["program_name", "status", "start_date", "end_date", "reward_per_point"], as_dict=True) or {}
    sn = _staff_names()
    cn = _cust_names([p.get("distributor")])
    for k in ("approved_on", "modified"):
        if p.get(k):
            p[k] = str(p[k])
    # NHIỀU ảnh: child table display_photos (trưng bày CT) + store_photos (điểm bán);
    # fallback ảnh đơn cũ nếu chưa có child rows.
    prog_photos = salep_photos("Display Participation", name, "display_photos")
    if not prog_photos and p.get("display_photo"):
        prog_photos = [{"url": p["display_photo"]}]
    point_photos = salep_photos("Display Point", p["display_point"], "store_photos")
    if not point_photos and pt.get("store_photo"):
        point_photos = [{"url": pt["store_photo"]}]
    image_groups = [{"label": "Ảnh trưng bày (chương trình)", "images": prog_photos},
                    {"label": "Ảnh điểm bán", "images": point_photos}]
    flat = ([{"label": "Ảnh trưng bày (chương trình)", "url": im["url"]} for im in prog_photos]
            + [{"label": "Ảnh điểm bán", "url": im["url"]} for im in point_photos])
    return {
        "participation": p, "point": pt,
        "program": {**pg, "start_date": str(pg.get("start_date")) if pg.get("start_date") else None,
                    "end_date": str(pg.get("end_date")) if pg.get("end_date") else None},
        "npp": cn.get(p.get("distributor")) or p.get("distributor"),
        "staff": sn.get(p.get("owner")) or p.get("owner"),
        "image_groups": image_groups,
        "images": flat,   # tương thích ngược
    }


@frappe.whitelist()
def approve_participation(name: str) -> dict:
    _guard()
    _require_salep()
    doc = frappe.get_doc("Display Participation", name)
    doc.workflow_state = APPROVED
    doc.approved_by = frappe.session.user
    doc.approved_on = now_datetime()
    doc.flags.ignore_permissions = True
    doc.save(ignore_permissions=True)
    return {"name": name, "state": APPROVED}


@frappe.whitelist()
def reject_participation(name: str, reason: str | None = None) -> dict:
    _guard()
    _require_salep()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(_("Vui lòng nhập lý do từ chối."))
    doc = frappe.get_doc("Display Participation", name)
    doc.workflow_state = REJECTED
    doc.reject_reason = reason
    doc.flags.ignore_permissions = True
    doc.save(ignore_permissions=True)
    return {"name": name, "state": REJECTED}


@frappe.whitelist()
def state_summary() -> dict:
    """Chẩn đoán khi danh sách 'cần duyệt' rỗng: tổng lượt tham gia + phân bố theo
    workflow_state (để biết là chưa có lượt nào, hay đã duyệt/từ chối hết, hay
    state thật khác kỳ vọng)."""
    _guard()
    _require_salep()
    counts: dict = {}
    total = 0
    for p in frappe.get_all("Display Participation", fields=["workflow_state"]):
        total += 1
        k = p.get("workflow_state") or "(trống)"
        counts[k] = counts.get(k, 0) + 1
    return {"total": total, "by_state": counts,
            "points": frappe.db.count("Display Point"),
            "programs": frappe.db.count("Promotion Program")}


@frappe.whitelist()
def point_detail(name: str) -> dict:
    """Chi tiết 1 điểm bán + lịch sử tham gia (cho modal ở tab Điểm bán)."""
    _guard()
    _require_salep()
    p = frappe.db.get_value(
        "Display Point", name,
        ["name", "point_name", "address_line", "phone", "latitude", "longitude",
         "is_active", "store_photo", "distributor", "creation"], as_dict=True)
    if not p:
        frappe.throw(_("Không tìm thấy điểm bán"))
    cn = _cust_names([p.get("distributor")])
    sn = _staff_names()
    pg = _program_names()
    parts = frappe.get_all("Display Participation", filters={"display_point": name},
                           fields=["name", "promotion_program", "workflow_state", "owner", "display_photo", "modified"],
                           order_by="modified desc")
    activity = [{"name": x["name"], "program": pg.get(x["promotion_program"]) or x["promotion_program"],
                 "workflow_state": x.get("workflow_state"), "staff": sn.get(x.get("owner")) or x.get("owner"),
                 "display_photo": x.get("display_photo"),
                 "date": str(x["modified"]) if x.get("modified") else None} for x in parts]
    # NHIỀU ảnh: store_photos của điểm + display_photos của từng lượt (gộp 1 truy vấn)
    store_photos = salep_photos("Display Point", name, "store_photos")
    if not store_photos and p.get("store_photo"):
        store_photos = [{"url": p["store_photo"]}]
    part_photos = salep_photos_map("Display Participation", [x["name"] for x in parts], "display_photos")
    image_groups = [{"label": "Ảnh điểm bán", "images": store_photos}]
    images = [{"label": "Ảnh điểm bán", "url": im["url"]} for im in store_photos]
    for a in activity:
        ph = part_photos.get(a["name"]) or ([{"url": a["display_photo"]}] if a.get("display_photo") else [])
        if ph:
            image_groups.append({"label": "Ảnh trưng bày · " + (a["program"] or ""), "images": ph})
            images += [{"label": "Ảnh trưng bày · " + (a["program"] or ""), "url": im["url"]} for im in ph]
    return {
        "point": {**p, "is_active": bool(p.get("is_active")),
                  "creation": str(p.get("creation")) if p.get("creation") else None,
                  "npp": cn.get(p.get("distributor")) or p.get("distributor")},
        "activity": activity, "images": images, "image_groups": image_groups,
        "stats": {"participations": len(parts),
                  "approved": sum(1 for x in parts if x.get("workflow_state") == APPROVED),
                  "programs": len({x["promotion_program"] for x in parts if x.get("promotion_program")})},
    }


@frappe.whitelist()
def staff_detail(name: str) -> dict:
    """Chi tiết 1 nhân viên (Sales Staff Profile) + lịch sử tham gia (cho modal)."""
    _guard()
    _require_salep()
    s = frappe.db.get_value(
        "Sales Staff Profile", name,
        ["name", "user", "full_name", "phone", "cccd", "distributor", "creation"], as_dict=True)
    if not s:
        frappe.throw(_("Không tìm thấy nhân viên"))
    cn = _cust_names([s.get("distributor")])
    enabled, last_login = 1, None
    if s.get("user"):
        u = frappe.db.get_value("User", s["user"], ["enabled", "last_login"], as_dict=True) or {}
        enabled, last_login = u.get("enabled", 1), u.get("last_login")
    pg = _program_names()
    ptn = _point_names()
    parts = frappe.get_all("Display Participation", filters={"owner": s.get("user")},
                           fields=["name", "display_point", "promotion_program", "workflow_state", "modified"],
                           order_by="modified desc") if s.get("user") else []
    activity = [{"name": x["name"], "display_point": x.get("display_point"),
                 "point": ptn.get(x["display_point"]) or x["display_point"],
                 "program": pg.get(x["promotion_program"]) or x["promotion_program"],
                 "workflow_state": x.get("workflow_state"),
                 "date": str(x["modified"]) if x.get("modified") else None} for x in parts]
    return {
        "staff": {**s, "active": bool(enabled),
                  "creation": str(s.get("creation")) if s.get("creation") else None,
                  "last_login": str(last_login) if last_login else None,
                  "npp": cn.get(s.get("distributor")) or s.get("distributor")},
        "activity": activity,
        "stats": {"participations": len(parts),
                  "approved": sum(1 for x in parts if x.get("workflow_state") == APPROVED),
                  "points": len({x["display_point"] for x in parts if x.get("display_point")})},
    }


# ─── Theo dõi cập nhật ảnh trưng bày THEO THÁNG ───────────────────────────────
@frappe.whitelist()
def photo_refresh(month: str | None = None, days_recent: int = 7) -> dict:
    """Điểm bán ĐÃ / CHƯA cập nhật ảnh trưng bày trong tháng `month` ('YYYY-MM',
    mặc định tháng hiện tại) — để đốc thúc nhân viên chụp lại ảnh hằng tháng.

    Mốc thời gian của 1 ảnh = Display Photo.captured_on; thiếu thì lấy
    Display Participation.modified. `recent` = ảnh mới cập nhật trong N ngày
    (dùng làm thông báo trên UI).
    """
    _guard()
    _require_salep()
    today = getdate()
    base = getdate(month + "-01") if month else today
    m_from, m_to = get_first_day(base), get_last_day(base)

    pts = frappe.get_all("Display Point", filters={"is_active": 1},
                         fields=["name", "point_name", "distributor", "phone", "address_line"],
                         order_by="point_name asc")
    if not pts:
        return {"month": base.strftime("%Y-%m"), "month_label": base.strftime("%m/%Y"),
                "totals": {"active_points": 0, "updated": 0, "pending": 0, "pct": 0, "recent": 0},
                "npps": [], "recent": []}

    # Ảnh gần nhất + có ảnh trong tháng hay không, theo TỪNG điểm bán.
    agg = {}
    try:
        for r in frappe.db.sql(
            """SELECT dp.display_point AS point,
                      MAX(COALESCE(ph.captured_on, dp.modified)) AS last_shot,
                      SUM(CASE WHEN DATE(COALESCE(ph.captured_on, dp.modified))
                               BETWEEN %s AND %s THEN 1 ELSE 0 END) AS in_month
               FROM `tabDisplay Participation` dp
               LEFT JOIN `tabDisplay Photo` ph
                 ON ph.parent = dp.name AND ph.parenttype = 'Display Participation'
                AND ph.parentfield = 'display_photos'
               WHERE IFNULL(dp.display_point,'') <> ''
               GROUP BY dp.display_point""", (m_from, m_to), as_dict=True):
            agg[r["point"]] = r
    except Exception:
        frappe.log_error("promo_admin.photo_refresh", frappe.get_traceback())

    cn = _cust_names({p.get("distributor") for p in pts})
    groups: dict = {}
    n_up = n_pending = 0
    for p in pts:
        a = agg.get(p["name"]) or {}
        last = a.get("last_shot")
        item = {"point": p["name"], "point_name": p.get("point_name") or p["name"],
                "phone": p.get("phone"), "address_line": p.get("address_line"),
                "last_shot": str(last) if last else None,
                "days_since": (getdate(last) and (today - getdate(last)).days) if last else None}
        d = p.get("distributor") or "—"
        g = groups.setdefault(d, {"customer": d, "customer_name": cn.get(d, d),
                                  "updated": [], "pending": []})
        if (a.get("in_month") or 0) > 0:
            g["updated"].append(item)
            n_up += 1
        else:
            g["pending"].append(item)
            n_pending += 1
    for g in groups.values():
        g["count_updated"] = len(g["updated"])
        g["count_pending"] = len(g["pending"])
        g["pending"].sort(key=lambda x: (x["days_since"] is not None, -(x["days_since"] or 0)))

    # Thông báo: ảnh vừa cập nhật trong N ngày gần đây.
    recent = []
    try:
        since = add_days(today, -int(days_recent or 7))
        ptn, sn, pgn = _point_names(), _staff_names(), _program_names()
        for r in frappe.db.sql(
            """SELECT dp.display_point AS point, dp.promotion_program AS prog, dp.owner AS owner,
                      dp.distributor AS npp, MAX(COALESCE(ph.captured_on, dp.modified)) AS at
               FROM `tabDisplay Participation` dp
               LEFT JOIN `tabDisplay Photo` ph
                 ON ph.parent = dp.name AND ph.parenttype = 'Display Participation'
                AND ph.parentfield = 'display_photos'
               WHERE DATE(COALESCE(ph.captured_on, dp.modified)) >= %s
                 AND IFNULL(dp.display_point,'') <> ''
               GROUP BY dp.display_point, dp.promotion_program, dp.owner, dp.distributor
               ORDER BY at DESC LIMIT 50""", (since,), as_dict=True):
            recent.append({"point": r["point"], "point_name": ptn.get(r["point"]) or r["point"],
                           "program": pgn.get(r["prog"]) or r["prog"],
                           "staff": sn.get(r["owner"]) or r["owner"],
                           "npp": cn.get(r["npp"]) or r["npp"],
                           "at": str(r["at"]) if r.get("at") else None})
    except Exception:
        recent = []

    total = n_up + n_pending
    return {
        "month": base.strftime("%Y-%m"), "month_label": base.strftime("%m/%Y"),
        "from": str(m_from), "to": str(m_to),
        "totals": {"active_points": total, "updated": n_up, "pending": n_pending,
                   "pct": (n_up / total * 100) if total else 0, "recent": len(recent)},
        "npps": sorted(groups.values(), key=lambda x: x["count_pending"], reverse=True),
        "recent": recent,
    }


# ─── Điểm bán bị TỪ CHỐI ──────────────────────────────────────────────────────
@frappe.whitelist()
def rejected_participations(program: str | None = None) -> list[dict]:
    """Danh sách lượt tham gia bị TỪ CHỐI (kèm lý do) để theo dõi & xử lý lại; + SĐT / địa chỉ điểm, toạ độ
    lượt cho file Excel (salep doc/10). Permission: quản lý kênh (_guard)."""
    _guard()
    _require_salep()
    filters = {"workflow_state": REJECTED}
    if program:
        filters["promotion_program"] = program
    rows = frappe.get_all("Display Participation", filters=filters,
                          fields=["name", "display_point", "promotion_program", "distributor",
                                  "owner", "reject_reason", "modified",
                                  "latitude", "longitude"],   # toạ độ lượt — cột Excel (doc/10 §3)
                          order_by="modified desc", limit_page_length=500)
    if not rows:
        return []
    pt, pg, sn = _point_info(), _program_names(), _staff_names()
    cn = _cust_names({r["distributor"] for r in rows})
    for r in rows:
        info = pt.get(r["display_point"]) or {}
        r["point_name"] = info.get("point_name") or r["display_point"]
        r["point_phone"] = info.get("phone")  # SĐT điểm — cột Excel (doc/10 §3)
        r["point_address"] = info.get("address_line")  # Địa chỉ điểm — cột Excel (doc/10 §3)
        r["workflow_state"] = REJECTED  # lọc sẵn = Từ chối → cột Trạng thái duyệt / Lý do từ chối của file Excel
        r["program_name"] = pg.get(r["promotion_program"]) or r["promotion_program"]
        r["npp"] = cn.get(r.get("distributor")) or r.get("distributor")
        r["staff"] = sn.get(r.get("owner")) or r.get("owner")
        r["modified"] = str(r["modified"]) if r.get("modified") else None
    return rows


# ─── Trả thưởng điểm bán (2 lần) — salep doc/09 ───────────────────────────────
# Quản lý kênh thấy/ghi mọi NPP: _guard() rồi gọi hàm lõi salep.api.payout (luật R1–R7, kiểm trước/
# ghi sau, rollback + log ở đó). Endpoint GHI chỉ nhận POST.
@frappe.whitelist()
def payout_progress(program: str | None = None, customer: str | None = None) -> dict:
    """Tiến độ trả thưởng (Lần 1 / Lần 2) các lượt ĐÃ DUYỆT — mọi NPP, hoặc 1 NPP nếu truyền `customer`;
    lọc 1 chương trình nếu có. Trả {totals, programs[], rows[]} (shape doc/09 §3.3)."""
    _guard()
    _require_salep()
    customer = customer.strip() if isinstance(customer, str) else ""
    return _payout().progress(distributor=customer or None, program=program or None)


@frappe.whitelist()
def participation_payouts(name: str) -> dict:
    """2 lần trả thưởng của 1 lượt: {participation, eligible, reward_per_point, rounds[2]}."""
    _guard()
    _require_salep()
    name = _participation_name(name)
    return _payout().participation_payouts(participation=name)


@frappe.whitelist(methods=["POST"])
def record_payout(participation: str, payout_round, payout_date: str, photos,
                  note: str | None = None) -> dict:
    """Ghi (hoặc cập nhật nếu đã có) trả thưởng lần `payout_round` (1|2) cho 1 lượt ĐÃ DUYỆT: ngày trả
    (≤ hôm nay), ≥1 ảnh đã upload lên site (`photos` = list hoặc chuỗi JSON), ghi chú. Lần 2 cần đã có
    Lần 1. Kế toán (Accounts Manager) ghi được."""
    _guard()
    _require_salep()
    participation = _participation_name(participation)
    return _payout().record_payout(participation=participation, payout_round=payout_round,
                                   payout_date=payout_date, photos=photos, note=note)


@frappe.whitelist(methods=["POST"])
def delete_payout(participation: str, payout_round) -> dict:
    """Xoá trả thưởng lần `payout_round` của 1 lượt (không xoá Lần 1 khi đã có Lần 2)."""
    _guard()
    _require_salep()
    participation = _participation_name(participation)
    return _payout().delete_payout(participation=participation, payout_round=payout_round)
