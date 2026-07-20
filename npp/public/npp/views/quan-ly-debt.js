import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'], ['#/ql-npp', 'npp', '🔍 Chi tiết NPP'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'],
                   ['#/ql-debt', 'db', '💰 Công nợ'], ['#/ql-tet', 'tet', '🧧 Tết'], ['#/ql-ds', 'ds', '📅 DS tháng'], ['#/ql-km', 'km', '🎁 Khuyến mại']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

const BUCKETS = [
    ['current', 'Trong hạn', 'success'], ['d1_30', '1–30 ngày', 'muted'],
    ['d31_60', '31–60 ngày', 'warning'], ['d61_90', '61–90 ngày', 'warning'], ['over_90', '> 90 ngày', 'danger'],
];
const PLEVEL = { grace: ['npp-badge-muted', '⏳'], warn: ['npp-badge-warning', '🟠'], critical: ['npp-badge-danger', '🔴'], ok: ['npp-badge-success', '✅'] };

function policySection(p) {
    p = p || {};
    const alerts = p.alerts || [];
    return html`
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:8px;">
                <h3 class="npp-font-bold">🧾 Chính sách thanh toán — kế toán xử lý</h3>
                <span class="npp-badge ${p.action_needed ? 'npp-badge-danger' : 'npp-badge-success'}">${p.action_needed || 0} NPP cần xử lý</span>
            </div>
            ${p.action_needed ? `<div class="npp-risk-bar npp-mt-2"><span>🚨 <strong>${p.warn || 0}</strong> NPP phạt 50% thưởng · <strong>${p.critical || 0}</strong> NPP cắt thưởng</span><span>Tổng phạt thưởng ~ <strong>${formatVNDShort(p.penalty_total || 0)}</strong></span></div>` : ''}
            ${alerts.length ? `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th>Tỉnh</th><th class="npp-text-center">Trễ</th><th>Trạng thái</th><th class="npp-text-end">Nợ quá hạn</th><th class="npp-text-end">Thưởng 2%</th><th class="npp-text-end">Còn được</th></tr></thead>
                <tbody>${alerts.map((r) => { const lv = PLEVEL[r.level] || PLEVEL.grace; return `<tr>
                    <td data-label="NPP"><a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a></td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="Trễ" class="npp-text-center">${r.days_late}d</td>
                    <td data-label="Trạng thái"><span class="npp-badge ${lv[0]}">${lv[1]} ${escapeHtml(r.label)}</span></td>
                    <td data-label="Nợ quá hạn" class="npp-text-end"><strong style="color:var(--npp-danger);">${formatCurrency(r.overdue)}</strong></td>
                    <td data-label="Thưởng 2%" class="npp-text-end">${formatCurrency(r.reward_full)}</td>
                    <td data-label="Còn được" class="npp-text-end"><strong style="color:${r.reward_factor > 0 ? 'var(--npp-success)' : 'var(--npp-danger)'};">${formatCurrency(r.reward_effective)}</strong></td>
                </tr>`; }).join('')}</tbody></table></div>
                <p class="npp-text-sm npp-text-muted npp-mt-2">Thưởng 2% tính trên doanh số tháng này. Trễ 6–10 ngày (từ ngày 10) phạt 50%, trễ &gt;10 ngày cắt thưởng. Số để tham khảo — kế toán tự xử lý chi thưởng.</p>`
                : '<p class="npp-text-sm npp-text-muted npp-mt-2">✅ Không có NPP nào trễ hạn thanh toán.</p>'}
        </div>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Công nợ & Tuổi nợ', subtitle: 'Aging toàn kênh · NPP nợ quá hạn · hạn mức' })}
        ${nav('db')}
        <div id="npp-db-body"><div class="npp-skeleton" style="height:280px;"></div></div>
    `;
    try {
        const d = await api.call('npp.api.manager.receivables');
        renderDebt(d);
    } catch (err) {
        document.getElementById('npp-db-body').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderDebt(d) {
    const b = d.buckets || {};
    const t = d.totals || {};
    const top = d.top || [];
    const credit = d.credit || [];
    document.getElementById('npp-db-body').innerHTML = html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng công nợ toàn kênh</div>
                <div class="npp-kpi-value">${formatVNDShort(t.debt || 0)}</div>
                <div class="npp-kpi-sub">Số dư sổ cái (GL) · nhóm NPP</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Nợ quá hạn</div>
                <div class="npp-kpi-value danger">${formatVNDShort(t.overdue || 0)}</div>
                <div class="npp-kpi-sub">${t.npp_with_debt || 0} NPP có nợ quá hạn</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Trong hạn</div>
                <div class="npp-kpi-value">${formatVNDShort(t.current || 0)}</div></div>
        </div>

        ${policySection(d.policy)}

        <h3 class="npp-font-bold npp-mt-3">Tuổi nợ</h3>
        <div class="npp-kpi-grid npp-mt-2" style="grid-template-columns:repeat(2,1fr);">
            ${BUCKETS.map(([k, label, color]) => html`
                <div class="npp-kpi-card">
                    <div class="npp-kpi-label">${label}</div>
                    <div class="npp-kpi-value ${color === 'danger' ? 'danger' : (color === 'warning' ? 'warning' : '')}">${formatVNDShort(b[k] || 0)}</div>
                </div>`).join('')}
        </div>

        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Top NPP nợ quá hạn</h3>
            <table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th>Tỉnh</th><th class="npp-text-end">Nợ quá hạn</th></tr></thead>
                <tbody>
                    ${top.map((r) => html`<tr>
                        <td data-label="NPP"><a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a></td>
                        <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                        <td data-label="Nợ quá hạn" class="npp-text-end"><strong style="color:var(--npp-danger);">${formatCurrency(r.overdue)}</strong></td>
                    </tr>`).join('') || '<tr><td colspan="3" class="npp-text-center npp-text-muted">Không có nợ quá hạn 🎉</td></tr>'}
                </tbody>
            </table>
        </div>

        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Hạn mức tín dụng & % sử dụng</h3>
            ${credit.length ? html`<table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th class="npp-text-end">Hạn mức</th><th class="npp-text-end">Dư nợ</th><th class="npp-text-end">% dùng</th></tr></thead>
                <tbody>
                    ${credit.map((r) => html`<tr>
                        <td data-label="NPP">${r.usage_pct >= 100 ? '🔴 ' : (r.usage_pct >= 80 ? '🟠 ' : '')}<a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a></td>
                        <td data-label="Hạn mức" class="npp-text-end">${formatCurrency(r.credit_limit)}</td>
                        <td data-label="Dư nợ" class="npp-text-end">${formatCurrency(r.outstanding)}</td>
                        <td data-label="% dùng" class="npp-text-end"><strong style="color:${r.usage_pct >= 100 ? 'var(--npp-danger)' : (r.usage_pct >= 80 ? 'var(--npp-warning)' : 'var(--npp-text)')};">${r.usage_pct.toFixed(0)}%</strong></td>
                    </tr>`).join('')}
                </tbody>
            </table>` : '<p class="npp-text-sm npp-text-muted npp-mt-2">Chưa thiết lập hạn mức tín dụng (Customer Credit Limit) cho NPP nào.</p>'}
        </div>
    `;
}
