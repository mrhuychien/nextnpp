# -*- coding: utf-8 -*-
"""Khuyến mại (chương trình trưng bày) — góc nhìn của TỪNG NPP.

Dữ liệu thuộc app `salep` (cùng site): Promotion Program, Display Point,
Display Participation, Sales Staff Profile. Mọi truy vấn scope theo
`require_customer()` (= distributor của NPP) → NPP chỉ thấy địa bàn của mình.

Lưu ý: dùng frappe.get_all (bỏ qua DocPerm) NHƯNG luôn lọc distributor=customer,
nên an toàn và không phụ thuộc việc NPP có role trên doctype của salep hay không.

NV phụ trách điểm bán = `Display Point.owner`; NV phụ trách lượt = `Display Participation.owner`
(salep doc/08). Phần ĐỌC tính tại chỗ (cùng định nghĩa owner_kind với salep); phần GHI
(gán/chuyển điểm, nghỉ việc) + lịch sử NV gọi hàm lõi `salep.api.npp_manage` qua `_npp_manage()`.

Trả thưởng điểm bán 2 lần (salep doc/09): kiểm lượt thuộc NPP rồi gọi hàm lõi `salep.api.payout`
qua `_payout()` (luật + ghi nằm MỘT chỗ ở app salep).
"""

from __future__ import annotations

import re
from collections import Counter

import frappe
from frappe import _
from frappe.utils import cint, getdate

from ._utils import MANAGER_ROLES, require_customer, salep_photos, salep_photos_map

APPROVED = "Đã duyệt"
SALES_STAFF_ROLE = "Sales Staff"
STAFF_WORKING = "Đang làm"
STAFF_LEFT = "Nghỉ việc"
PROGRAM_ENDED = "Kết thúc"
NPP_HOLD_LABEL = "NPP (chưa giao)"
TRANSFER_DOCTYPE = "Display Point Transfer"  # nhật ký bàn giao điểm (salep, có sau bench migrate)
PAYOUT_DOCTYPE = "Display Reward Payout"  # trả thưởng 2 lần (salep doc/09, có sau bench migrate)
INTERNAL_ROLES = {"System Manager", "Channel Manager"}  # tài khoản nội bộ — NPP không được khoá
PARTS_LIMIT = 2000  # npp_participations: lượt mới nhất (khớp salep participations; UI báo khi chạm trần)
# Display Point: MST + tài khoản nhận thưởng — cột xuất Excel danh sách điểm bán (salep doc/10 §4)
POINT_EXPORT_FIELDS = ("tax_code", "bank_account_name", "bank_account_no", "bank_name")
# owner rỗng/không xác định → coi như "other" (không thuộc NV nào của NPP)
_NO_OWNER = {"owner_kind": "other", "staff": None, "staff_name": "", "staff_left": False}


def _require_salep() -> None:
    if not (frappe.db.table_exists("Promotion Program")
            and frappe.db.table_exists("Display Participation")
            and frappe.db.table_exists("Display Point")):
        frappe.throw(_("Site chưa cài module Khuyến mại (salep)."))


def _npp_manage():
    """Module lõi `salep.api.npp_manage` (gán/chuyển điểm, nghỉ việc, lịch sử NV — logic GHI
    nằm MỘT chỗ ở app salep). Nạp lười: salep cũ chưa có module → báo cần cập nhật."""
    try:
        from salep.api import npp_manage
    except ImportError:
        frappe.throw(_("Cần cập nhật app salep (bench migrate) để dùng chức năng này."))
    return npp_manage


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


def _own_participation(participation, customer) -> str:
    """Trả tên lượt nếu lượt thuộc NPP (distributor == customer), else PermissionError. Kiểm TRƯỚC khi
    gọi hàm lõi trả thưởng (hàm lõi không tự kiểm phạm vi). Chỉ nhận chuỗi: dict/list (JSON body) lọt vào
    get_value sẽ thành bộ lọc → vượt kiểm. Lượt không tồn tại báo như không có quyền."""
    name = participation.strip() if isinstance(participation, str) else ""
    dist = frappe.db.get_value("Display Participation", name, "distributor") if name else None
    if not dist or dist != customer:
        frappe.throw(_("Không có quyền với lượt tham gia này."), frappe.PermissionError)
    return name


def _staff_has(fieldname: str) -> bool:
    """Sales Staff Profile đã có field này chưa (salep cũ thiếu employment_status/left_on/handover_to)."""
    return frappe.get_meta("Sales Staff Profile").has_field(fieldname)


def _point_export_fields() -> list[str]:
    """Cột xuất Excel đã có trên Display Point (salep trước 2026-07 chưa có tax_code) → chỉ đọc cột có;
    key thiếu trả None (không vỡ cả tab Khuyến mại vì "Unknown column")."""
    meta = frappe.get_meta("Display Point")
    return [f for f in POINT_EXPORT_FIELDS if meta.has_field(f)]


def _staff_profiles(customer: str) -> list[dict]:
    """Hồ sơ NV của NPP (kể cả đã nghỉ việc). Field nghỉ việc chỉ đọc khi đã có (salep cũ → thiếu)."""
    fields = ["name", "user", "full_name", "phone", "cccd"]
    fields += [f for f in ("employment_status", "left_on") if _staff_has(f)]
    return frappe.get_all("Sales Staff Profile", filters={"distributor": customer},
                          fields=fields, order_by="full_name asc")


