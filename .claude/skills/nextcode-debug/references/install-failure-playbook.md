# Playbook: `install-app` / `migrate` chết giữa chừng (Frappe v16)

Loại bug riêng, không nằm trong 9-bước thường (không reproduce qua UAT — nó vỡ ở
tiến trình cài). Playbook này bổ sung phương pháp **forensic** cho tình huống đó.
Catalog 15 cạm bẫy + cách build đúng nằm ở skill `nextcode-build`
(`references/fixtures-install-pitfalls.md`) — đây là góc **chẩn đoán**.

## Đặc thù cần nhớ (định hình mọi suy luận)

1. **Install commit theo từng bước.** `install-app` chết giữa chừng vẫn để lại
   **xác**: Module Def, DocType, table đã tạo. Lần cài lại trên site bẩn sẽ chết
   ở `add_module_defs` (`Duplicate entry`) chứ không phải bug thật → luôn yêu cầu
   `drop-site` + `new-site` rồi cài lại. Đừng tin kết quả trên site bẩn.
2. **Fixtures import theo ALPHABET tên file**, import **mọi** `.json` trong
   `fixtures/`. File đang chết → các file alphabet **sau** nó chưa chạy lần nào →
   "đã qua" là ảo tưởng. Fix một file thường chỉ để lộ file kế.
3. **after_install có build chạy TRƯỚC sync_fixtures.** Banner/print của
   after_install hiện ra **trước** lỗi fixture là bình thường — không có nghĩa
   fixtures đã chạy.
4. **Bản Frappe server ≠ version-16 public.** Số dòng, thứ tự `install_app`, cờ
   `reqd` có thể khác. Khi nghi → đọc source **trên chính bench server**, không
   chỉ GitHub.

## Quy trình 6 bước

### B1 — Định vị bằng traceback, không đoán
Đọc từ dưới lên. Lấy 4 mốc:
- **Lệnh lỗi cuối** (`installer.py` dòng nào: `add_module_defs` / `sync_for` /
  `sync_fixtures`?) → biết đang ở giai đoạn nào.
- **Nếu là sync_fixtures**: `fname = '...'` cho biết **file fixture** đang import,
  `doc = {...}` cho biết **record** đang vỡ.
- **Exception cuối** + thông báo → tra bảng B5.
- **Cẩn thận biến vòng lặp**: vd `MandatoryError [Workspace, FSMS]: type` với
  `d = Workspace Link (...)` — `[doctype, name]: field` chỉ doc **cha** (Workspace
  FSMS) thiếu `type`; `d=...Link` chỉ là biến lặp cuối trong frame, KHÔNG phải
  nguồn lỗi. Tin format `[doctype, name]: field`.

### B2 — Xác thực server đang chạy ĐÚNG code
Trước khi sửa bất cứ gì: `calculated_hash` trong traceback chính là **md5 file
fixture server đang đọc**. So với repo:
```bash
git show <commit>:path/to/fixture.json | md5sum   # bản cũ
md5sum path/to/fixture.json                        # bản đã fix
```
Trùng hash bản cũ + log còn in thông điệp của code cũ ⇒ **server chưa `git pull`**
— đừng sửa lại, chỉ cần pull. (Đã mất vài vòng vì lý do này.)

### B3 — Đọc SOURCE thật, đừng tin trí nhớ
Tải thẳng (đáng tin hơn WebFetch — tránh paraphrase):
```bash
curl -fsSL https://raw.githubusercontent.com/frappe/frappe/version-16/frappe/<path> -o /tmp/x.py
```
Các file hay cần: `modules/import_file.py`, `utils/fixtures.py`, `model/naming.py`,
`installer.py`, `model/sync.py`, `workflow/doctype/workflow/workflow.py`,
`desk/doctype/<dashboard_chart|number_card|workspace>/*.py`,
`email/doctype/notification/notification.py`, `permissions.py`. Đọc đúng controller
`validate()`/`on_update()` của doctype đang vỡ.

### B4 — Mô phỏng tĩnh để tìm HẾT đồng loại, không vá lẻ
Bug install đi theo **lớp** (cùng một sai lầm lặp trên nhiều record/file). Viết
script Python đọc toàn bộ DocType/fixture JSON và bắt cả lớp cùng lúc:
- Dùng `validate_shipped_docs.py` (skill `nextcode-build/references/`) — validate
  fixtures/report chống schema thật.
- Tự viết sweep quét DocType (module↔folder↔controller↔`__init__`, fieldtype,
  Link/Table target, autoname, reserved fieldname), hook dotted-path, patches.
Mục tiêu: chạy validator ra **0 ERROR** rồi mới cài lại — cắt vòng "mỗi lần một lỗi".

### B5 — Bảng tra lỗi (rút gọn; chi tiết ở fixtures-install-pitfalls.md §B)
| Exception | Nguyên nhân gốc |
|---|---|
| `KeyError: 'pre_model_sync'` | patches.txt thiếu header section |
| `KeyError: 'name'` | fixture record thiếu `name` (import_file.py đọc `doc["name"]` vô điều kiện) |
| `No module named 'app.xxx'` | module trong modules.txt thiếu package `__init__.py` |
| `'str' object does not support item assignment` | child-table field (Report.columns) nhận JSON **string** thay vì `[]` |
| `MandatoryError [..]: parent, parenttype` | child table (istable=1) ship làm fixture standalone |
| `Cannot edit Standard charts/Dashboards` | Dashboard/Chart `is_standard=1` (no in_install exemption) |
| `Content data shoud be a list` | Workspace.content = "" (không phải JSON list) |
| `Please specify which date/value field` | Notification event thiếu date_changed/value_changed |
| `Parent document type is required` | Chart/Card trỏ child-table document_type thiếu parent_document_type |
| `(1146) Table 'tab<DT>' doesn't exist` | workflow trên **Single** (UPDATE tab{dt}); hoặc `count()` Single |
| `MandatoryError [..]: <field>` (field có default) | field reqd vắng trong JSON (fixtures không áp default) |
| `Duplicate entry '<Module>'` ở add_module_defs | site **bẩn** từ lần cài dở → drop-site |

### B6 — Sửa minimal + idempotent, commit từng lớp
Một lớp = một commit, message nêu rõ exception + nguyên nhân + bằng chứng source.
Ghi `INVESTIGATION.md` mỗi vòng (giả thuyết → evidence → fix). Sau khi sửa,
**bắt buộc** chạy validator lại trước khi báo "đã fix".

## Ranh giới
- KHÔNG `install-app --force` lên site bẩn để "qua" duplicate — che mất bug, kết
  quả test vô nghĩa. Luôn drop-site.
- KHÔNG sửa đoán khi chưa xác thực server chạy đúng code (B2) và chưa đọc source
  controller liên quan (B3).
- Production: backup + snapshot trước; văng Duplicate/Workflow/Role thì DỪNG, hỏi
  lại — đừng gõ tiếp.
