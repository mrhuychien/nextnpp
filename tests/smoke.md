# NPP Portal — Smoke test

Chạy lần đầu sau khi install hoặc deploy.

## Pre-conditions
- 1 user thường (không phải System Manager) có `User.customer` link tới 1 Customer
- Customer đó có ít nhất 2 Sales Invoice ở các trạng thái: Draft, Submitted (paid), Submitted (overdue)
- Pricing List "TỈNH" tồn tại
- Ít nhất 1 Pricing Rule active cho customer đó
- Item Group đã có "Hàng truyền thống", "Hàng Tết"
- App `npp` đã install → 12 custom field tự tạo

## Custom fields installed
- [ ] `bench --site <site> mariadb` → `DESCRIBE \`tabSales Invoice\` LIKE 'custom_%'` → thấy đủ 8 field + 2 break
- [ ] `DESCRIBE \`tabItem\` LIKE 'custom_%'` → thấy `custom_quy_cách`, `custom_thể_tích`
- [ ] Mở `/app/sales-invoice/new` → scroll xuống → thấy section "Thông tin giao hàng NPP" collapsible với 8 field
- [ ] Trong section, layout 2 cột: trái (Hình thức / Chuyến xe / Xe), phải (Tên LX / SĐT / Trạng thái)
- [ ] Field "Trạng thái vận chuyển" có default "Chờ xử lý"
- [ ] Mở `/app/item/<any>` → thấy Quy cách + Thể tích sau Stock UOM
- [ ] Filter Sales Invoice list theo "Trạng thái vận chuyển" → hoạt động (in_standard_filter)

## Login
- [ ] Vào `/npp` với Guest → redirect sang `/login?redirect-to=/npp`
- [ ] Login → redirect lại `/npp` → thấy header

## Dashboard `/`
- [ ] Banner hiện tên NPP
- [ ] 4 card hiện đủ: công nợ, đơn, KM, doanh số tháng
- [ ] Card "Đơn hàng" hiện đúng số: X nháp · Y đang giao
  (Y = số đơn có `custom_trạng_thái_vận_chuyển` ∈ {"Chờ xử lý", "Đang giao"})
- [ ] Click card công nợ → navigate sang `/cong-no`
- [ ] CTA "Đặt đơn hàng mới" → `/dat-hang`

## Đặt hàng `/dat-hang`
- [ ] Tab "Truyền Thống" và "Hàng Tết" chuyển được
- [ ] Search lọc đúng sản phẩm
- [ ] Tăng/giảm SL, summary bottom hiện đúng tổng
- [ ] "Lên đơn hàng" → modal review hiện textarea "Ghi chú"
- [ ] Nhập ghi chú "Test giao trước 9h" → Confirm
- [ ] Tạo Sales Invoice draft thành công, navigate `/don-hang/<name>`
- [ ] Mở backend `/app/sales-invoice/<name>`:
      - Field `company` = "Công ty cổ phần Hoàng Giang"
      - `custom_ghi_chú_npp` = "Test giao trước 9h"
      - `custom_trạng_thái_vận_chuyển` = "Chờ xử lý"

## Đơn hàng `/don-hang`
- [ ] Filter status, from-date, to-date hoạt động (URL param đổi đúng)
- [ ] List view: badge ưu tiên hiển thị `custom_trạng_thái_vận_chuyển` thay vì docstatus
      - Đơn Draft → badge "📝 Nháp" (vàng)
      - Đơn có status "Đang giao" → badge "🚚 Đang giao" (xanh dương)
      - Đơn có `custom_chuyến_xe` → hiện thêm icon truck + mã chuyến
- [ ] Click 1 đơn → navigate `/don-hang/:name`
- [ ] Detail hiện items, totals
- [ ] Section "Vận chuyển" chỉ hiện khi có ít nhất 1 field shipping
- [ ] Trong section vận chuyển, badge status đúng (icon + màu theo DELIVERY_STATUS_LABELS)
- [ ] SĐT lái xe là link `tel:`
- [ ] Section "Ghi chú" hiện cả note NPP và note nội bộ (nếu có)
- [ ] Đơn Draft: nút "Xóa" hoạt động
- [ ] Đơn Submitted: chỉ xem, không có nút xóa

## Công nợ `/cong-no`
- [ ] Tổng nợ + số HĐ chưa trả khớp với data DB
- [ ] Aging 4 buckets có thanh trực quan
- [ ] List HĐ quá hạn (nếu có) hoặc empty state

## Khuyến mãi `/khuyen-mai`
- [ ] Hiện list pricing rules đang active
- [ ] Rule sắp hết hạn (≤7 ngày) có badge màu vàng

## Khuyến mại → NV phụ trách điểm bán / Nghỉ việc `/khuyen-mai`
Tham chiếu: `salep/doc/08_npp_staff_assignment.md`. Cần cả 2 app đã `bench migrate` + `bench build` + `bench restart`.

Pre-conditions:
- NPP có ≥2 NV (Sales Staff Profile, `employment_status` = "Đang làm"), ≥5 điểm bán, ≥1 chương trình
  "Đang chạy" và ≥1 chương trình "Kết thúc" — mỗi chương trình có lượt tham gia trên điểm của NV A