def _npp_users(customer: str) -> set[str]:
    """Tài khoản NPP = User.custom_customer == NPP ∪ Portal User của Customer (cùng định nghĩa salep)."""
    users = set(frappe.get_all("User", filters={"custom_customer": customer}, pluck="name"))
    try:
        users.update(frappe.get_all(
            "Portal User", filters={"parenttype": "Customer", "parent": customer}, pluck="user"))
    except Exception:  # site không có doctype Portal User → chỉ dùng custom_customer
        pass
    users.discard(None)
    return users


def _owner_map(customer: str, users, profiles: list[dict] | None = None,
               npp_users: set[str] | None = None) -> dict:
    """owner (User) → {owner_kind, staff, staff_name, staff_left} cho CẢ LÔ user (gộp truy vấn, không N+1).

    - npp:   tài khoản NPP (kể cả khi chủ NPP có hồ sơ NV riêng) → điểm "NPP giữ (chưa giao)"
    - staff: có Sales Staff Profile CỦA NPP này (nhãn = họ tên, staff_left = đã nghỉ việc)
    - other: còn lại (Administrator, NV đã xoá hồ sơ, NV NPP khác…) → nhãn = họ tên User
    """
    if profiles is None:
        profiles = _staff_profiles(customer)
    users = {u for u in (users or []) if u}
    by_user = {p["user"]: p for p in profiles if p.get("user")}
    if npp_users is None:
        npp_users = _npp_users(customer) if users else set()
    others = [u for u in users if u not in by_user and u not in npp_users]
    names = {r["name"]: r.get("full_name") for r in frappe.get_all(
        "User", filters={"name": ["in", others]}, fields=["name", "full_name"])} if others else {}
    out: dict = {}
    for u in users:
        prof = by_user.get(u)
        if u in npp_users:
            out[u] = {"owner_kind": "npp", "staff": None, "staff_name": NPP_HOLD_LABEL, "staff_left": False}
        elif prof:
            out[u] = {"owner_kind": "staff", "staff": prof["name"],
                      "staff_name": prof.get("full_name") or u,
                      "staff_left": prof.get("employment_status") == STAFF_LEFT}
        else:
            out[u] = {"owner_kind": "other", "staff": None, "staff_name": names.get(u) or u, "staff_left": False}
    return out


def _program_active(pg: dict, today) -> bool:
    """Chương trình CÒN HIỆU LỰC: status != "Kết thúc" và (end_date rỗng hoặc >= hôm nay)."""
    return bool(pg) and pg.get("status") != PROGRAM_ENDED and (
        not pg.get("end_date") or getdate(pg["end_date"]) >= today)


