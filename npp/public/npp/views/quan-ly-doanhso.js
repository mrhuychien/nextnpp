import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'], ['#/ql-npp', 'npp', '🔍 Chi tiết NPP'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'], ['#/ql-debt', 'db', '💰 Công nợ'],
                   ['#/ql-tet', 'tet', '🧧 Tết'], ['#/ql-ds', 'ds', '📅 DS tháng']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

const STK = 'position:sticky;left:0;z-index:1;min-width:170px;';

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Bảng doanh số NPP', subtitle: 'Tổng từ đầu năm tài chính + chi tiết từng tháng' })}
        ${nav('ds')}
        <div id="npp-ds-body"><div class="npp-skeleton" style="height:320px;"></div></div>
    `;
    try {
        const d = await api.call('npp.api.manager.sales_matrix');
        renderTable(d);
    } catch (err) {
        document.getElementById('npp-ds-body').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function cell(v) {
    return v ? `<td class="npp-text-end" title="${formatCurrency(v)}">${formatVNDShort(v)}</td>`
             : '<td class="npp-text-end npp-text-muted">—</td>';
}

function renderTable(d) {
    const months = d.months || [];
    const rows = d.rows || [];
    const t = d.totals || {};
    const colT = t.monthly || {};
    const body = document.getElementById('npp-ds-body');
    if (!rows.length) {
        body.innerHTML = '<div class="npp-empty"><div class="npp-empty-icon">📭</div><div class="npp-empty-title">Chưa có dữ liệu doanh số</div></div>';
        return;
    }
    const monthHead = months.map((m) => `<th class="npp-text-end" style="white-space:nowrap;">${escapeHtml(m.label)}</th>`).join('');
    body.innerHTML = html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Năm tài chính</div>
                <div class="npp-kpi-value" style="font-size:1.15rem;">${escapeHtml(String(d.fiscal_year || ''))}</div>
                <div class="npp-kpi-sub">Từ ${d.fy_start ? formatDate(d.fy_start) : ''} đến nay</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng doanh số toàn kênh (YTD)</div>
                <div class="npp-kpi-value">${formatVNDShort(t.grand_total || 0)}</div>
                <div class="npp-kpi-sub">${rows.length} NPP</div></div>
        </div>
        <div class="npp-card npp-mt-3">
            <div style="overflow-x:auto;">
            <table class="npp-table">
                <thead><tr>
                    <th style="${STK}background:var(--npp-surface-2);z-index:2;">#  NPP</th>
                    ${monthHead}
                    <th class="npp-text-end" style="white-space:nowrap;">Tổng YTD</th>
                </tr></thead>
                <tbody>
                    ${rows.map((r, i) => html`<tr>
                        <td style="${STK}background:var(--npp-surface);">
                            <strong style="color:var(--npp-text-muted);">${i + 1}.</strong>
                            <a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a></td>
                        ${months.map((m) => cell(r.monthly[m.key] || 0)).join('')}
                        <td class="npp-text-end"><strong title="${formatCurrency(r.total)}">${formatVNDShort(r.total)}</strong></td>
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr style="border-top:2px solid var(--npp-border);font-weight:800;">
                    <td style="${STK}background:var(--npp-surface-2);">Tổng cộng</td>
                    ${months.map((m) => `<td class="npp-text-end" title="${formatCurrency(colT[m.key] || 0)}">${formatVNDShort(colT[m.key] || 0)}</td>`).join('')}
                    <td class="npp-text-end"><strong title="${formatCurrency(t.grand_total || 0)}">${formatVNDShort(t.grand_total || 0)}</strong></td>
                </tr></tfoot>
            </table>
            </div>
            <p class="npp-text-sm npp-text-muted npp-mt-2">Doanh số = tổng hoá đơn (đã loại HĐ đầu kỳ). Di chuột/chạm vào ô để xem số đầy đủ; bấm tên NPP để mở chi tiết.</p>
        </div>
    `;
}
