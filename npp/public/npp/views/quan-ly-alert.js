import { html } from '../lib/dom.js';
import { formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'], ['#/ql-npp', 'npp', '🔍 Chi tiết NPP'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'],
                   ['#/ql-debt', 'db', '💰 Công nợ'], ['#/ql-tet', 'tet', '🧧 Tết'], ['#/ql-ds', 'ds', '📅 DS tháng'], ['#/ql-km', 'km', '🎁 Khuyến mại'], ['#/ql-bot', 'bot', '🥣 Hàng bột']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

const SEG_BADGE = { 'Mới': 'primary', 'Tăng trưởng': 'success', 'Ổn định': 'muted', 'Suy giảm': 'warning', 'Ngủ đông': 'warning', 'Mất': 'danger', 'Chưa mua': 'muted' };
const ACTION_BADGE = { 'Gọi thu nợ': 'danger', 'Chào tái đặt / thăm': 'warning', 'Tìm hiểu & đẩy KM': 'warning', 'Nhắc tái đặt': 'primary', 'Theo dõi': 'muted' };

function healthBar(h) {
    const color = h >= 70 ? 'var(--npp-success)' : (h >= 40 ? 'var(--npp-warning)' : 'var(--npp-danger)');
    return `<div style="display:flex;align-items:center;gap:6px;">
        <div style="flex:1;height:8px;background:var(--npp-surface-2);border-radius:4px;overflow:hidden;min-width:48px;">
            <div style="width:${h}%;height:100%;background:${color};"></div></div>
        <strong style="color:${color};font-size:.8rem;">${h}</strong></div>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Cần xử lý (Action Center)', subtitle: 'NPP ưu tiên theo GIÁ TRỊ RỦI RO' })}
        ${nav('al')}
        <div id="npp-ac-body"><div class="npp-skeleton" style="height:280px;"></div></div>
    `;
    try {
        const d = await api.call('npp.api.manager.action_center');
        renderRows(d.rows || []);
    } catch (err) {
        document.getElementById('npp-ac-body').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderRows(rows) {
    const root = document.getElementById('npp-ac-body');
    if (!rows.length) {
        root.innerHTML = '<div class="npp-empty"><div class="npp-empty-icon">✅</div><div class="npp-empty-title">Không có NPP cần xử lý</div><div class="npp-text-sm">Kênh đang khỏe.</div></div>';
        return;
    }
    const totalRisk = rows.reduce((s, r) => s + (r.risk_value || 0), 0);
    root.innerHTML = html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">NPP cần xử lý</div><div class="npp-kpi-value">${rows.length}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng giá trị rủi ro</div><div class="npp-kpi-value danger">${formatVNDShort(totalRisk)}</div><div class="npp-kpi-sub">Nợ quá hạn + doanh số đang mất</div></div>
        </div>
        <div class="npp-card npp-mt-3">
            <p class="npp-text-sm npp-text-muted">Sắp theo <strong>giá trị rủi ro</strong> (không theo số lượng) — xử lý từ trên xuống.</p>
            <table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th>Tỉnh</th><th>Phân khúc</th><th>Sức khỏe</th><th class="npp-text-end">Giá trị rủi ro</th><th>Hành động</th><th></th></tr></thead>
                <tbody>
                    ${rows.map((r) => html`<tr>
                        <td data-label="NPP"><strong>${escapeHtml(r.customer_name)}</strong>${r.overdue > 0 ? ` <span class="npp-text-sm npp-text-muted">(nợ quá hạn ${formatVNDShort(r.overdue)})</span>` : ''}</td>
                        <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                        <td data-label="Phân khúc"><span class="npp-badge npp-badge-${SEG_BADGE[r.segment] || 'muted'}">${escapeHtml(r.segment)}</span></td>
                        <td data-label="Sức khỏe" style="min-width:120px;">${healthBar(r.health)}</td>
                        <td data-label="Giá trị rủi ro" class="npp-text-end"><strong style="color:var(--npp-danger);">${formatVNDShort(r.risk_value)}</strong></td>
                        <td data-label="Hành động"><span class="npp-badge npp-badge-${ACTION_BADGE[r.action] || 'muted'}">${escapeHtml(r.action)}</span></td>
                        <td><a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-text-sm npp-link">Mở</a></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}
