// Bảng doanh số NPP × tháng (năm tài chính) — dùng chung cho /ql-ds và tab Tổng quan.
// Dữ liệu: npp.api.manager.sales_matrix → { months:[{key,label}], rows:[{customer,
//   customer_name, monthly:{key:val}, total}], totals:{grand_total, monthly:{key:val}},
//   fiscal_year, fy_start }.

import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, formatDate, escapeHtml } from '../lib/format.js';

const STK = 'position:sticky;left:0;z-index:1;min-width:170px;';

function cell(v) {
    return v ? `<td class="npp-text-end" title="${formatCurrency(v)}">${formatVNDShort(v)}</td>`
             : '<td class="npp-text-end npp-text-muted">—</td>';
}

/**
 * Trả về HTML chuỗi cho bảng doanh số NPP theo tháng.
 * @param d            kết quả sales_matrix
 * @param opts.showKpis  2 thẻ KPI (năm TC / tổng YTD) phía trên — mặc định true
 * @param opts.title     tiêu đề h3 trong thẻ bảng (tuỳ chọn)
 * @param opts.showMeta  dòng meta gọn (năm TC · tổng YTD · số NPP) trong thẻ — mặc định false
 */
export function salesMatrixHtml(d, opts = {}) {
    const showKpis = opts.showKpis !== false;
    const months = d.months || [];
    const rows = d.rows || [];
    const t = d.totals || {};
    const colT = t.monthly || {};
    if (!rows.length) {
        return '<div class="npp-empty"><div class="npp-empty-icon">📭</div><div class="npp-empty-title">Chưa có dữ liệu doanh số</div></div>';
    }
    const monthHead = months.map((m) => `<th class="npp-text-end" style="white-space:nowrap;">${escapeHtml(m.label)}</th>`).join('');

    const kpis = showKpis ? html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Năm tài chính</div>
                <div class="npp-kpi-value" style="font-size:1.15rem;">${escapeHtml(String(d.fiscal_year || ''))}</div>
                <div class="npp-kpi-sub">Từ ${d.fy_start ? formatDate(d.fy_start) : ''} đến nay</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng doanh số toàn kênh (YTD)</div>
                <div class="npp-kpi-value">${formatVNDShort(t.grand_total || 0)}</div>
                <div class="npp-kpi-sub">${rows.length} NPP</div></div>
        </div>` : '';
    const title = opts.title ? `<h3 class="npp-font-bold">${escapeHtml(opts.title)}</h3>` : '';
    const meta = opts.showMeta ? `<div class="npp-text-sm npp-text-muted" style="margin:.25rem 0 .5rem;">Năm tài chính ${escapeHtml(String(d.fiscal_year || ''))}${d.fy_start ? ' · từ ' + formatDate(d.fy_start) + ' đến nay' : ''} · Tổng YTD ${formatVNDShort(t.grand_total || 0)} · ${rows.length} NPP</div>` : '';

    return html`
        ${kpis}
        <div class="npp-card ${showKpis ? 'npp-mt-3' : ''}">
            ${title}${meta}
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
