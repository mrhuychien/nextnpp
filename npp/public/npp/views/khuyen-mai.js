import { html } from '../lib/dom.js';
import { formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Khuyến mãi', subtitle: 'Các chương trình đang dành cho bạn' })}
        <div id="npp-promos"><div class="npp-skeleton" style="height:300px;"></div></div>
    `;
    try {
        const list = await api.cached.promotions();
        renderList(list);
    } catch (err) {
        document.getElementById('npp-promos').innerHTML = `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderList(list) {
    const root = document.getElementById('npp-promos');
    if (!list || list.length === 0) {
        root.innerHTML = emptyState({ icon: '🎁', title: 'Chưa có chương trình KM nào' });
        return;
    }
    root.innerHTML = list.map((p) => {
        const daysLeft = p.valid_upto ? Math.ceil((new Date(p.valid_upto) - new Date()) / 86400000) : null;
        const ending = daysLeft !== null && daysLeft <= 7;
        return html`
            <div class="npp-card npp-promo-card ${ending ? 'npp-promo-ending' : ''}">
                <div class="npp-flex npp-justify-between npp-items-center">
                    <strong>${escapeHtml(p.title || p.name)}</strong>
                    ${ending ? `<span class="npp-badge npp-badge-warning">Sắp hết hạn</span>` : ''}
                </div>
                ${p.description ? `<p class="npp-text-sm npp-mt-2">${escapeHtml(p.description)}</p>` : ''}
                <div class="npp-flex npp-gap-3 npp-mt-3 npp-text-sm">
                    ${p.discount_percentage ? `<span><i class="fas fa-percent"></i> Giảm ${p.discount_percentage}%</span>` : ''}
                    ${p.min_qty ? `<span><i class="fas fa-cubes"></i> Tối thiểu ${p.min_qty}</span>` : ''}
                </div>
                ${(p.valid_from || p.valid_upto) ? html`
                <div class="npp-text-sm npp-text-muted npp-mt-2">
                    <i class="far fa-calendar"></i> ${p.valid_from ? formatDate(p.valid_from) : '...'}
                    → ${p.valid_upto ? formatDate(p.valid_upto) : 'không giới hạn'}
                </div>` : ''}
            </div>`;
    }).join('');
}
