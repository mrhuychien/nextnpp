---
name: frappe-app-shipping-gotchas
description: Use when installing, deploying, or fixing install-time/runtime failures of a Frappe/ERPNext v16 custom app — especially ModuleNotFoundError on bench install-app, missing fields on standard DocTypes (e.g. User has no customer), Unicode/diacritic fieldname problems, the migrate→build→restart→refresh deploy sequence, or keeping a feature branch in sync with the default branch. Triggers include "bench install-app No module named", "ModuleNotFoundError khi cài app", "thiếu __init__.py", "User.customer không tồn tại", "thêm field vào DocType chuẩn", "tên field tiếng Việt có dấu", "custom_quycach vs custom_quy_cách", "sau deploy không thấy thay đổi", "bench build/restart/migrate thứ tự nào", "đồng bộ branch dev với main". Do NOT use for fixtures export/validation specifics (use nextcode-build's fixtures pitfalls), for debugging an arbitrary app traceback (use nextcode-debug), or for browser asset caching (use frappe-portal-spa). This skill is the post-build shipping checklist and the concrete gotchas hit on a real install.
---

# Frappe App Shipping — cạm bẫy install/deploy & checklist

Skill này là **retrospective gotchas** khi đem 1 custom app từ code → cài chạy thật
trên site (ngoài tầng fixtures mà `nextcode-build` đã lo). Toàn bộ rút từ lần
ship thật, đã verify với source Frappe v16.

## ⚠️ Gotcha #1 — Mỗi module dir PHẢI có `__init__.py`

`bench install-app` đọc `modules.txt`, rồi với mỗi module Frappe **import package
Python tương ứng** (sync.py). Thiếu `__init__.py` ở thư mục module →
`ModuleNotFoundError: No module named '<app>.<module>'` **chết ngay khi cài**, dù
code khác đúng hết.

```bash
# Mỗi dòng trong modules.txt phải có package tương ứng:
#   App tên "npp", module "NPP Portal" → thư mục npp/npp_portal/__init__.py
# Kiểm nhanh các module thiếu __init__.py:
while read m; do d=$(echo "$m" | tr 'A-Z ' 'a-z_'); \
  [ -f "<app>/$d/__init__.py" ] || echo "THIẾU: $d/__init__.py"; done < <app>/modules.txt
```

Quy tắc an toàn: **mọi thư mục Python** trong app (app root, mỗi module, `api/`,
`config/`, `doctype/…`) đều có `__init__.py`.

## ⚠️ Gotcha #2 — DocType chuẩn thiếu field bạn tưởng có

`User` **không** có `customer`. `Customer` không có `monthly_target`. Đừng đọc field
không tồn tại (sẽ `AttributeError`/`Unknown column`). Thêm bằng **Custom Field** ship
qua `fixtures/custom_field.json`, fieldname **prefix `custom_`**:

- `User-custom_customer` (Link→Customer) để map user ↔ khách.
- `Customer-custom_monthly_target` (Currency) cho mục tiêu.

Code đọc `user.custom_customer`, `customer.custom_monthly_target`. Field mới **chỉ
tồn tại sau `bench migrate`** → method dùng nó phải chạy sau migrate.

## ⚠️ Gotcha #3 — Fieldname tiếng Việt có dấu rất dễ vỡ

ERPNext auto-sinh `fieldname` từ `label`. Label tiếng Việt → fieldname **có dấu**
(`custom_quy_cách`, `custom_thể_tích`) — fragile khi tra trong SQL/JS/JSON và dễ
lệch NFC/NFD. Hệ quả thực tế: field hiển thị "quy cách" thật ra là `custom_quycach`
(ASCII) chứ không phải `custom_quy_cách` (có dấu) → đọc nhầm field ra rỗng.

- Khi tạo field **đặt fieldname ASCII** (`custom_quycach`) dù label có dấu.
- Khi đọc field nghi có dấu: **xác minh fieldname thật** (`bench --site x console` →
  `frappe.get_meta("Item").get_field(...)`, hoặc xem Customize Form) thay vì đoán.
- So khớp chuỗi Unicode → normalize NFC hai vế.

## Thứ tự deploy (và VÌ SAO)

```bash
cd ~/frappe-bench
bench --site <site> migrate     # áp custom field / schema / patches MỚI (field chưa có → method lỗi)
bench build --app <app>         # build/đồng bộ asset ra /assets (file JS/CSS mới hoặc đổi nội dung)
bench restart                   # nạp lại tiến trình Python: whitelisted method, www context, hooks
# refresh trình duyệt (xem frappe-portal-spa nếu có SPA: import map lo cache shared module)
```
Bỏ bước nào → triệu chứng:
- Quên `migrate` → `Unknown column custom_*` / field rỗng.
- Quên `build` → file view mới 404 / asset cũ.
- Quên `restart` → method mới `... is not whitelisted` hoặc chạy code Python cũ.
- Quên refresh → trình duyệt giữ bản cũ (với SPA: thiếu import map sẽ phải hard-refresh).

## Phân quyền & cô lập dữ liệu khi ship portal đa-khách

- KHÔNG bê thẳng công cụ admin (vd "đối chiếu công nợ toàn bộ") vào portal mỗi-khách
  → rò rỉ/leo thang quyền. Tách: **self-view** (ép `custom_customer` của chính user)
  vs **manager-view** (gate bằng role ERPNext sẵn có).
- Mọi `@frappe.whitelist()` kiểm quyền **dòng đầu**; `ignore_permissions=True` chỉ
  dùng sau khi đã tự kiểm và chỉ trên doc đúng phạm vi khách.

## Ngữ nghĩa nghiệp vụ dễ sai (đặt hàng)

- Đơn vị đặt = **Thùng** → `qty = số thùng`. ĐỪNG nhân `quy_cách × số_thùng`
  (quy cách là số hộp/thùng, không phải để nhân ra qty).
- Đặt default field tuỳ biến khi tạo đơn (vd `custom_trạng_thái_vận_chuyển="Chờ xử lý"`).
- Tạo đơn nặng → làm **server-side** (whitelisted method) + `finally` tắt loading ở
  client, tránh treo "quay tròn".

## Đồng bộ branch (khi được phép push default)

Khi user **cho phép** push cả lên branch mặc định:
```bash
git push origin <feature-branch>        # nhánh dev được giao
git push origin HEAD:main               # fast-forward default (KHÔNG -u để khỏi đổi upstream)
```
- Chỉ push nhánh được giao + default đã được cho phép; **không** đụng nhánh khác.
- Tránh `-u` ở lần push default để không đổi upstream tracking của nhánh dev.
- Retry network với backoff (2s/4s/8s/16s).

## Verify trước khi ship (rẻ mà cứu nhiều)
```bash
python3 -m py_compile <app>/api/*.py                     # cú pháp Python
for f in <app>/public/**/views/*.js; do node --check "$f"; done   # cú pháp JS
python3 references/validate_shipped_docs.py <path/app>   # (từ nextcode-build) fixtures 0 ERROR
# kiểm __init__.py mọi module (xem Gotcha #1)
```

## Checklist ship
- [ ] Mọi module dir có `__init__.py`? (`modules.txt` ↔ package)
- [ ] Field trên DocType chuẩn đã có Custom Field + ship fixtures + đọc đúng `custom_*`?
- [ ] Fieldname ASCII (không dựa label có dấu)? Đã xác minh fieldname thật?
- [ ] Đã `migrate → build → restart → refresh` đúng thứ tự?
- [ ] Method whitelisted kiểm quyền dòng đầu? Self-view không lộ dữ liệu khách khác?
- [ ] `py_compile` + `node --check` sạch? validator fixtures 0 ERROR?
- [ ] Chỉ push nhánh được phép?
