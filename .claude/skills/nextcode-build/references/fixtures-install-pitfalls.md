# Fixtures & Install — 15 cạm bẫy làm vỡ `install-app` (Frappe v16)

> Rút từ thực chiến: một app ~47 DocType + 28 child table cài lần đầu, `install-app` **chết 8 vòng liên tiếp**, mỗi vòng lộ một lớp lỗi khác mà sweep tĩnh trước đó chưa bắt. Tài liệu này để **build đúng từ đầu** (Section A), **chẩn nhanh khi vỡ** (Section B), và **chặn bằng validator** (Section C).

Quy tắc vàng đứng trên tất cả: **luôn `bench export-fixtures`, đừng viết tay fixtures.** Frappe export kèm `name` + mọi field đúng schema + đúng kiểu. Hơn một nửa số bẫy dưới đây chỉ phát sinh vì fixtures được sinh thủ công (offline/AI) thiếu `name`, thiếu field reqd, sai kiểu Table/Select. Nếu buộc phải viết tay → chạy validator ở Section C trước khi cài.

---

## 0. Sáu nguyên lý gốc (hiểu cái này thì 15 bẫy dưới là hệ quả)

1. **Fixtures import = full validate.** `import_fixtures` → `import_doc(data_import=True)` → `doc.insert()` chạy ĐẦY ĐỦ `_validate` + `_validate_mandatory` + controller `validate()`/`on_update()`. KHÔNG phải "nhét thẳng vào DB". Mọi rule của doctype đích đều áp.
2. **Thứ tự import = ALPHABET tên file**, KHÔNG theo list `fixtures` trong hooks.py. `import_fixtures` duyệt `sorted(os.listdir(fixtures/))` và import **mọi** `.json` trong thư mục. (List trong hooks.py chỉ dùng cho `export-fixtures`.) → file vỡ thì file alphabet sau nó **chưa bao giờ được chạy** — đừng tưởng nó "đã qua".
3. **Lỗi ≠ `ImportError`/`DoesNotExistError` thì CHẾT install.** `import_fixtures` chỉ `try/except` 2 loại đó; `KeyError`/`ValidationError`/`MandatoryError`/`ProgrammingError` xuyên thẳng ra ngoài.
4. **Fixtures KHÔNG áp schema `default` trước validate.** Chỉ `frappe.new_doc()` mới áp default. Đường import là `get_doc(dict)` → field `reqd` phải **hiện diện tường minh** trong JSON; có `default` trong schema cũng không cứu.
5. **`after_install` có thể chạy TRƯỚC `sync_fixtures`** (tùy bản Frappe — đã gặp build mà thứ tự là `add_module_defs → sync_for → after_install → sync_fixtures`). ĐỪNG giả định fixtures đã vào DB khi ở trong `after_install`.
6. **Bản Frappe trên server có thể khác version-16 public** (cờ `reqd`, thứ tự install). Schema public chỉ là baseline để validate, không phải chân lý tuyệt đối.

---

## Section A — Checklist build (làm đúng từ đầu)

### A1. patches.txt phải có **cả hai** header, kể cả rỗng
```
[pre_model_sync]

[post_model_sync]
myapp.patches.v1_0_0.xxx
```
Thiếu `[pre_model_sync]` → `KeyError` chết cả `install-app` lẫn `migrate`.

### A2. Mỗi module trong modules.txt phải là một **Python package**
`sync_for` (sync.py) resolve mỗi module bằng `frappe.get_module(app + "." + scrub(module)).__file__`. Module "ABC XYZ" → bắt buộc có thư mục `abc_xyz/__init__.py`, **kể cả module không ship document chuẩn nào** (vd module "ô dù" chỉ để gắn Workspace/Print Format). Thiếu → `ModuleNotFoundError`.

