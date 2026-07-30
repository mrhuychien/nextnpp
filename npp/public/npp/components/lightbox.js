// Lightbox xem ảnh to — bấm vào bất kỳ <img class="npp-zoomable"> để phóng to.
// Cài listener uỷ quyền (delegated) 1 lần trên document; các view chỉ cần import
// module này (side-effect) + gắn class "npp-zoomable" cho ảnh.

import { escapeHtml } from '../lib/format.js';

let _installed = false;
let _keyHandler = null;

export function openLightbox(url, caption = '') {
    if (!url) return;
    let mount = document.getElementById('npp-lightbox');
    if (!mount) {
        mount = document.createElement('div');
        mount.id = 'npp-lightbox';
        mount.className = 'npp-lightbox';
        document.body.appendChild(mount);
    }
    mount.innerHTML =
        '<button class="npp-lightbox-close" type="button" aria-label="Đóng">✕</button>'
        + `<img src="${escapeHtml(url)}" alt="${escapeHtml(caption)}">`
        + (caption ? `<div class="npp-lightbox-cap">${escapeHtml(caption)}</div>` : '');
    mount.classList.add('npp-show');
    // Bấm nền hoặc nút ✕ để đóng; bấm chính ảnh thì KHÔNG đóng (để xem kỹ).
    mount.onclick = (e) => {
        if (e.target === mount || (e.target.closest && e.target.closest('.npp-lightbox-close'))) closeLightbox();
    };
    _keyHandler = (e) => { if (e.key === 'Escape') closeLightbox(); };
    document.addEventListener('keydown', _keyHandler);
}

export function closeLightbox() {
    const mount = document.getElementById('npp-lightbox');
    if (mount) { mount.classList.remove('npp-show'); mount.innerHTML = ''; }
    if (_keyHandler) { document.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
}

/** HTML cho nhiều nhóm ảnh (mỗi nhóm 1 nhãn + lưới thumbnail bấm xem to).
 *  groups: [{ label, images: [{url, ...}] }]. Ảnh gắn class npp-zoomable → lightbox. */
export function galleryHtml(groups) {
    const g = (groups || []).filter((x) => (x.images || []).length);
    if (!g.length) return '<div class="npp-text-muted npp-text-sm">Chưa có hình ảnh</div>';
    return g.map((grp) => `<div class="npp-mt-2">
        <div class="npp-text-sm npp-font-bold">${escapeHtml(grp.label)} (${grp.images.length})</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:6px;">
            ${grp.images.map((im) => `<img class="npp-zoomable" src="${escapeHtml(im.url)}" alt="${escapeHtml(grp.label)}" loading="lazy" style="width:100%;height:110px;object-fit:cover;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface-2);cursor:zoom-in;">`).join('')}
        </div></div>`).join('');
}

function install() {
    if (_installed) return;
    _installed = true;
    document.addEventListener('click', (e) => {
        const img = e.target && e.target.closest && e.target.closest('img.npp-zoomable');
        if (img) { e.preventDefault(); openLightbox(img.getAttribute('src'), img.getAttribute('alt') || ''); }
    });
}

install();   // side-effect khi import
