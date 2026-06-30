// Bản đồ định vị điểm bán — Leaflet + OpenStreetMap (miễn phí, KHÔNG cần API key).
// Lazy-load lib từ CDN 1 lần (giống Chart.js). Dùng circleMarker (vector) để né lỗi
// kinh điển "marker icon vỡ" của Leaflet khi không bundle ảnh marker.
//
// API:
//   await renderPointsMap(container, points, { onDetail })
//     points: [{ lat, lng, active?, html? , ...payload }]
//     onDetail(point): gọi khi bấm link [data-detail] trong popup (tuỳ chọn)
//   refreshMap(container): gọi invalidateSize khi container vừa được hiện lại
//     (Leaflet tính sai kích thước nếu map khởi tạo lúc tab đang display:none).

let leafletPromise = null;

// Leaflet được VENDOR trong app (same-origin) thay vì CDN: tránh bị CSP của site
// chặn stylesheet ngoài (script CDN qua được nhưng CSS bị chặn → tile vỡ + mất nút
// zoom vì leaflet.css không áp dụng). Phục vụ từ /assets nên không phụ thuộc mạng ngoài.
const LEAFLET_BASE = '/assets/npp/npp/vendor/leaflet';
const CSS_ID = 'npp-leaflet-vendor-css';   // id RIÊNG: không đụng <link> CDN cũ (bị CSP chặn)

// Đảm bảo leaflet.css (vendor, same-origin) có mặt — kể cả khi window.L đã được nạp
// từ phiên trước (vd bản CDN cũ): nếu thiếu CSS, pane/tile mất position:absolute →
// vỡ thành khảm rời rạc + mất nút zoom. Resolve khi CSS áp dụng xong (có timeout).
function ensureCss() {
    if (document.getElementById(CSS_ID)) return Promise.resolve();
    return new Promise((res) => {
        const link = document.createElement('link');
        link.id = CSS_ID;
        link.rel = 'stylesheet';
        link.href = `${LEAFLET_BASE}/leaflet.css`;
        link.onload = res;
        link.onerror = res;           // vẫn tiếp tục, đừng treo
        document.head.appendChild(link);
        setTimeout(res, 3000);        // chốt chặn timeout
    });
}

export function loadLeaflet() {
    if (window.L) return ensureCss().then(() => window.L);   // L sẵn → vẫn nạp CSS vendor
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
        const cssReady = ensureCss();
        const s = document.createElement('script');
        s.src = `${LEAFLET_BASE}/leaflet.js`;
        // Chờ CẢ css áp dụng rồi mới resolve → tile không bao giờ render trước CSS.
        s.onload = () => cssReady.then(() => (window.L ? resolve(window.L) : reject(new Error('Leaflet không khả dụng'))));
        s.onerror = () => { leafletPromise = null; reject(new Error('Không tải được thư viện bản đồ.')); };
        document.head.appendChild(s);
    });
    return leafletPromise;
}

function emptyHtml() {
    return '<div class="npp-empty" style="padding:2rem 1rem;">'
        + '<div class="npp-empty-icon">🗺️</div>'
        + '<div class="npp-empty-title">Chưa có điểm bán nào có toạ độ</div>'
        + '<div class="npp-text-sm npp-text-muted">Toạ độ được ghi khi nhân viên định vị điểm bán trên app.</div></div>';
}

function valid(p) {
    const la = Number(p.lat), ln = Number(p.lng);
    return Number.isFinite(la) && Number.isFinite(ln) && (la !== 0 || ln !== 0)
        && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

/** Vẽ tất cả điểm bán có toạ độ lên 1 bản đồ. Trả về map instance (hoặc null). */
export async function renderPointsMap(container, points, opts = {}) {
    if (!container) return null;
    const pts = (points || []).filter(valid);
    if (!pts.length) { container.innerHTML = emptyHtml(); return null; }

    let L;
    try { L = await loadLeaflet(); }
    catch (e) { container.innerHTML = `<div class="npp-text-sm npp-text-muted" style="padding:1rem;">${e.message}</div>`; return null; }

    // Dọn map cũ trên container (tránh leak / "map already initialized").
    if (container._nppMap) { try { container._nppMap.remove(); } catch {} container._nppMap = null; }
    container.innerHTML = '';

    const map = L.map(container, {
        zoomControl: true,        // nút +/− (thu phóng) ở góc trên-trái
        scrollWheelZoom: false,   // tránh cuộn trang vô tình zoom; dùng nút/pinch
    });
    container._nppMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map);

    const layers = [];
    for (const p of pts) {
        // Màu marker: ưu tiên p.color (vd theo trạng thái duyệt); mặc định theo active.
        const color = p.color || (p.active === false ? '#94a3b8' : '#10b981');
        const cm = L.circleMarker([Number(p.lat), Number(p.lng)],
            { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 });
        if (p.html) {
            cm.bindPopup(p.html);
            if (typeof opts.onDetail === 'function') {
                cm.on('popupopen', (e) => {
                    const el = e.popup.getElement();
                    const btn = el && el.querySelector('[data-detail]');
                    if (btn) btn.addEventListener('click', () => opts.onDetail(p), { once: true });
                });
            }
        }
        cm.addTo(map);
        layers.push(cm);
    }

    try {
        const group = L.featureGroup(layers);
        const b = group.getBounds();
        if (pts.length === 1) map.setView([Number(pts[0].lat), Number(pts[0].lng)], 15);
        else map.fitBounds(b.pad(0.2), { maxZoom: 16 });
    } catch { map.setView([16.0, 106.0], 5); }  // fallback: giữa VN

    // Container có thể vừa hiện từ tab ẩn / layout chưa ổn định → ép tính lại kích
    // thước vài lần để tile lấp đầy đúng (nếu không sẽ thấy mảng xám/khảm rời).
    [60, 300, 700].forEach((ms) => setTimeout(() => { try { map.invalidateSize(); } catch {} }, ms));
    return map;
}

/** Gọi khi tab chứa map được hiện lại (Leaflet cần invalidateSize nếu trước đó ẩn). */
export function refreshMap(container) {
    const m = container && container._nppMap;
    if (m) setTimeout(() => { try { m.invalidateSize(); } catch {} }, 60);
}
