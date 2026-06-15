# Asset cache-busting trên Frappe www-page SPA — deep dive

## Vấn đề gốc

Frappe serve `/assets/...` với header `Cache-Control: public, max-age=31536000,
immutable`. "immutable" nghĩa là trình duyệt **không revalidate trong 1 năm** —
kể cả bạn `bench build` ra file mới, client vẫn chạy file cũ cho tới khi URL đổi.

Cách chuẩn để bust: thêm query đổi theo lần load, ví dụ `shell.js?v={{now}}`.
Trong HTML attribute điều này hoạt động vì trình duyệt coi URL có query là URL khác.

## Cái bẫy: ES static import bỏ query khi resolve relative

Khi `shell.js?v=ABC` (hoặc `views/x.js?v=ABC`) chứa:

```js
import { f } from './lib/format.js';   // hoặc '../lib/format.js'
```

trình duyệt resolve `./lib/format.js` **tương đối với path của module cha, BỎ phần
query** (theo RFC 3986: relative ref có path riêng → drop query của base). Kết quả
là `/assets/app/app/lib/format.js` **không** `?v=` → trúng cache immutable cũ.

Hệ quả: deploy xong, view mới (đã bust) gọi export mới trên `format.js` cũ →
`SyntaxError: ... does not provide an export named 'X'`. Đây là lỗi **cache**,
không phải lỗi code.

Bạn KHÔNG thể viết `import x from './format.js?v=ABC'` vì static import phải là
chuỗi tĩnh, không nội suy được biến `assetVersion` runtime.

## Giải pháp đúng: import map (chỉ sửa www page)

```html
{% block head_include %}
{% set v = (frappe.utils.now() | replace(" ", "T") | replace(":", "-")) %}
...
<!-- PHẢI trước mọi <script type="module"> -->
<script type="importmap">
{
  "imports": {
    "/assets/app/app/lib/api.js":            "/assets/app/app/lib/api.js?v={{ v }}",
    "/assets/app/app/lib/dom.js":            "/assets/app/app/lib/dom.js?v={{ v }}",
    "/assets/app/app/lib/format.js":         "/assets/app/app/lib/format.js?v={{ v }}",
    "/assets/app/app/lib/router.js":         "/assets/app/app/lib/router.js?v={{ v }}",
    "/assets/app/app/lib/store.js":          "/assets/app/app/lib/store.js?v={{ v }}",
    "/assets/app/app/components/banner.js":  "/assets/app/app/components/banner.js?v={{ v }}",
    "...mỗi file components/...": "...?v={{ v }}",
    "/assets/app/app/views/_config.js":      "/assets/app/app/views/_config.js?v={{ v }}"
  }
}
</script>
{% endblock %}
```

### Vì sao hoạt động
- Import map khớp theo **specifier đã resolve thành URL tuyệt đối**. `../lib/format.js`
  từ bất kỳ view nào đều resolve về `/assets/app/app/lib/format.js` (không query) →
  khớp key → trả URL value có `?v=`.
- Không đệ quy: value đã map (`...format.js?v=...`) không bị map lại → không vòng lặp.
- View động vẫn để `?v=` riêng (qua `assetVersion`/`withV`), **không** đưa vào map:
  specifier của chúng resolve thành URL **có** query nên không khớp key (key không query).

### Quy tắc liệt kê module vào map
Đưa vào map MỌI module **được static-import** bởi 1 module khác và **có thể đổi**:
- tất cả `lib/*.js`
- tất cả `components/*.js`
- mọi file dùng chung được import bằng relative path (vd `views/_config.js` nếu view khác `import './_config.js'`)

KHÔNG cần đưa view modules (đã bust qua dynamic import `withV`).

Tìm nhanh danh sách cần map:
```bash
cd public/<app>
grep -rhoE "from '\.\.?/[^']+'" views/*.js shell.js lib/*.js components/*.js | sort -u
ls lib/*.js components/*.js
```

### Đặt ĐÚNG CHỖ
- Import map phải xuất hiện **trước** `<script type="module">` đầu tiên và trước mọi
  `<link rel="modulepreload">`. Đặt trong `head_include` (head) là an toàn vì
  `shell.js` nằm ở `page_content` (body).
- Chỉ được có **một** import map mỗi trang.

### Ký tự version an toàn
`frappe.utils.now()` = `"2026-06-14 15:06:50.123456"` có **dấu cách** (không hợp lệ
trong URL) → `| replace(" ", "T")`. Colon hợp lệ trong query nhưng thay cho sạch:
`| replace(":", "-")`. Kết quả `2026-06-14T15-06-50.123456` an toàn cả URL lẫn JSON.

### Lưu ý scope của `{% set %}`
Biến set trong block `head_include` KHÔNG thấy được ở block `page_content` (Jinja
block scope). Nếu cần token ở body (vd `shell.js?v=`), set lại hoặc dùng
`frappe.utils.now()` trực tiếp ở đó — không cần trùng token với head (mỗi phần chỉ
cần "tươi", không cần bằng nhau).

## Đánh đổi
Token theo `now()` ⇒ shared module tải lại mỗi **full page load** (mất lợi ích cache
immutable cho các file nhỏ này). Với SPA (load 1 lần rồi hash-route) thì không đáng
kể, và đổi lại là **không bao giờ chạy code cũ**. Muốn vừa cache vừa đúng: dùng token
đổi-theo-deploy (app version / build hash) thay cho `now()` — nhưng phải tự bump.

## Kiểm thử nhanh import map
```python
import re, json
html = open('www/page.html').read()
raw = re.search(r'<script type="importmap">\s*(\{.*?\})\s*</script>', html, re.S).group(1)
data = json.loads(raw.replace('{{ v }}', 'TEST'))   # phải parse được
# đối chiếu mỗi key tồn tại file trên đĩa
```