@frappe.whitelist()
def npp_overview(customer: str | None = None) -> dict:
    """Tổng quan khuyến mại của NPP: chương trình + tiến độ, điểm bán (+ NV phụ trách, số lượt),
    nhân viên + tiến độ (+ số điểm phụ trách, trạng thái nghỉ việc)."""
    customer = require_customer(customer)
    _require_salep()

    # Điểm bán của NPP (owner = NV phụ trách điểm) + MST / TK nhận thưởng / ngày tạo (cột Excel)
    points = frappe.get_all(
        "Display Point", filters={"distributor": customer},
        fields=["name", "point_name", "address_line", "phone", "is_active",
                "latitude", "longitude", "owner", *_point_export_fields(), "creation"],
        order_by="point_name asc")
    active_points = sum(1 for p in points if p.get("is_active"))

    # Tham gia của NPP (mọi chương trình)
    parts = frappe.get_all(
        "Display Participation", filters={"distributor": customer},
        fields=["name", "display_point", "promotion_program", "workflow_state", "owner"])

    # Gộp theo chương trình
    by_prog: dict = {}
    for p in parts:
        b = by_prog.setdefault(p["promotion_program"], {"total": 0, "approved": 0, "pts": set(), "appr_pts": set()})
        b["total"] += 1
        if p.get("display_point"):
            b["pts"].add(p["display_point"])
        if p.get("workflow_state") == APPROVED:
            b["approved"] += 1
            if p.get("display_point"):
                b["appr_pts"].add(p["display_point"])

    programs = frappe.get_all(
        "Promotion Program",
        fields=["name", "program_name", "status", "start_date", "end_date",
                "target_points", "reward_per_point"], order_by="start_date desc")
    prog_rows = []
    for pg in programs:
        b = by_prog.get(pg["name"], {"total": 0, "approved": 0, "pts": set(), "appr_pts": set()})
        prog_rows.append({
            "program": pg["name"], "program_name": pg.get("program_name") or pg["name"],
            "status": pg.get("status"), "start_date": str(pg["start_date"]) if pg.get("start_date") else None,
            "end_date": str(pg["end_date"]) if pg.get("end_date") else None,
            "target_points": pg.get("target_points") or 0, "reward_per_point": pg.get("reward_per_point") or 0,
            "participations": b["total"], "approved": b["approved"],
            "points": len(b["pts"]), "approved_points": len(b["appr_pts"]),
            "coverage_pct": (len(b["appr_pts"]) / active_points * 100) if active_points else 0,
        })
    # Chương trình đang chạy lên trước
    prog_rows.sort(key=lambda x: (x["status"] != "Đang chạy", -(x["approved"])))

    # Nhân viên của NPP + tiến độ (gộp tham gia theo người tạo = owner)
    by_staff: dict = {}
    by_point: dict = {}  # số lượt / lượt đã duyệt của từng điểm bán
    for p in parts:
        b = by_staff.setdefault(p["owner"], {"total": 0, "approved": 0})
        bp = by_point.setdefault(p.get("display_point"), {"total": 0, "approved": 0})
        b["total"] += 1
        bp["total"] += 1
        if p.get("workflow_state") == APPROVED:
            b["approved"] += 1
            bp["approved"] += 1
    staff = _staff_profiles(customer)
    user_ids = [s["user"] for s in staff if s.get("user")]
    enabled = {u["name"]: u["enabled"] for u in frappe.get_all(
        "User", filters={"name": ["in", user_ids]}, fields=["name", "enabled"])} if user_ids else {}
    # NV phụ trách điểm: owner → owner_kind/nhãn (1 lô cho mọi owner của điểm)
    npp = _npp_users(customer)
    who = _owner_map(customer, {p["owner"] for p in points}, staff, npp)
    pts_by_owner = Counter(p["owner"] for p in points)
    staff_rows, seen = [], set()
    for s in staff:
        b = by_staff.get(s["user"], {"total": 0, "approved": 0})
        status = s.get("employment_status") or STAFF_WORKING  # salep cũ/rỗng → coi như Đang làm
        staff_rows.append({"name": s["name"], "user": s["user"], "full_name": s.get("full_name") or s["user"],
                           "phone": s.get("phone"), "cccd": s.get("cccd"), "total": b["total"], "approved": b["approved"],
                           "active": bool(enabled.get(s["user"], 1)) if s.get("user") else True,
                           "points": pts_by_owner.get(s["user"], 0), "employment_status": status,
                           "resigned": status == STAFF_LEFT,
                           "left_on": str(s["left_on"]) if s.get("left_on") else None})
        seen.add(s["user"])
    # Người tạo tham gia nhưng chưa có hồ sơ NV (NV đã xoá hồ sơ, Administrator…). Bỏ tài khoản NPP:
    # đó là "NPP giữ" (§1), không phải nhân viên — bàn giao về NPP giờ chuyển lượt cho tài khoản NPP.
    for u, b in by_staff.items():
        if u and u not in seen and u not in npp:
            staff_rows.append({"name": None, "user": u, "full_name": u, "phone": None,
                               "cccd": None,  # không có hồ sơ → không CCCD (cùng shape dòng có hồ sơ)
                               "total": b["total"], "approved": b["approved"], "active": True,
                               "points": pts_by_owner.get(u, 0), "employment_status": None,
                               "resigned": False, "left_on": None})
    # NV đang làm trước, NV đã nghỉ xuống cuối; trong nhóm theo lượt đã duyệt giảm dần
    staff_rows.sort(key=lambda x: (x["resigned"], -x["approved"]))

    participated = {p["display_point"] for p in parts if p.get("display_point")}
    approved_total = sum(1 for p in parts if p.get("workflow_state") == APPROVED)
    point_rows = []
    for p in points:
        bp = by_point.get(p["name"], {"total": 0, "approved": 0})
        point_rows.append({**p, **{f: p.get(f) for f in POINT_EXPORT_FIELDS},  # salep cũ thiếu cột → None
                           "is_active": bool(p.get("is_active")),
                           "creation": str(p["creation"]) if p.get("creation") else None,
                           "participated": p["name"] in participated,
                           **(who.get(p.get("owner")) or _NO_OWNER),
                           "participations": bp["total"], "approved": bp["approved"]})
    return {
        "customer": customer,
        "self_is_staff": bool(frappe.db.get_value(
            "Sales Staff Profile", {"user": frappe.session.user, "distributor": customer}, "name")),
        "totals": {"programs": len(prog_rows),
                   "running": sum(1 for x in prog_rows if x["status"] == "Đang chạy"),
                   "points": len(points), "active_points": active_points,
                   "unassigned_points": sum(1 for p in point_rows if p["owner_kind"] == "npp"),
                   "participated_points": len(participated),
                   "participations": len(parts), "approved": approved_total,
                   "staff": len(staff_rows),
                   "staff_left": sum(1 for x in staff_rows if x["resigned"])},
        "programs": prog_rows,
        "points": point_rows,
        "staff": staff_rows,
    }


@frappe.whitelist()
def npp_participations(program: str | None = None, customer: str | None = None) -> list[dict]:
    """Danh sách điểm bán THAM GIA chương trình của NPP (lọc theo chương trình nếu có), tối đa
    PARTS_LIMIT lượt mới nhất. Mỗi dòng kèm point_phone, NV phụ trách lượt (owner → staff/staff_name/
    staff_left/owner_kind) và program_active = chương trình còn hiệu lực (lượt sẽ chuyển theo khi
    gán lại điểm)."""
    customer = require_customer(customer)
    _require_salep()
    filters = {"distributor": customer}
    if program:
        filters["promotion_program"] = program
    rows = frappe.get_all(
        "Display Participation", filters=filters,
        fields=["name", "display_point", "promotion_program", "workflow_state",
                "owner", "modified", "latitude", "longitude", "reject_reason"],
        order_by="modified desc", limit_page_length=PARTS_LIMIT)
    if not rows:
        return []
    pts = {r["name"]: r for r in frappe.get_all(
        "Display Point", filters={"distributor": customer}, fields=["name", "point_name", "phone"])}
    pgs = {r["name"]: r for r in frappe.get_all(
        "Promotion Program", fields=["name", "program_name", "status", "end_date"])}
    who = _owner_map(customer, {r["owner"] for r in rows})
    today = getdate()
    for r in rows:
        pg = pgs.get(r["promotion_program"]) or {}
        pt = pts.get(r["display_point"]) or {}
        r["point_name"] = pt.get("point_name") or r["display_point"]
        r["point_phone"] = pt.get("phone")  # tìm theo SĐT ở tab Chương trình
        r["program_name"] = pg.get("program_name") or r["promotion_program"]
        r["program_active"] = _program_active(pg, today)
        r["modified"] = str(r["modified"]) if r.get("modified") else None
        r.update(who.get(r.get("owner")) or _NO_OWNER)
    return rows


