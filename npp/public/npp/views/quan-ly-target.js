import { html } from '../lib/dom.js';
import { formatCurrency, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';

let _months = 1;

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

function attBadge(pct) {
    if (pct === null || pct === undefined) return '<span class="npp-text-muted">— chưa đặt</span>';
    const color = pct >= 100 ? 'var(--npp-success)' : (pct >= 70 ? 'var(--npp-warning)' : 'var(--npp-danger)');
    return `<strong style="color:${color};">${pct.toFixed(0)}%</strong>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Mục tiêu doanh số', subtitle: '% hoàn thành theo NPP' })}
        ${nav('tg')}
        <div class="npp-flex npp-justify-between npp-items-center">
            <h3 class="npp-font-bold">Mục tiêu vs Thực tế</h3>
            <select id="npp-tg-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);">
                <option value="1" selected>Tháng này</option><option value="3">3 tháng</option><option value="6">6 tháng</option><option value="12">12 tháng</option>
            </select>
        </div>
        <div class="npp-kpi-grid" id="npp-tg-totals">
            <div class="npp-skeleton" style="height:90px;"></div><div class="npp-skeleton" style="height:90px;"></div><div class="npp-skeleton" style="height:90px;"></div>
        </div>
        <div class="npp-card npp-mt-3">
            <p class="npp-text-sm npp-text-muted">Nhập <strong>mục tiêu doanh số/tháng</strong> cho từng NPP rồi bấm Lưu. % hoàn thành = doanh số kỳ ÷ (mục tiêu tháng × số tháng).</p>
            <div id="npp-tg-table" class="npp-mt-3"><div class="npp-skeleton" style="height:240px;"></div></div>
        </div>
    `;
    document.getElementById('npp-tg-period').addEventListener('change', (e) => load(parseInt(e.target.value, 10) || 1));
    await load(1);
}

async function load(months) {
    _months = months;
    try {
        const d = await api.call('npp.api.manager.targets', { months });
        const t = d.totals || {};
        document.getElementById('npp-tg-totals').innerHTML = html`
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng mục tiêu</div><div class="npp-kpi-value">${formatCurrency(t.target || 0)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Doanh số thực</div><div class="npp-kpi-value">${formatCurrency(t.revenue || 0)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">% hoàn thành</div><div class="npp-kpi-value">${t.attainment_pct === null || t.attainment_pct === undefined ? '—' : t.attainment_pct.toFixed(0) + '%'}</div></div>
        `;
        renderTable(d.rows || []);
    } catch (err) {
        document.getElementById('npp-tg-table').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderTable(rows) {
    const root = document.getElementById('npp-tg-table');
    root.innerHTML = html`
        <table class="npp-table">
            <thead><tr><th>NPP</th><th>Tỉnh</th><th>Mục tiêu/tháng</th><th class="npp-text-end">Doanh số kỳ</th><th class="npp-text-end">% đạt</th></tr></thead>
            <tbody>
                ${rows.map((r) => html`<tr>
                    <td data-label="NPP"><strong>${escapeHtml(r.customer_name)}</strong></td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="Mục tiêu/tháng">
                        <input type="number" min="0" class="npp-tg-input" data-c="${escapeHtml(r.customer)}" value="${r.monthly_target || 0}"
                               style="width:130px;padding:6px 8px;border:1px solid var(--npp-border);border-radius:8px;background:var(--npp-surface);color:var(--npp-text);">
                        <button class="npp-tg-save" data-c="${escapeHtml(r.customer)}" type="button" style="padding:6px 10px;font-size:.8rem;border:none;border-radius:8px;background:var(--npp-season-grad);color:#fff;font-weight:700;cursor:pointer;">Lưu</button>
                    </td>
                    <td data-label="Doanh số" class="npp-text-end">${formatCurrency(r.revenue)}</td>
                    <td data-label="% đạt" class="npp-text-end">${attBadge(r.attainment_pct)}</td>
                </tr>`).join('') || '<tr><td colspan="5" class="npp-text-center npp-text-muted">Không có NPP</td></tr>'}
            </tbody>
        </table>
    `;
    root.querySelectorAll('.npp-tg-save').forEach((b) => b.addEventListener('click', () => saveTarget(b.dataset.c, root)));
}

async function saveTarget(customer, root) {
    const input = root.querySelector(`.npp-tg-input[data-c="${CSS.escape(customer)}"]`);
    const amount = parseFloat(input.value) || 0;
    try {
        await api.call('npp.api.manager.set_target', { customer, amount });
        showToast('Đã lưu mục tiêu', 'success');
        load(_months);   // tải lại để cập nhật % đạt + tổng
    } catch (err) {
        showToast('Lỗi lưu: ' + (err.message || ''), 'error');
    }
}
