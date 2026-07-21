import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, formatNumber, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'], ['#/ql-npp', 'npp', '🔍 Chi tiết NPP'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'], ['#/ql-debt', 'db', '💰 Công nợ'],
                   ['#/ql-tet', 'tet', '🧧 Tết'], ['#/ql-ds', 'ds', '📅 DS tháng'], ['#/ql-km', 'km', '🎁 Khuyến mại'], ['#/ql-bot', 'bot', '🥣 Hàng bột']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

const STK = 'position:sticky;left:0;z-index:1;min-width:150px;';

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Báo cáo hàng bột', subtitle: 'NPP đã nhập bao nhiêu hàng bột (BXSD/BXRM/BXMC/BXCR/SDKD/RMKD)' })}
        ${nav('bot')}
        <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:8px;">
            <h3 class="npp-font-bold">Hàng bột theo NPP</h3>
            <select id="npp-bot-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);">
                <option value="1">Tháng này</option>
                <option value="3">3 tháng</option>
                <option value="6">6 tháng</option>
                <option value="12" selected>12 tháng</option>
                <option value="24">24 tháng</option>
            </select>
        </div>
        <div id="npp-bot-body"><div class="npp-skeleton" style="height:320px;"></div></div>
    `;
    document.getElementById('npp-bot-period').addEventListener('change', (e) => load(parseInt(e.target.value, 10) || 12));
    load(12);
}

async function load(months) {
    const body = document.getElementById('npp-bot-body');
    body.innerHTML = '<div class="npp-skeleton" style="height:320px;"></div>';
    try {
        renderReport(await api.call('npp.api.manager.powder_report', { months }));
    } catch (err) {
        body.innerHTML = `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function cellQ(v) {
    return v ? `<td class="npp-text-end">${formatNumber(v)}</td>` : '<td class="npp-text-end npp-text-muted">—</td>';
}

function renderReport(d) {
    const codes = d.codes || [];
    const cnames = d.code_names || {};
    const rows = d.rows || [];
    const t = d.totals || {};
    const cq = t.by_code_qty || {};
    const head = codes.map((c) => `<th class="npp-text-end" title="${escapeHtml(cnames[c] || c)}" style="white-space:nowrap;">${escapeHtml(c)}</th>`).join('');
    document.getElementById('npp-bot-body').innerHTML = html`
        <div class="npp-kpi-grid npp-mt-3">
            <div class="npp-kpi-card"><div class="npp-kpi-label">NPP đã nhập bột</div>
                <div class="npp-kpi-value">${formatNumber(t.npp_bought || 0)}<span style="font-size:.8rem;font-weight:600;">/${formatNumber(t.npp_total || 0)}</span></div>
                <div class="npp-kpi-sub">${d.start ? formatDate(d.start) : ''} → nay</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng sản lượng</div>
                <div class="npp-kpi-value">${formatNumber(t.total_qty || 0)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng doanh số bột</div>
                <div class="npp-kpi-value">${formatVNDShort(t.total_amount || 0)}</div></div>
        </div>
        ${rows.length ? `<div class="npp-card npp-mt-3"><div style="overflow-x:auto;">
        <table class="npp-table">
            <thead><tr>
                <th style="${STK}background:var(--npp-surface-2);z-index:2;">#  NPP</th>
                ${head}
                <th class="npp-text-end" style="white-space:nowrap;">Tổng SL</th>
                <th class="npp-text-end" style="white-space:nowrap;">Doanh số</th>
            </tr></thead>
            <tbody>${rows.map((r, i) => `<tr>
                <td style="${STK}background:var(--npp-surface);"><strong style="color:var(--npp-text-muted);">${i + 1}.</strong>
                    <a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a>${r.territory ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(r.territory)}</div>` : ''}</td>
                ${codes.map((c) => cellQ(r.by_code[c] || 0)).join('')}
                <td class="npp-text-end"><strong>${formatNumber(r.total_qty)}</strong></td>
                <td class="npp-text-end"><strong title="${formatCurrency(r.total_amount)}">${formatVNDShort(r.total_amount)}</strong></td>
            </tr>`).join('')}</tbody>
            <tfoot><tr style="border-top:2px solid var(--npp-border);font-weight:800;">
                <td style="${STK}background:var(--npp-surface-2);">Tổng cộng</td>
                ${codes.map((c) => `<td class="npp-text-end">${formatNumber(cq[c] || 0)}</td>`).join('')}
                <td class="npp-text-end">${formatNumber(t.total_qty || 0)}</td>
                <td class="npp-text-end"><strong title="${formatCurrency(t.total_amount || 0)}">${formatVNDShort(t.total_amount || 0)}</strong></td>
            </tr></tfoot>
        </table></div>
        <p class="npp-text-sm npp-text-muted npp-mt-2">SL = tổng số lượng nhập (theo đơn vị bán). Doanh số = tổng tiền (đã loại HĐ đầu kỳ). Bấm tên NPP để mở chi tiết. Cột dính trái khi cuộn ngang.</p>
        </div>` : `<div class="npp-empty npp-mt-3"><div class="npp-empty-icon">📭</div><div class="npp-empty-title">Chưa NPP nào nhập hàng bột trong kỳ</div></div>`}
    `;
}