@frappe.whitelist()
def npp_point_detail(point: str, customer: str | None = None) -> dict:
    """Chi tiết + activity của 1 điểm bán thuộc NPP (modal): thông tin, ảnh điểm bán
    + ảnh các lượt trưng bày, danh sách chương trình đã tham gia."""
    customer = require_customer(customer)
    _require_salep()
    p = frappe.db.get_value(
        "Display Point", point,
        ["name", "point_name", "address_line", "phone", "latitude", "longitude",
         "is_active", "store_photo", "distributor", "creation"], as_dict=True)
    if not p or p.get("distributor") != customer:
        frappe.throw(_("Không tìm thấy điểm bán"))
    pg = {r["name"]: r["program_name"] for r in frappe.get_all("Promotion Program", fields=["name", "program_name"])}
    parts = frappe.get_all(
        "Display Participation", filters={"display_point": point, "distributor": customer},
        fields=["name", "promotion_program", "workflow_state", "display_photo", "modified"],
        order_by="modified desc")
    activity = [{"name": x["name"], "program": pg.get(x["promotion_program"]) or x["promotion_program"],
                 "workflow_state": x.get("workflow_state"), "display_photo": x.get("display_photo"),
                 "date": str(x["modified"]) if x.get("modified") else None} for x in parts]
    # NHIỀU ảnh: store_photos của điểm + display_photos của từng lượt (gộp 1 truy vấn)
    store_photos = salep_photos("Display Point", point, "store_photos")
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
                  "creation": str(p.get("creation")) if p.get("creation") else None},
        "activity": activity, "images": images, "image_groups": image_groups,
        "stats": {"participations": len(parts),
                  "approved": sum(1 for x in parts if x.get("workflow_state") == APPROVED),
                  "programs": len({x["promotion_program"] for x in parts if x.get("promotion_program")})},
    }


@frappe.whitelist()
def npp_participation_detail(name: str, customer: str | None = None) -> dict:
    """Chi tiết 1 lượt tham gia của NPP: thông tin điểm bán + chương trình + hình ảnh
    trưng bày của lượt đó (cho modal ở tab Chương trình)."""
    customer = require_customer(customer)
    _require_salep()
    p = frappe.db.get_value(
        "Display Participation", name,
        ["name", "display_point", "promotion_program", "distributor", "display_photo",
         "workflow_state", "reject_reason", "latitude", "longitude", "modified"], as_dict=True)
    if not p or p.get("distributor") != customer:
        frappe.throw(_("Không tìm thấy lượt tham gia"))
    pt = frappe.db.get_value("Display Point", p["display_point"],
                             ["point_name", "address_line", "phone", "store_photo", "is_active"], as_dict=True) or {}
    pg = frappe.db.get_value("Promotion Program", p["promotion_program"],
                             ["program_name", "status", "start_date", "end_date"], as_dict=True) or {}
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
        "participation": {**p, "modified": str(p["modified"]) if p.get("modified") else None},
        "point": pt,
        "program": {**pg, "start_date": str(pg.get("start_date")) if pg.get("start_date") else None,
                    "end_date": str(pg.get("end_date")) if pg.get("end_date") else None},
        "image_groups": image_groups,
        "images": flat,
    }


def _gen_password(n: int = 8) -> str:
    """Mật khẩu ngẫu nhiên có cả chữ thường/hoa/số (đủ mạnh cho policy mặc định)."""
    import random
    import string
    pool = string.ascii_lowercase + string.ascii_uppercase + string.digits
    while True:
        pw = "".join(random.choice(pool) for _ in range(n))
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw):
            return pw


@frappe.whitelist(methods=["POST"])
def create_staff(full_name: str, phone: str | None = None, email: str | None = None,
                 cccd: str | None = None, password: str | None = None,
                 customer: str | None = None) -> dict:
    """NPP tạo nhân viên trên ĐỊA BÀN của mình. Đăng nhập = SỐ ĐIỆN THOẠI (User.username)
    + mật khẩu (nhập tay hoặc tự sinh). Tạo User (chỉ role Sales Staff, kích hoạt, đặt
    mật khẩu ngay) + Sales Staff Profile (distributor = NPP). Không gán role khác.
    Trả về username + password để NPP gửi cho nhân viên."""
    customer = require_customer(customer)
    _require_salep()
    full_name = (full_name or "").strip()
    if not full_name:
        frappe.throw(_("Vui lòng nhập họ tên nhân viên."))
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        frappe.throw(_("Vui lòng nhập số điện thoại (dùng làm tên đăng nhập)."))
    email = (email or "").strip().lower() or f"{digits}@nv.local"
    password = (password or "").strip() or _gen_password()

    if frappe.db.exists("User", email):
        frappe.throw(_("Tài khoản (email) đã tồn tại: {0}").format(email))
    if frappe.db.exists("User", {"username": digits}):
        frappe.throw(_("Số điện thoại đã dùng cho tài khoản khác: {0}").format(digits))

    u = frappe.new_doc("User")
    u.email = email
    u.first_name = full_name
    u.username = digits          # ĐĂNG NHẬP bằng số điện thoại
    u.mobile_no = (phone or digits).strip()
    u.enabled = 1
    u.user_type = "Website User"  # CHẶN truy cập Desk (/app) — NV chỉ dùng portal
    u.send_welcome_email = 0
    u.new_password = password    # đặt mật khẩu ngay khi tạo
    u.flags.ignore_permissions = True
    u.insert(ignore_permissions=True)
    # Role NVBH chỉ dùng portal → TẮT desk_access. Nếu không, User.set_system_user()
    # sẽ ép user_type='System User' (vì role có desk_access) và NV vào được Desk.
    if frappe.db.exists("Role", SALES_STAFF_ROLE):
        if frappe.db.get_value("Role", SALES_STAFF_ROLE, "desk_access"):
            frappe.db.set_value("Role", SALES_STAFF_ROLE, "desk_access", 0)
        u.add_roles(SALES_STAFF_ROLE)  # CHỈ role Sales Staff
    frappe.db.set_value("User", email, "user_type", "Website User")  # ép Website User → chặn Desk

    p = frappe.new_doc("Sales Staff Profile")
    p.user = email
    p.full_name = full_name
    p.phone = (phone or digits).strip()
    if (cccd or "").strip():
        p.cccd = cccd.strip()
    p.distributor = customer
    p.insert(ignore_permissions=True)
    return {"name": p.name, "user": email, "username": digits, "password": password}


