---
name: frappe-portal-spa
description: Use when building or maintaining a customer-facing single-page-app (SPA) portal served from a Frappe/ERPNext v16 www page — a mobile-first vanilla-JS app (no bundler) with hash routing, code-split ES modules, lazy Chart.js, that runs INSIDE ERPNext's asset pipeline. Triggers include "portal cho NPP/khách hàng", "www page SPA", "trang self-service", "hash router", "code-split view", "ES module trên Frappe", "asset cache sau deploy", "does not provide an export named", "import map", "/assets bị cache 1 năm", "CSS đè Bootstrap ERPNext". Cũng dùng cho phong cách/giao diện portal — "phong cách thiết kế", "design system", "design token", "reskin/đổi theme portal", "season/đổi mùa", "component CSS", "mobile-first", "glassmorphism", "áp dụng giao diện cho portal khác" (xem references/design-system.md). Do NOT use for Frappe Desk client scripts / form scripts (use nextcode-build), for backend analytics methods (use frappe-sales-analytics), or for generic install/fixtures issues (use nextcode-build). This skill is about the browser-side portal architecture and its asset/cache/deploy discipline.
---

# Frappe Portal SPA — kiến trúc & kỷ luật asset

Skill này gói lại kinh nghiệm dựng **portal SPA self-service** chạy trên Frappe
www page (ví dụ NPP Portal tại `/npp`): vanilla JS, **không build step**, hash
router, view code-split, Chart.js lazy-load, nhúng trong ERPNext.

Term giữ nguyên tiếng Anh (www page, ES module, import map, hash router, asset).

## Khi nào dùng

Dựng/maintain phần **trình duyệt** của một portal khách hàng trên Frappe. KHÔNG
dùng cho Desk form script, cho method backend (xem `frappe-sales-analytics`),
hay cho fixtures/install (xem `nextcode-build`).

## ⚠️ LUẬT VÀNG #1 — ES static import KHÔNG kế thừa `?v=` → phải có import map

Đây là cạm bẫy đắt giá nhất. Frappe serve `/assets` với
`Cache-Control: immutable, max-age=31536000` (1 năm). Ta cache-bust file vào
trang bằng `?v={{now}}`, **nhưng**: khi `views/x.js?v=ABC` chạy
`import { f } from '../lib/format.js'`, trình duyệt resolve relative path **bỏ
query** → tải `/lib/format.js` (không `?v=`) → **trúng bản cache cũ** → lỗi
runtime kinh điển:

```
The requested module '../lib/format.js' does not provide an export named 'formatVNDShort'
```

(Không phải lỗi code — file MỚI có export đó, nhưng trình duyệt chạy file CŨ.)

**Cách sửa đúng (vĩnh viễn): `<script type="importmap">` trong www page** remap
mọi shared module sang URL có `?v=`. Không cần sửa file JS nào. Đặt TRƯỚC mọi
`<script type="module">` (tức trong `head_include`):

```html
{% set v = (frappe.utils.now() | replace(" ", "T") | replace(":", "-")) %}
<script type="importmap">
{ "imports": {
  "/assets/app/app/lib/format.js": "/assets/app/app/lib/format.js?v={{ v }}",
  "/assets/app/app/lib/api.js":    "/assets/app/app/lib/api.js?v={{ v }}",
  ...mọi file trong lib/ + components/ + shared khác...
}}
</script>
```

Import map khớp theo **URL đã resolve** (path tuyệt đối, không query) → ánh xạ
sang bản có `?v=`. View modules thì vẫn cache-bust riêng qua `assetVersion`
(xem dưới); KHÔNG cho view vào import map (chúng đã mang `?v=` khi dynamic import).
Chi tiết + cách liệt kê module: `references/cache-busting.md`.

## Phong cách thiết kế (design system)

Toàn bộ **ngôn ngữ thị giác + tương tác** (design token, hệ thống mùa, typography,
layout shell, catalog ~24 component kèm CSS copy-paste, motion, responsive, port
sang portal khác bằng 1 lệnh `sed`) gói trong **một file tự chứa**:
`references/design-system.md`. Dùng khi dựng giao diện portal mới hoặc thêm
component để giữ đúng phong cách (mobile-first, glass + nền mùa, card bo tròn,
1 accent màu mùa, badge ngữ nghĩa). Quy tắc nền tảng: **prefix mọi class**, class
mùa trên `.app` (không `body`), banner ép `color !important`, tải→skeleton /
chặn→loading / kết quả→toast.

