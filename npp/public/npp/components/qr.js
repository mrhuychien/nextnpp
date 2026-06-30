// Sinh mã QR phía client — dùng lib qrcode-generator VENDOR trong app (same-origin,
// không phụ thuộc CDN/CSP). Lazy-load 1 lần qua <script>; expose global `window.qrcode`.

let qrPromise = null;
const QR_SRC = '/assets/npp/npp/vendor/qrcode/qrcode.js';

export function loadQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrPromise) return qrPromise;
    qrPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = QR_SRC;
        s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('QR không khả dụng')));
        s.onerror = () => { qrPromise = null; reject(new Error('Không tải được thư viện QR.')); };
        document.head.appendChild(s);
    });
    return qrPromise;
}

/** Vẽ QR cho `text` vào `container` (img data-URL, hiển thị ~size px). */
export async function renderQR(container, text, sizePx = 180) {
    if (!container) return;
    let qrcode;
    try { qrcode = await loadQR(); }
    catch (e) { container.innerHTML = `<div class="npp-text-sm npp-text-muted">${e.message}</div>`; return; }
    try {
        const q = qrcode(0, 'M');           // typeNumber 0 = tự chọn cỡ; mức sửa lỗi M
        q.addData(text);
        q.make();
        container.innerHTML = q.createImgTag(4, 8);   // cellSize, margin
        const img = container.querySelector('img');
        if (img) {
            img.style.width = sizePx + 'px';
            img.style.height = sizePx + 'px';
            img.style.imageRendering = 'pixelated';   // nét, không mờ khi phóng to
            img.removeAttribute('width');
            img.removeAttribute('height');
        }
    } catch (e) {
        container.innerHTML = '<div class="npp-text-sm npp-text-muted">Không tạo được QR (nội dung quá dài).</div>';
    }
}