@frappe.whitelist(methods=["POST"])
def add_self_as_staff(phone: str | None = None, customer: str | None = None) -> dict:
    """NPP TỰ thêm mình làm nhân viên bán hàng: tạo Sales Staff Profile gắn với CHÍNH
    tài khoản đang đăng nhập (KHÔNG tạo user mới, KHÔNG đổi mật khẩu) + gán role
    Sales Staff để vào được portal nhân viên /dp mà tự đi trưng bày.
    `phone` bắt buộc (Sales Staff Profile yêu cầu) — lấy từ tham số, else từ User/Customer."""
    customer = require_customer(customer)
    _require_salep()
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw(_("Vui lòng đăng nhập."), frappe.PermissionError)

    existing = frappe.db.get_value("Sales Staff Profile", {"user": user},
                                   ["name", "distributor"], as_dict=True)
    if existing:
        if existing.get("distributor") != customer:
            frappe.throw(_("Tài khoản của bạn đã là nhân viên của NPP khác."))
        _ensure_sales_staff_role(user)
        return {"name": existing["name"], "already": True}

    u = frappe.db.get_value("User", user, ["full_name", "first_name", "mobile_no", "phone"], as_dict=True) or {}
    full_name = ((u.get("full_name") or u.get("first_name") or "").strip()
                 or frappe.db.get_value("Customer", customer, "customer_name") or user)
    # SĐT bắt buộc: ưu tiên tham số → User.mobile_no/phone → Customer.mobile_no.
    phone = ((phone or "").strip()
             or (u.get("mobile_no") or "").strip()
             or (u.get("phone") or "").strip()
             or (frappe.db.get_value("Customer", customer, "mobile_no") or "").strip())
    if not phone:
        frappe.throw(_("Vui lòng nhập số điện thoại để tạo hồ sơ nhân viên."))

    p = frappe.new_doc("Sales Staff Profile")
    p.user = user
    p.full_name = full_name
    p.phone = phone
    p.distributor = customer
    p.insert(ignore_permissions=True)
    _ensure_sales_staff_role(user)
    return {"name": p.name, "already": False, "full_name": full_name}


def _ensure_sales_staff_role(user: str) -> None:
    """Gán role Sales Staff cho user (để vào /dp). Đảm bảo role desk_access=0 → KHÔNG
    kéo NPP vào Desk; KHÔNG ép user_type nên loại tài khoản hiện tại của NPP giữ nguyên."""
    if not frappe.db.exists("Role", SALES_STAFF_ROLE):
        return
    if frappe.db.get_value("Role", SALES_STAFF_ROLE, "desk_access"):
        frappe.db.set_value("Role", SALES_STAFF_ROLE, "desk_access", 0)
    doc = frappe.get_doc("User", user)
    if SALES_STAFF_ROLE not in {r.role for r in doc.get("roles", [])}:
        doc.flags.ignore_permissions = True
        doc.add_roles(SALES_STAFF_ROLE)


@frappe.whitelist(methods=["POST"])
def set_staff_active(staff: str, active, customer: str | None = None) -> dict:
    """Bật/tắt hoạt động (duyệt) nhân viên — đổi User.enabled. Chỉ NV thuộc địa bàn NPP.
    Kích hoạt NV đã NGHỈ VIỆC → hồ sơ về "Đang làm", xoá left_on/handover_to (điểm bán đã
    bàn giao KHÔNG tự quay về — NPP gán lại nếu cần). Không cho tự tạm dừng chính mình."""
    customer = require_customer(customer)
    _require_salep()
    prof = frappe.db.get_value("Sales Staff Profile", staff, ["name", "user", "distributor"], as_dict=True)
    if not prof or prof.get("distributor") != customer:
        frappe.throw(_("Không có quyền với nhân viên này."), frappe.PermissionError)
    active = 1 if cint(active) else 0
    if not active and prof.get("user") == frappe.session.user:
        frappe.throw(_("Không thể tự tạm dừng tài khoản của mình."))  # tự khoá → mất quyền vào portal
    if not active and prof.get("user") and _is_protected_account(prof["user"]):
        frappe.throw(_("Không thể tạm dừng tài khoản nội bộ hoặc tài khoản nhà phân phối."))
    rehire: dict = {}
    if (active and _staff_has("employment_status")
            and frappe.db.get_value("Sales Staff Profile", staff, "employment_status") == STAFF_LEFT):
        rehire = {"employment_status": STAFF_WORKING}
        rehire.update({f: None for f in ("left_on", "handover_to") if _staff_has(f)})
    buoc = _("cập nhật tài khoản đăng nhập")
    try:
        if prof.get("user"):
            frappe.db.set_value("User", prof["user"], "enabled", active)
        if rehire:
            buoc = _("đưa hồ sơ nhân viên về Đang làm")
            frappe.db.set_value("Sales Staff Profile", staff, rehire)
    except Exception:
        frappe.db.rollback()
        # defer_insert: sau throw Frappe rollback cả request → Error Log ghi ngay sẽ mất theo
        frappe.log_error("npp.promo.set_staff_active", frappe.get_traceback(), defer_insert=True)
        frappe.throw(_("Lỗi khi {0} — đã huỷ toàn bộ thay đổi, vui lòng thử lại.").format(buoc))
    if not active and prof.get("user"):
        _logout_user(prof["user"], "set_staff_active")  # tạm dừng → đăng xuất ngay, không đợi phiên hết hạn
    return {"name": staff, "active": bool(active)}