## Kiến trúc 1 phút

```
www/<page>.py    → get_context: bơm user, customer, isManager, assetVersion, csrf
www/<page>.html  → extends templates/web.html; head_include {importmap + NPP_CONTEXT};
                   page_content {#app shell + <script type="module" src=shell.js?v=now>}
public/<app>/
  shell.js       → hash router, VIEW_MODULES (route→dynamic import), header/nav, manager gate
  lib/           → api.js (wrap frappe.call), router.js (hash + query), store.js, dom.js (html``), format.js
  components/    → banner, toast, modal, bottom-nav, ... (UI tái dùng)
  views/         → 1 file/route, export async render({container, query, params})
  shell.css      → MỌI class prefix `app-` để không đè Bootstrap của ERPNext
```

- **Context bridge:** `window.NPP_CONTEXT = { user, customer, isManager, assetVersion, csrfToken, baseUrl }` render server-side. SPA đọc global này, không gọi thêm API để biết mình là ai.
- **Cache-bust view động:** `assetVersion = now()` (đã làm sạch ký tự). `withV(p) = ?v=assetVersion`. Mọi `import(withV('./views/x.js'))` đổi mỗi full load.
- **Cache-bust shell + css:** `shell.js?v={{now}}`, `shell.css?v={{now}}` ngay trong HTML attribute.
- **Router:** hash-based, hỗ trợ `:param` và `?query`. Đổi `#/x?c=Y` re-render; trong-view đổi lựa chọn thì `history.replaceState` để sync URL mà KHÔNG re-render.
- **Chart.js:** lazy-load từ CDN 1 lần (`loadChartLib()`), destroy chart cũ trước khi vẽ lại để tránh leak.
- **Phân quyền hiển thị:** nút/route quản lý chỉ render khi `NPP_CONTEXT.isManager`; **quyền thật do server kiểm** (mọi method có guard) — UI gate chỉ là tiện dụng.

## Quy ước bắt buộc

1. **CSS prefix** (`app-…`) toàn bộ — ERPNext web template kéo theo Bootstrap; class trần (`.card`, `.btn`, `.table`) sẽ bị đè. Banner/nội dung kế thừa màu chữ tối của web.html → đôi khi cần selector cụ thể + `!important`.
2. **`escapeHtml` mọi dữ liệu người dùng** chèn vào `innerHTML` (có sẵn trong format.js).
3. **1 view = 1 file**, export `render({container})`; tự dọn (destroy chart) khi vẽ lại.
4. **Tiền tệ:** format tập trung (`formatNumber` dùng `Math.round` + `maximumFractionDigits:0`; `formatVNDShort` cho thẻ lớn "1,6 tỷ"/"33 tr").
5. **Thêm shared module mới → THÊM vào import map** trong www page, nếu không nó sẽ bị cache cũ sau lần sửa kế tiếp.

## Deploy portal (thứ tự + lý do)

```bash
bench --site <site> migrate     # nếu có custom field / schema mới
bench build --app <app>         # đẩy JS/CSS mới ra /assets (file mới + nội dung mới)
bench restart                   # nạp lại Python (www context + whitelisted method)
# rồi refresh trình duyệt: www page render fresh → import map trỏ bản ?v= mới
```

Với import map đặt đúng, **refresh thường là đủ** — không cần hard-refresh. Nếu
CHƯA có import map, mỗi lần đổi `lib/*`/`components/*` phải hard-refresh (Ctrl+Shift+R).

## Checklist review nhanh

- [ ] Mọi shared module (lib + components + config dùng chung) có trong import map?
- [ ] Import map đặt trước `<script type="module">`? (trong `head_include`)
- [ ] View động dùng `withV()` (mang `assetVersion`)?
- [ ] CSS đã prefix? Banner/text tương phản nền (không "lẫn vào nền")?
- [ ] Mỗi view destroy chart cũ trước khi vẽ lại?
- [ ] Dữ liệu render qua `escapeHtml`?
- [ ] Quyền thật kiểm ở server, không chỉ ẩn nút ở client?
