import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';

export function emptyState({ icon = '📭', title = 'Không có dữ liệu', message = '' } = {}) {
    return html`
        <div class="npp-empty">
            <div class="npp-empty-icon">${icon}</div>
            <div class="npp-empty-title">${escapeHtml(title)}</div>
            ${message ? html`<div class="npp-text-sm">${escapeHtml(message)}</div>` : ''}
        </div>
    `;
}
