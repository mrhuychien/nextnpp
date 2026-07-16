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

function install() {
    if (_installed) return;
    _installed = true;
    document.addEventListener('click', (e) => {
        const img = e.target && e.target.closest && e.target.closest('img.npp-zoomable');
        if (img) { e.preventDefault(); openLightbox(img.getAttribute('src'), img.getAttribute('alt') || ''); }
    });
}

install();   // side-effect khi import