- Có ≥1 điểm do chính tài khoản NPP tạo (owner = user NPP, NPP không có hồ sơ NV) → "NPP giữ"

Nhân viên:
- [ ] Lọc trạng thái Đang làm / Đã nghỉ / Tất cả + ô tìm hoạt động; cột "Điểm bán" = số điểm NV phụ trách
- [ ] Badge Hoạt động / Tạm dừng / Đã nghỉ đúng trạng thái; NV đã nghỉ nằm cuối danh sách
- [ ] Bấm NV → modal có KPI + nút Sửa / Đổi MK / Tạm dừng-Kích hoạt / 🔁 Chuyển điểm / 🚪 Nghỉ việc / Xoá
- [ ] "Lịch sử hoạt động": pill Điểm bán / Tham gia / Bàn giao tải từ `staff_history`; drill sang điểm bán có "← Quay lại"
- [ ] Chọn nhiều điểm trong lịch sử → "Chuyển N điểm" → modal Gán NV
- [ ] Xoá NV còn điểm bán → báo "Nhân viên còn N điểm bán — dùng Nghỉ việc để bàn giao trước khi xoá."; không xoá gì
- [ ] Xoá NV đã Nghỉ việc (0 điểm, đã có dòng `Display Point Transfer`) → xoá được; nhật ký bàn giao vẫn còn
- [ ] NPP tự thêm mình làm NV: "Tạm dừng" chính mình → báo "Không thể tự tạm dừng tài khoản của mình.";
      🔁 Chuyển điểm trên hồ sơ của mình → modal Gán đủ N điểm (= KPI "Điểm bán phụ trách");
      Xoá hồ sơ NV của chính mình (kể cả còn điểm "NPP giữ") → hồ sơ mất, điểm vẫn "NPP giữ",
      tài khoản NPP KHÔNG bị khoá
- [ ] Tạm dừng / Xoá NV đang đăng nhập /dp trên điện thoại → NV bị đăng xuất ngay (bấm gì cũng về trang đăng nhập)
- [ ] Sau "Nghỉ việc → Về NPP" (NPP không có hồ sơ NV): email tài khoản NPP KHÔNG xuất hiện như 1 nhân viên;
      KPI "Nhân viên" (Báo cáo) = số dòng tab Nhân viên
- [ ] Lỗi từ server (VD gán cho NV vừa bị tạm dừng) → toast đúng câu tiếng Việt, KHÔNG "Lỗi: API error";
      nút "⏳ Đang …" luôn trở lại (kể cả 403/500)
- [ ] Sau mỗi thao tác vẫn ở tab đang mở (không nhảy về Nhân viên)

Điểm bán:
- [ ] Cột "Phụ trách": tên NV / "NPP (chưa giao)" / tên user khác; NV đã nghỉ có dấu hiệu "đã nghỉ"
- [ ] Thẻ "N điểm NPP đang giữ — chia cho NV" khớp `totals.unassigned_points`
- [ ] Lọc tìm không dấu ("diem ban" khớp "Điểm bán"), Phụ trách (Tất cả / NPP giữ / từng NV / Khác),
      Trạng thái, Tham gia; "Xoá lọc" chỉ hiện khi đang lọc; phân trang 20 dòng
- [ ] Checkbox từng dòng + chọn tất cả (theo bộ lọc) → thanh cố định đáy "Đã chọn N" · Gán NV phụ trách ·
      Ngừng HĐ · Kích hoạt · Bỏ chọn
- [ ] Gán 3 điểm của NV A cho NV B → toast số điểm/lượt đã chuyển; kiểm tra backend:
      - `Display Point.owner` = user NV B
      - Lượt của chương trình "Đang chạy" (end_date rỗng hoặc ≥ hôm nay) → owner = NV B
      - Lượt của chương trình "Kết thúc" / quá end_date → VẪN là NV A
      - Có 1 dòng `Display Point Transfer` mỗi điểm thay đổi (reason "Gán lại")
- [ ] Gán lại đúng NV đang phụ trách → điểm tính "bỏ qua" (skipped), không ghi Transfer (trừ khi có lượt lạc chủ)
- [ ] Ngừng HĐ / Kích hoạt hàng loạt → `is_active` đổi đúng các điểm đã chọn

Chương trình:
- [ ] Danh sách lượt có cột "Phụ trách"; lọc Chương trình / Phụ trách / Trạng thái / tìm (cả SĐT điểm bán)
- [ ] NPP > 2000 lượt, "Tất cả chương trình" → ghi chú "Đang hiện 2.000 lượt cập nhật gần nhất — chọn 1 chương trình…"
- [ ] Checkbox + "Gán NV phụ trách điểm bán" → điểm trùng chỉ tính 1 lần