def _is_internal_user(user) -> bool:
    """Tài khoản nội bộ (Administrator / quản trị / quản lý kênh…) — NPP KHÔNG được khoá dù
    tài khoản đó có hồ sơ NV dưới NPP (ai cũng tự tạo được hồ sơ NV qua /dp)."""
    if not user or user in ("Administrator", "Guest"):
        return True
    return bool(set(frappe.get_roles(user)) & (INTERNAL_ROLES | MANAGER_ROLES))


def _npp_customer_of(user) -> str | None:
    """NPP mà `user` là tài khoản chủ (User.custom_customer → else Portal User của Customer),
    cùng định nghĩa salep npp_customer_of."""
    if not user:
        return None
    customer = frappe.db.get_value("User", user, "custom_customer")
    if customer:
        return customer
    try:
        return frappe.db.get_value("Portal User", {"user": user, "parenttype": "Customer"}, "parent") or None
    except Exception:  # site không có doctype Portal User
        return None


def _is_protected_account(user) -> bool:
    """Tài khoản NPP KHÔNG được khoá / đổi mật khẩu qua hồ sơ NV: nội bộ, hoặc tài khoản chủ
    của MỘT NPP bất kỳ (kể cả NPP khác — hồ sơ cũ còn treo dưới NPP này). Chính mình thì không tính."""
    if user and user == frappe.session.user:
        return False
    return _is_internal_user(user) or bool(_npp_customer_of(user))


def _logout_user(user: str, where: str) -> None:
    """Đăng xuất mọi phiên của user vừa bị khoá: db.set_value("User", …, "enabled", 0) KHÔNG chạy
    User.validate nên phiên đang mở vẫn dùng được tới khi hết hạn (giống salep offboard_staff).
    Gọi SAU khi ghi xong — delete_session commit giữa request (endpoint gọi hàm này phải POST-only).
    Lỗi ở đây không huỷ thao tác đã ghi."""
    try:
        from frappe.sessions import clear_sessions

        clear_sessions(user=user, force=True)
    except Exception:
        frappe.log_error(f"npp.promo.{where}: clear_sessions", frappe.get_traceback())


def _own_staff(staff, customer):
    """Trả hồ sơ NV nếu thuộc địa bàn NPP, else throw."""
    prof = frappe.db.get_value("Sales Staff Profile", staff, ["name", "user", "distributor"], as_dict=True)
    if not prof or prof.get("distributor") != customer:
        frappe.throw(_("Không có quyền với nhân viên này."), frappe.PermissionError)
    return prof


@frappe.whitelist(methods=["POST"])
def update_staff(staff: str, full_name: str | None = None, phone: str | None = None,
                 cccd: str | None = None, customer: str | None = None) -> dict:
    """Sửa thông tin NV (tên/SĐT/CCCD). Đổi SĐT → đổi luôn tên đăng nhập (username)."""
    customer = require_customer(customer)
    _require_salep()
    prof = _own_staff(staff, customer)

    p = frappe.get_doc("Sales Staff Profile", staff)
    if full_name and full_name.strip():
        p.full_name = full_name.strip()
    new_digits = None
    if phone is not None:
        new_digits = re.sub(r"\D", "", phone)
        if not new_digits:
            frappe.throw(_("Số điện thoại không hợp lệ."))
        p.phone = phone.strip()
    if cccd is not None:
        p.cccd = (cccd or "").strip() or None
    p.flags.ignore_permissions = True
    p.save(ignore_permissions=True)

    if prof.get("user"):
        u = frappe.get_doc("User", prof["user"])
        if full_name and full_name.strip():
            u.first_name = full_name.strip()
        if new_digits:
            u.mobile_no = phone.strip()
            if new_digits != (u.username or ""):
                if frappe.db.exists("User", {"username": new_digits, "name": ["!=", u.name]}):
                    frappe.throw(_("Số điện thoại đã dùng cho tài khoản khác: {0}").format(new_digits))
                u.username = new_digits
        u.flags.ignore_permissions = True
        u.save(ignore_permissions=True)
    return {"name": staff, "username": new_digits or None}


