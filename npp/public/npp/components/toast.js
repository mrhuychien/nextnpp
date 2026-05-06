import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';

const ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

export function showToast(message, type = 'info', durationMs = 3500) {
    const root = document.getElementById('npp-toast-mount');
    if (!root) return;

    const el = document.createElement('div');
    el.className = `npp-toast npp-${type}`;
    el.innerHTML = html`<span>${ICONS[type] || ICONS.info}</span>&nbsp; ${escapeHtml(message)}`;
    root.appendChild(el);

    setTimeout(() => {
        el.style.animation = 'nppToastOut 0.25s ease forwards';
        setTimeout(() => el.remove(), 250);
    }, durationMs);
}

// Re-export shorthand
export const toast = {
    success: (m) => showToast(m, 'success'),
    error:   (m) => showToast(m, 'error'),
    warning: (m) => showToast(m, 'warning'),
    info:    (m) => showToast(m, 'info'),
};