### A3. Standard document (Report/Workspace/Print Format dạng file) phải nằm đúng `<app>/<scrub(module)>/...`
- Folder phải khớp field `module` trong JSON (qua `scrub()`), nếu không sẽ **không bao giờ được sync** và chạy là `ImportError` (Script Report resolve code tại `<app>.<scrub(module)>.report.<name>`).
- `frappe.scrub()` **giữ nguyên ký tự unicode** — tên có `×`, `–`, dấu tiếng Việt sẽ không khớp folder ASCII → đặt `name`/`report_name` ASCII-safe.

### A4. Report `columns`/`roles`/`filters` là **child table**, ship `[]` không phải string
Script Report lấy cột từ `execute()` trả về `(columns, data)`. Trong file/fixture Report, để `"columns": []`. Nếu ghi `"columns": "[{...}]"` (JSON string) → `base_document._init_child` duyệt **từng ký tự** của chuỗi → `TypeError: 'str' object does not support item assignment`.

### A5. Child table (`istable=1`) KHÔNG ship làm fixture standalone
Frappe cấm insert child row thiếu `parent`/`parenttype` → `MandatoryError`. Seed dữ liệu mẫu của child qua **parent** trong `after_install` (xem A12).

### A6. is_standard / standard guard
- `Dashboard` và `Dashboard Chart` với `is_standard=1` → `validate` throw **"Cannot edit Standard ..."** trên site không bật `developer_mode` (KHÔNG miễn trừ `in_install`). App-shipped để `is_standard: 0`.
- `Notification` `is_standard=1` → runtime load message từ **file module** mà app thường không ship → để `0`, dùng message lưu DB.
- `Print Format` `standard="Yes"` thì **được** miễn trừ khi `in_install`/`in_migrate` → ship file chuẩn OK.

### A7. Workspace
- `content` phải là **JSON list hợp lệ** (string). Để `"[]"` tối thiểu, hoặc list block `[{"id","type","data"}]`. Rỗng `""` → `json.loads("")` ném → throw "Content data shoud be a list".
- `type` là field **reqd** (Select `Workspace`/`Link`/`URL`) → phải có, thường `"type": "Workspace"`.
- `links`/`shortcuts` mỗi row reqd `type`+`label`. Card gom link: thêm 1 row `{"type":"Card Break","label":...}` rồi các row `{"type":"Link",...}`.

### A8. Notification cần field đồng hành theo `event`
`Days Before`/`Days After` → `date_changed` (+ `days_in_advance`). `Value Change` → `value_changed`. `Minutes Before/After` → `datetime_changed`+`minutes_offset≥10`. `condition` được `safe_eval` trên doc rỗng → chỉ dùng so sánh field tồn tại, không gọi hàm lạ. KHÔNG đặt Notification lên child table (trừ date-based event).

### A9. Dashboard Chart / Number Card
- `document_type` là **child table** → cần `parent_document_type` (DashboardChart.check_required_field / NumberCard.validate throw). Chart `chart_type=Custom/Report` và Card `type=Custom` được miễn.
- `document_type` là **Single** → DashboardChart.check_document_type throw "cannot create from single DocTypes".
- Number Card `function` ∈ {Count,Sum,Average,Minimum,Maximum}; card method-based để `type="Custom"`+`method`, count-based để `type="Document Type"`+`function`.

### A10. Workflow
- KHÔNG đặt workflow lên **Single doctype**: `Workflow.on_update → update_default_workflow_status` chạy `UPDATE tab{doctype}` vô điều kiện → Single không có bảng `tab` → `(1146) Table doesn't exist`. (Single dùng field chữ ký/approve thủ công thay workflow.)
- Workflow có state `doc_status ≥ 1` → doctype **phải** `is_submittable=1` (nếu không, `apply_workflow` vỡ runtime).
- `allow_edit` (state) và `allowed` (transition) là Link **một role** — KHÔNG phải CSV. Cần OR-logic nhiều role → **tách 1 row/role** (client gộp `allow_edit` mọi row trùng state; `get_transitions` match từng row). State terminal vẫn cần `allow_edit` (reqd) → để `"System Manager"`.
- Docstatus transition chỉ hợp lệ: `0→0`, `0→1`, `1→1`, `1→2`. `1→0` (submitted về draft) và `0→2` đều bị `validate_docstatus` chặn — và chặn **ngay lúc import fixture**.
- Chỉ **một** workflow `is_active=1` mỗi doctype.