@frappe.whitelist(methods=["POST"])
def reset_staff_password(staff: str, password: str | None = None, customer: str | None = None) -> dict:
    """Cấp lại mật khẩu cho NV (nhập tay hoặc tự sinh). Trả username + password để gửi NV."""
    customer = require_customer(customer)
    _require_salep()
    prof = _own_staff(staff, customer)
    if not prof.get("user"):
        frappe.throw(_("Nhân viên chưa có tài khoản đăng nhập."))
    if _is_protected_account(prof["user"]):
        frappe.throw(_("Không thể đổi mật khẩu tài khoản nội bộ hoặc tài khoản nhà phân phối."),
                     frappe.PermissionError)
    password = (password or "").strip() or _gen_password()
    u = frappe.get_doc("User", prof["user"])
    u.new_password = password
    u.flags.ignore_permissions = True
    u.save(ignore_permissions=True)
    return {"name": staff, "username": u.username or u.name, "password": password}


@frappe.whitelist(methods=["POST"])
def delete_staff(staff: str, customer: str | None = None) -> dict:
    """Xoá hồ sơ nhân viên khỏi địa bàn NPP + VÔ HIỆU HOÁ tài khoản đăng nhập + đăng xuất mọi phiên
    (không hard-delete User để giữ lịch sử tham gia do user đó tạo; tài khoản NPP thì không khoá).
    Chặn khi NV còn phụ trách điểm bán → dùng Nghỉ việc (offboard_staff) để bàn giao trước,
    tránh điểm bán "mồ côi" (owner không còn hồ sơ NV). Hồ sơ của TÀI KHOẢN NPP không bị chặn:
    điểm của tài khoản NPP luôn là "NPP giữ" (§1) dù có hồ sơ hay không → không mồ côi."""
    customer = require_customer(customer)
    _require_salep()
    prof = _own_staff(staff, customer)
    user = prof.get("user")
    npp = _npp_users(customer) if user else set()
    if user and user not in npp:
        n = frappe.db.count("Display Point", {"distributor": customer, "owner": user})
        if n:
            frappe.throw(_("Nhân viên còn {0} điểm bán — dùng Nghỉ việc để bàn giao trước khi xoá.").format(n))
    # Nhật ký bàn giao (from_staff/to_staff link tới hồ sơ) là LỊCH SỬ, vẫn giữ from_user/to_user → không
    # để nó chặn xoá (NV đã Nghỉ việc luôn có log). Chỉ bỏ kiểm link khi hồ sơ có trong nhật ký.
    in_log = frappe.db.table_exists(TRANSFER_DOCTYPE) and any(
        frappe.db.exists(TRANSFER_DOCTYPE, {f: staff}) for f in ("from_staff", "to_staff"))
    # Không khoá tài khoản chủ NPP (NPP này hay NPP khác) và tài khoản nội bộ — cùng luật nghỉ việc
    # (salep doc/08 §3.6)
    lock = bool(user) and not _is_internal_user(user) and not _npp_customer_of(user)
    buoc = _("xoá hồ sơ nhân viên")
    try:
        frappe.delete_doc("Sales Staff Profile", staff, ignore_permissions=True, force=bool(in_log))
        if lock and frappe.db.exists("User", user):
            buoc = _("khoá tài khoản đăng nhập")
            frappe.db.set_value("User", user, "enabled", 0)
    except frappe.LinkExistsError:
        raise  # hồ sơ còn được bản ghi khác tham chiếu → giữ thông báo của Frappe
    except Exception:
        frappe.db.rollback()
        frappe.log_error("npp.promo.delete_staff", frappe.get_traceback(), defer_insert=True)
        frappe.throw(_("Lỗi khi {0} — đã huỷ toàn bộ thay đổi, vui lòng thử lại.").format(buoc))
    if lock:
        _logout_user(user, "delete_staff")
    return {"name": staff}


def _own_point(point, customer):
    owner = frappe.db.get_value("Display Point", point, "distributor")
    if owner != customer:
        frappe.throw(_("Không có quyền với điểm bán này."), frappe.PermissionError)


@frappe.whitelist(methods=["POST"])
def update_point(point: str, point_name: str | None = None, address_line: str | None = None,
                 phone: str | None = None, is_active=None, customer: str | None = None) -> dict:
    """Sửa thông tin điểm bán (tên/địa chỉ/SĐT/hoạt động) — chỉ điểm bán của NPP."""
    customer = require_customer(customer)
    _require_salep()
    _own_point(point, customer)
    p = frappe.get_doc("Display Point", point)
    if point_name and point_name.strip():
        p.point_name = point_name.strip()
    if address_line is not None:
        p.address_line = address_line.strip() or None
    if phone is not None:
        p.phone = phone.strip() or None
    if is_active is not None:
        p.is_active = 1 if cint(is_active) else 0
    p.flags.ignore_permissions = True
    p.save(ignore_permissions=True)
    return {"name": point}


@frappe.whitelist(methods=["POST"])
def delete_point(point: str, customer: str | None = None) -> dict:
    """Xoá điểm bán — chặn nếu đã có lượt tham gia (gợi ý ngừng hoạt động thay vì xoá)."""
    customer = require_customer(customer)
    _require_salep()
    _own_point(point, customer)
    if frappe.db.exists("Display Participation", {"display_point": point}):
        frappe.throw(_("Không thể xoá: điểm bán đã có lượt tham gia. Hãy chuyển 'Ngừng hoạt động' thay vì xoá."))
    frappe.delete_doc("Display Point", point, ignore_permissions=True)
    return {"name": point}