Nghỉ việc:
- [ ] Modal Nghỉ việc hiện số điểm/lượt sẽ bàn giao, đích mặc định "Về NPP", cảnh báo khoá tài khoản
- [ ] Xác nhận → hồ sơ `employment_status` = "Nghỉ việc", `left_on` = hôm nay, `handover_to` = user nhận;
      `User.enabled` = 0; mọi điểm của NV → NPP giữ; chuyển sang tab Điểm bán lọc "NPP giữ"
- [ ] Không chọn được NV đã nghỉ làm đích gán; tự cho mình nghỉ việc → báo lỗi
- [ ] Kích hoạt lại NV đã nghỉ → hồ sơ về "Đang làm", xoá `left_on`/`handover_to`; điểm KHÔNG tự quay về
- [ ] Site có app `salep` cũ (chưa có `salep.api.npp_manage`) → bấm Gán / Nghỉ việc / Lịch sử báo
      "Cần cập nhật app salep (bench migrate) để dùng chức năng này."; tab Khuyến mại vẫn tải bình thường

## Thống kê `/thong-ke`
- [ ] Chart 1: Line chart doanh số 12 tháng render
- [ ] Chart 2: Donut chart tỉ trọng item_group ("Hàng truyền thống" / "Hàng Tết")
- [ ] Chart 3: Bar chart top 10 SP tháng này
- [ ] Trục Y format VNĐ đúng
- [ ] Tooltip donut hiện format VNĐ

## URL legacy
- [ ] `/dat-hang` → 301 → `/npp#/dat-hang`
- [ ] `/don-hang` → 301 → `/npp#/don-hang`
- [ ] `/cap-nhat-hoa-don/<name>/edit` → 301 → `/npp#/don-hang/<name>?edit=1`

## Mobile
- [ ] Test Chrome DevTools mobile view 375×667
- [ ] Bottom nav fix dưới, không che CTA "Lên đơn"
- [ ] Table fallback thành card list <768px
- [ ] Modal trượt từ dưới lên (mobile sheet pattern)

## Season picker
- [ ] Click 🌸 trên header → modal hiện 4 lựa chọn
- [ ] Chọn → màu palette đổi ngay, lưu localStorage
- [ ] Refresh → giữ season đã chọn

## API smoke (Console F12 trên /npp)
```javascript
frappe.call('npp.api.dashboard.summary').then(console.log)
// Kỳ vọng: object với 8 keys: outstanding_total, overdue_count,
// draft_count, shipping_count, month_count, month_revenue, month_qty,
// promo_count

frappe.call('npp.api.outstanding.aging').then(console.log)
// Kỳ vọng: { '0_30': N, '31_60': N, '61_90': N, 'over_90': N }

frappe.call('npp.api.analytics.sales_by_item_group', { months: 12 }).then(console.log)
// Kỳ vọng: array of { item_group, qty, amount }
//   Có ít nhất 'Hàng truyền thống' và/hoặc 'Hàng Tết' nếu NPP từng mua

frappe.call('npp.api.analytics.top_items', { months: 1, item_group: 'Hàng Tết' }).then(console.log)
// Kỳ vọng: top 10 SP của riêng nhóm Tết

frappe.call('npp.api.promo.npp_overview').then(r => console.log(r.message.totals, r.message.points[0], r.message.staff[0]))
// Kỳ vọng: totals có thêm unassigned_points, staff_left;
//   points[i] có owner, owner_kind ('staff'|'npp'|'other'), staff, staff_name, staff_left, participations, approved;
//   staff[i] có points, employment_status ('Đang làm'|'Nghỉ việc'), resigned, left_on

frappe.call('npp.api.promo.npp_participations').then(r => console.log(r.message[0]))
// Kỳ vọng: mỗi dòng có point_phone, staff, staff_name, staff_left, owner_kind, program_active (tối đa 2000 dòng)

frappe.call('npp.api.promo.staff_history', { staff: 'NV-00001' }).then(console.log)
// Kỳ vọng: { staff, stats, points[], participations[], transfers[] }; NV của NPP khác → PermissionError

frappe.call('npp.api.promo.assign_points', { points: JSON.stringify(['<point>']), target: '__npp__', note: 'smoke' }).then(console.log)
// Kỳ vọng: { moved, skipped, participations, target: { user, staff, label, kind } }; điểm NPP khác → lỗi, không ghi gì

frappe.call('npp.api.promo.set_points_active', { points: JSON.stringify(['<point>']), active: 0 }).then(console.log)
// Kỳ vọng: { updated: 1 }

frappe.call('npp.api.promo.offboard_staff', { staff: 'NV-00001' }).then(console.log)
// Kỳ vọng: { staff, points, participations, target, disabled: true }; chạy lại → points 0 (idempotent)

frappe.call('npp.api.promo.delete_staff', { staff: '<NV còn điểm>' }).catch(console.log)
// Kỳ vọng: lỗi "Nhân viên còn N điểm bán — dùng Nghỉ việc để bàn giao trước khi xoá."

fetch('/api/method/npp.api.promo.offboard_staff?staff=NV-00001').then(r => console.log(r.status))
// Kỳ vọng: 403 (endpoint GHI chỉ nhận POST) — NV KHÔNG bị nghỉ việc / khoá
```