### A11. Custom DocPerm — KHÔNG ship qua fixture
`Custom DocPerm` đặt tên bằng **hash** → không khai báo `name` tĩnh được, và hash đổi giữa các site → vỡ ở migrate sau. Cấp quyền DocType core trong `after_install` bằng API:
```python
from frappe.permissions import add_permission, update_permission_property
add_permission(doctype, role, 0)              # tạo Custom DocPerm, read=1; tự setup_custom_perms (copy DocPerm chuẩn, không mất quyền core)
update_permission_property(doctype, role, 0, "write", 1)  # bật từng cờ
```
Idempotent sẵn (add_permission bỏ qua nếu rule đã tồn tại).

### A12. Seed dữ liệu mẫu trong `after_install` — phòng thủ
- Bọc `try/except` + `frappe.log_error()` cho **mọi** seed không tới hạn — lỗi seed KHÔNG được phép làm chết install.
- after_install có thể chạy trước fixtures → **tự tạo dependency** (vd Role) thay vì giả định fixtures đã có. Fixture import sau sẽ ghi đè bằng `delete_doc(for_reload=True)` (bỏ qua `on_trash` → không cascade xóa quyền vừa cấp).
- Seed vào **Single**: `frappe.get_single(dt).append("child", {...}); doc.save()` — KHÔNG `get_doc({...}).insert()`, KHÔNG `frappe.db.exists(single_dt, {filters})` (query bảng `tab` không tồn tại). Idempotent bằng "child rỗng thì mới nạp".

### A13. Single doctype (`issingle=1`)
Không có bảng `tab` (data ở `tabSingles`). Hệ quả: KHÔNG `frappe.db.count()`/`get_all()` được (dùng `get_single`); KHÔNG đặt Report `ref_doctype`/Chart/Card/Notification `document_type` lên Single; đọc bằng `frappe.get_single`/`get_cached_doc`.

### A14. Mọi field `reqd` phải hiện diện tường minh trong JSON
Fixtures không áp `default`. Field reqd vắng trong record → `MandatoryError` dù schema có default. (Bẫy hay gặp: `Workspace.type`, `Dashboard Chart.filters_json`, `Workflow Document State.allow_edit`.)

### A15. Fixture phải khớp schema **thật** của đúng version Frappe
Table=list-of-dict, Select đúng `options`, scalar không nhận list/dict, không key lạ (key không có trong schema bị drop im lặng khi import **nhưng** làm vỡ `export-fixtures` nếu hooks filter theo key đó — vd filter Email Template theo `module` trong khi schema không có field `module`). Đừng tin trí nhớ về cấu trúc doctype — tải schema thật mà đối chiếu (Section C).

---

## Section B — Tra cứu nhanh: thông báo lỗi → nguyên nhân → bẫy

| Thông báo lỗi (lúc install/migrate) | Nguyên nhân | Bẫy |
|---|---|---|
| `KeyError: 'pre_model_sync'` | patches.txt thiếu header | A1 |
| `KeyError: 'name'` (import_file.py) | fixture record thiếu `name` | nguyên lý 3 + "export-fixtures" |
| `No module named 'app.xxx'` (sync.py) | module trong modules.txt thiếu package | A2 |
| `ImportError` khi mở/sync Report | report sai folder/module hoặc name unicode | A3 |
| `'str' object does not support item assignment` | child-table field nhận JSON string | A4 |
| `MandatoryError [..]: parent, parenttype` | child table ship làm fixture standalone | A5 |
| `Cannot edit Standard charts/Dashboards` | is_standard=1 app-shipped | A6 |
| `Content data shoud be a list` | Workspace.content rỗng/không phải list | A7 |
| `Please specify which date/value field...` | Notification thiếu date_changed/value_changed | A8 |
| `Parent document type is required...` | Chart/Card trỏ child table thiếu parent_document_type | A9 |
| `(1146) Table 'tab<DT>' doesn't exist` (workflow on_update / count) | workflow trên Single, hoặc count Single | A10 / A13 |
| `MandatoryError [..]: <field>` (field có default) | field reqd vắng trong JSON | A14 |
| `... is not in options` / `'str' object...` / silently dropped key | lệch schema | A15 |