# Gán NV phụ trách / nghỉ việc / lịch sử NV: chỉ xác định NPP (require_customer) rồi gọi
# hàm lõi salep.api.npp_manage (đã kiểm phạm vi distributor + kiểm trước/ghi sau ở đó).
# Endpoint GHI chỉ nhận POST (khớp salep npp_*): GET không kiểm CSRF, và offboard_staff xoá phiên
# NV (delete_session commit giữa request) → 1 link GET lạ có thể cho NV nghỉ việc thật.

@frappe.whitelist()
def staff_history(staff: str, customer: str | None = None) -> dict:
    """Lịch sử hoạt động 1 NV của NPP: hồ sơ + KPI, điểm đang phụ trách, lượt tham gia,
    nhật ký bàn giao điểm (vào/ra). NV không thuộc NPP → PermissionError (hàm lõi kiểm)."""
    customer = require_customer(customer)
    _require_salep()
    return _npp_manage().staff_history(distributor=customer, staff=staff)


@frappe.whitelist(methods=["POST"])
def assign_points(points, target: str, note: str | None = None, customer: str | None = None) -> dict:
    """Gán NV phụ trách cho NHIỀU điểm bán của NPP: đổi Display Point.owner + chuyển các lượt
    của chương trình CÒN HIỆU LỰC sang người mới (lượt chương trình đã kết thúc giữ nguyên).
    `points` = list tên điểm hoặc chuỗi JSON; `target` = tên Sales Staff Profile (đang làm)
    hoặc "__npp__" (NPP giữ lại). Trả {moved, skipped, participations, target}."""
    customer = require_customer(customer)
    _require_salep()
    return _npp_manage().assign_points(distributor=customer, points=points, target=target, note=note)


@frappe.whitelist(methods=["POST"])
def set_points_active(points, active, customer: str | None = None) -> dict:
    """Ngừng hoạt động / kích hoạt NHIỀU điểm bán của NPP (Display Point.is_active).
    `points` = list tên điểm hoặc chuỗi JSON; `active` = 0/1. Trả {updated}."""
    customer = require_customer(customer)
    _require_salep()
    return _npp_manage().set_points_active(distributor=customer, points=points, active=active)


@frappe.whitelist(methods=["POST"])
def offboard_staff(staff: str, target: str | None = None, note: str | None = None,
                   customer: str | None = None) -> dict:
    """Cho NV NGHỈ VIỆC: bàn giao mọi điểm (+ lượt còn hiệu lực) cho `target` (mặc định NPP giữ
    "__npp__", hoặc NV đang làm khác), hồ sơ → "Nghỉ việc" + ngày nghỉ + người nhận bàn giao,
    khoá tài khoản (trừ tài khoản NPP). Chạy lại trên NV đã nghỉ = quét phần còn sót.
    Trả {staff, points, participations, target, disabled}."""
    customer = require_customer(customer)
    _require_salep()
    core = _npp_manage()
    return core.offboard_staff(distributor=customer, staff=staff, target=target or core.TARGET_NPP, note=note)


# Trả thưởng điểm bán 2 lần (salep doc/09): xác định NPP (require_customer) + kiểm lượt thuộc NPP
# (`_own_participation`, TRƯỚC khi gọi lõi — hàm lõi không tự kiểm phạm vi) rồi gọi `salep.api.payout`
# (luật R1–R7, kiểm trước/ghi sau, rollback + log ở đó). Endpoint GHI chỉ nhận POST.

@frappe.whitelist()
def payout_progress(program: str | None = None, customer: str | None = None) -> dict:
    """Tiến độ trả thưởng (Lần 1 / Lần 2) các lượt ĐÃ DUYỆT của NPP, lọc 1 chương trình nếu có.
    Trả {totals{eligible, paid_1, paid_2}, programs[], rows[]} (shape doc/09 §3.3)."""
    customer = require_customer(customer)
    _require_salep()
    return _payout().progress(distributor=customer, program=program or None)


@frappe.whitelist()
def participation_payouts(name: str, customer: str | None = None) -> dict:
    """2 lần trả thưởng của 1 lượt thuộc NPP: {participation, eligible, reward_per_point, rounds[2]}.
    Lượt của NPP khác → PermissionError."""
    customer = require_customer(customer)
    _require_salep()
    name = _own_participation(name, customer)
    return _payout().participation_payouts(participation=name)


@frappe.whitelist(methods=["POST"])
def record_payout(participation: str, payout_round, payout_date: str, photos,
                  note: str | None = None, customer: str | None = None) -> dict:
    """Ghi (hoặc cập nhật nếu đã có) trả thưởng lần `payout_round` (1|2) cho 1 lượt ĐÃ DUYỆT của NPP:
    ngày trả (≤ hôm nay), ≥1 ảnh đã upload lên site (`photos` = list hoặc chuỗi JSON), ghi chú.
    Lần 2 cần đã có Lần 1. Lượt của NPP khác → PermissionError, không ghi gì."""
    customer = require_customer(customer)
    _require_salep()
    participation = _own_participation(participation, customer)
    return _payout().record_payout(participation=participation, payout_round=payout_round,
                                   payout_date=payout_date, photos=photos, note=note)


@frappe.whitelist(methods=["POST"])
def delete_payout(participation: str, payout_round, customer: str | None = None) -> dict:
    """Xoá trả thưởng lần `payout_round` của 1 lượt thuộc NPP (không xoá Lần 1 khi đã có Lần 2).
    Lượt của NPP khác → PermissionError, không xoá gì."""
    customer = require_customer(customer)
    _require_salep()
    participation = _own_participation(participation, customer)
    return _payout().delete_payout(participation=participation, payout_round=payout_round)
