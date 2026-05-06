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
```
