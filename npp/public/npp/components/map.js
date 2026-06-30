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

export function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
        if (!document.getElementById('npp-leaflet-css')) {
            const link = document.createElement('link');
            link.id = 'npp-leaflet-css';
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
        s.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet không khả dụng')));
        s.onerror = () => { leafletPromise = null; reject(new Error('Không tải được thư viện bản đồ (Leaflet).')); };
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

    const map = L.map(container, { scrollWheelZoom: false });
    container._nppMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map);

    const layers = [];
    for (const p of pts) {
        const color = p.active === false ? '#94a3b8' : '#10b981';   // ngừng = xám, hoạt động = xanh
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

    // Container có thể vừa hiện từ tab ẩn → ép tính lại kích thước.
    setTimeout(() => { try { map.invalidateSize(); } catch {} }, 60);
    return map;
}

/** Gọi khi tab chứa map được hiện lại (Leaflet cần invalidateSize nếu trước đó ẩn). */
export function refreshMap(container) {
    const m = container && container._nppMap;
    if (m) setTimeout(() => { try { m.invalidateSize(); } catch {} }, 60);
}
