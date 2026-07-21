import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { salesMatrixHtml } from '../components/sales-matrix.js';

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'], ['#/ql-npp', 'npp', '🔍 Chi tiết NPP'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'], ['#/ql-debt', 'db', '💰 Công nợ'],
                   ['#/ql-tet', 'tet', '🧧 Tết'], ['#/ql-ds', 'ds', '📅 DS tháng'], ['#/ql-km', 'km', '🎁 Khuyến mại'], ['#/ql-bot', 'bot', '🥣 Hàng bột']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Bảng doanh số NPP', subtitle: 'Tổng từ đầu năm tài chính + chi tiết từng tháng' })}
        ${nav('ds')}
        <div id="npp-ds-body"><div class="npp-skeleton" style="height:320px;"></div></div>
    `;
    try {
        const d = await api.call('npp.api.manager.sales_matrix');
        document.getElementById('npp-ds-body').innerHTML = salesMatrixHtml(d, { showKpis: true });
    } catch (err) {
        document.getElementById('npp-ds-body').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}
