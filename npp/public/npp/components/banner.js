import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';

/** Compact banner used at top of each view. Does NOT include the global header. */
export function banner({ title, subtitle = '', accentText = '' }) {
    return html`
        <section class="npp-view-banner">
            <div>
                <h2 class="npp-view-banner-title">${escapeHtml(title)}</h2>
                ${subtitle ? html`<p class="npp-view-banner-subtitle">${escapeHtml(subtitle)}</p>` : ''}
            </div>
            ${accentText ? html`<span class="npp-view-banner-badge">${escapeHtml(accentText)}</span>` : ''}
        </section>
    `;
}
