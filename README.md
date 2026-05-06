# NPP Portal

B2B portal cho nhà phân phối (NPP) của Công ty Cổ phần Hoàng Giang.

## Cài đặt

```bash
cd ~/frappe-bench
bench get-app npp git@github.com:mrhuychien/nextnpp.git
bench --site <site-name> install-app npp
bench restart
```

## Truy cập

```
https://<your-site>/npp
```

## Tech stack

- **Backend**: Frappe Framework v16, ERPNext v16
- **Frontend**: Vanilla JS + ES Modules (no build step)
- **Auth**: Frappe session, `User.customer` mapping
- **Routing**: Hash-based SPA router (`/npp#/dat-hang`, `/npp#/don-hang/:name`, ...)

## Cấu trúc app

```
npp/
├── api/        # Whitelisted Python methods (Phase 5)
├── public/npp/ # Frontend ES modules
├── www/        # Web Page route /npp
├── fixtures/   # Custom Field auto-loaded on install
└── hooks.py    # Frappe hooks (redirects, fixtures)
```

## Customize

- Đổi tên Company / Price List: sửa `npp/public/npp/views/_config.js`
- Đổi list SP truyền thống/Tết: sửa `_config.js` → `ITEM_GROUPS`
- Đổi tên custom field Sales Invoice: sửa `_config.js` → `SI_FIELDS`
  (đồng thời sửa fixture `npp/fixtures/custom_field.json` + `bench migrate`)

## Dev workflow

```bash
# Sửa file frontend
vim apps/npp/npp/public/npp/views/dashboard.js
# Hard refresh trình duyệt (Cmd+Shift+R)

# Sửa file backend
vim apps/npp/npp/api/dashboard.py
bench restart   # cần restart để Python module reload

# Build production assets (optional, hiện chưa cần)
bench build --app npp
```

## Troubleshooting

| Lỗi | Khắc phục |
|---|---|
| 404 `/assets/npp/npp/shell.js` | `bench build --app npp` |
| `frappe.call` báo 403 | Kiểm tra User → Customer link |
| Pricing Rule không apply | Check `applicable_for = "Customer"` + `pr_detail.customer` đúng |
| Static asset cache | Hard refresh hoặc đổi `?v=` query trong npp.html |

## License

MIT — private app.
