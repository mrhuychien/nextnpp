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

## Phát triển

```bash
# Edit JS/CSS trong apps/npp/npp/public/npp/
# Frappe serve static files trực tiếp, không cần `bench build`.
# Hard refresh trình duyệt (Cmd+Shift+R) để bust cache khi sửa.
```

## License

MIT — private app.
