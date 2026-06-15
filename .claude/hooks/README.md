# Tự động có skills khi khởi tạo session (Claude Code on the web)

## Vấn đề
Skills bạn tạo trên desktop nằm ở `~/.claude/skills` của **máy local**. Session
cloud chạy trong **container ephemeral** clone repo mới mỗi lần → **không** thấy
`~/.claude/skills` local của bạn. Chỉ thứ nằm trong **git** mới theo vào cloud.

## Có 2 loại skill — 2 cách
| Loại skill | Để ở đâu | Cloud tự có chưa? |
|---|---|---|
| **Riêng dự án / theo domain** (vd 3 skill `frappe-*`) | `.claude/skills/` **trong repo** | ✅ Tự nạp (đã commit). Không cần hook. |
| **Dùng chung mọi repo** (skill cá nhân của bạn) | 1 **repo skills trung tâm** | ⬇️ Cần cơ chế kéo về (mục dưới). |

## Cơ chế kéo skill chung về (SessionStart hook)
`session-start.sh` (đăng ký trong `../settings.json`) chạy khi khởi tạo session,
clone repo skills trung tâm và copy vào `~/.claude/skills/` để dùng như personal
skill. Idempotent, fail-soft (mạng lỗi không chặn session), và **project skill
cùng tên luôn thắng** (không trùng lặp).

### Bật lên — 3 bước
1. Tạo 1 repo git chứa skills, mỗi skill 1 thư mục:
   ```
   claude-skills/
     skills/<tên-skill>/SKILL.md      (hoặc <tên-skill>/SKILL.md ở gốc)
   ```
2. Trong cấu hình **environment** trên web (Settings → Environment variables), đặt:
   ```
   CLAUDE_SKILLS_REPO = https://github.com/<bạn>/claude-skills.git
   # tùy chọn: CLAUDE_SKILLS_BRANCH, CLAUDE_SKILLS_SUBDIR
   ```
3. Merge nhánh có hook này vào **default branch** của repo → mọi session sau tự chạy.

> Repo skills **private**: container cần quyền đọc nó. Đơn giản nhất là để
> **public**, hoặc dùng PAT trong URL/credential helper. Chỉ trỏ tới repo bạn
> tin tưởng (hook copy file SKILL.md, không thực thi gì lúc sync).

## Cách thay thế: Setup script của environment (toàn cục, không cần hook mỗi repo)
Nếu muốn skills chung cho **mọi repo** mà không phải commit hook vào từng repo,
dán đoạn này vào **Setup script** của environment (chạy 1 lần khi tạo container):
```bash
mkdir -p ~/.claude/skills
git clone --depth 1 "$CLAUDE_SKILLS_REPO" /tmp/cs 2>/dev/null \
  && cp -a /tmp/cs/skills/*/ ~/.claude/skills/ 2>/dev/null || true
```
Khi đó hook trong repo là tùy chọn (giữ cũng vô hại vì có guard de-dup).

## Chạy đồng bộ (synchronous)
Hook chạy **đồng bộ**: skills có mặt **trước** khi agent bắt đầu → tránh tình
huống session đã quét skill xong mới cài. Đổi lại session khởi tạo chậm hơn vài
giây. Muốn nhanh hơn có thể chuyển async (đầu script `echo '{"async":true,...}'`)
— nhưng có thể agent chưa thấy skill ngay lúc đầu.

## Local
Mặc định hook **chỉ chạy ở remote** (`CLAUDE_CODE_REMOTE=true`) để không đè skills
bạn đang sửa ở máy local. Muốn chạy cả local: đặt `CLAUDE_SKILLS_LOCAL=1`.

## Tự kiểm
```bash
CLAUDE_CODE_REMOTE=true CLAUDE_SKILLS_REPO=<url> \
CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/session-start.sh
ls ~/.claude/skills
```