---

## Section C — Cổng kiểm TRƯỚC khi cài (bắt buộc nếu fixtures viết tay)

Dùng `validate_shipped_docs.py` (cùng thư mục references này). Nó tải schema **thật** của ~27 core doctype từ GitHub (cache `/tmp/frappe_schemas`) + nạp schema doctype của chính app, rồi validate **từng key/từng record** mọi fixture + report file, mô phỏng đúng các luật install ở Section A.

```bash
python3 validate_shipped_docs.py <path/tới/apps/myapp/myapp>
# 0 ERROR mới đem đi cài. Chạy lại sau mỗi lần sửa fixture.
```

Bổ trợ: một "static sweep" quét DocType (module/folder/controller/`__init__`/fieldtype/Link-Table target/autoname/fieldname reserved), hook dotted-path, patches — bắt lỗi tầng schema trước cả khi đụng fixtures. Hai lớp (sweep DocType + validate shipped docs) phủ gần hết lỗi *mô phỏng tĩnh được*.

**Kỷ luật vòng lặp** (khi đang chữa install thật): sửa code → **chạy validator** → `git commit` (một fix một commit, message rõ bug) → trên server `git pull` → `drop-site` site test → cài lại 4 app. Mỗi lần `install-app` chết giữa chừng đều **để lại xác** (Module Def/DocType đã commit) → luôn `drop-site` rồi `new-site`, đừng `install-app --force` lên site bẩn.

---

## Section D — Evidence trong source Frappe v16 (để verify, đừng đoán)

| Khẳng định | Vị trí |
|---|---|
| `doc["name"]` đọc vô điều kiện mọi record | `frappe/modules/import_file.py` (`import_file_by_path`, dòng ~123) |
| Fixtures import theo alphabet `sorted(os.listdir)` | `frappe/utils/fixtures.py::import_fixtures` |
| Chỉ catch ImportError/DoesNotExistError | `frappe/utils/fixtures.py::import_fixtures` |
| `name` preset được giữ khi import (mọi autoname kể cả hash) | `frappe/model/naming.py` (`if ... not frappe.flags.in_import: doc.name=None`) |
| `add_permission` gọi `setup_custom_perms` (copy DocPerm chuẩn) + idempotent | `frappe/permissions.py` |
| Custom DocPerm thay thế (không merge) DocPerm chuẩn, bỏ qua khi `in_install` | `frappe/model/meta.py::set_custom_permissions` |
| Workflow `update_default_workflow_status` chạy `UPDATE tab{dt}` | `frappe/workflow/doctype/workflow/workflow.py::on_update` |
| `validate_docstatus` cấm 1→0, 0→2, 2→* | `frappe/workflow/doctype/workflow/workflow.py` |
| Workspace.validate đòi content là list | `frappe/desk/doctype/workspace/workspace.py::validate` |
| Print Format standard miễn trừ `in_install`/`in_migrate` | `frappe/printing/doctype/print_format/print_format.py::validate` |

Cách lấy nhanh (offline-friendly): `curl -fsSL https://raw.githubusercontent.com/frappe/frappe/version-16/frappe/<path>` rồi đọc thẳng — đáng tin hơn WebFetch (tránh paraphrase). Nhớ: bản server có thể khác → khi nghi ngờ, đọc source **trên chính bench server**.
