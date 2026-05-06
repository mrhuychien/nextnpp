import { html } from '../lib/dom.js';

let closeHandler = null;

export function showModal({ title, body, footer = '' }) {
    const root = document.getElementById('npp-modal-mount');
    if (!root) return;
    root.innerHTML = html`
        <div class="npp-modal-content" role="dialog" aria-modal="true">
            <div class="npp-modal-header npp-flex npp-items-center npp-justify-between">
                <h3 class="npp-text-lg npp-font-bold">${title}</h3>
                <button class="npp-icon-btn" id="npp-modal-close" type="button" aria-label="Đóng">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="npp-modal-body npp-mt-3">${body}</div>
            ${footer ? html`<div class="npp-modal-footer npp-mt-4">${footer}</div>` : ''}
        </div>
    `;
    root.classList.add('npp-show');
    document.getElementById('npp-modal-close').onclick = closeModal;
    root.onclick = (e) => { if (e.target === root) closeModal(); };
}

export function setModalCloseHandler(fn) { closeHandler = fn; }

export function closeModal() {
    const root = document.getElementById('npp-modal-mount');
    if (!root) return;
    root.classList.remove('npp-show');
    root.innerHTML = '';
    if (closeHandler) { try { closeHandler(); } catch {} closeHandler = null; }
}
