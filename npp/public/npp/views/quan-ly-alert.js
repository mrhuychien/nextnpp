import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cảnh báo']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

const TYPE_META = {
    debt_risk: { icon: '💸', label: 'Nợ + ngừng mua', badge: 'danger' },
    dormant:   { icon: '😴', label: 'Ngủ đông',       badge: 'warning' },
    declining: { icon: '📉', label: 'Tụt doanh số',   badge: 'warning' },
};

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Cảnh báo & Hành động', subtitle: 'NPP cần ưu tiên chăm sóc' })}
        ${nav('al')}
        <div id="npp-al-body"><div class="npp-skeleton" style="height:240px;"></div></div>
    `;
    try {
        const d = await api.call('npp.api.manager.insights');
        renderAlerts(d.alerts || []);
    } catch (err) {
        document.getElementById('npp-al-body').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderAlerts(alerts) {
    const root = document.getElementById('npp-al-body');
    if (!alerts.length) {
        root.innerHTML = '<div class="npp-empty"><div class="npp-empty-icon">✅</div><div class="npp-empty-title">Không có cảnh báo</div><div class="npp-text-sm">Kênh đang ổn định.</div></div>';
        return;
    }
    const byType = {};
    alerts.forEach((a) => { (byType[a.type] = byType[a.type] || []).push(a); });

    root.innerHTML = html`
        <div class="npp-kpi-grid">
            ${Object.entries(TYPE_META).map(([k, m]) => html`
                <div class="npp-kpi-card">
                    <div class="npp-kpi-label">${m.icon} ${m.label}</div>
                    <div class="npp-kpi-value ${m.badge === 'danger' ? 'danger' : 'warning'}">${(byType[k] || []).length}</div>
                </div>`).join('')}
        </div>
        <div class="npp-mt-3">
            ${alerts.map((a) => {
                const m = TYPE_META[a.type] || { icon: '🔔', label: a.type, badge: 'muted' };
                return html`<a href="#/quan-ly" class="npp-card npp-order-card" style="border-left:4px solid var(--npp-${a.level === 'danger' ? 'danger' : 'warning'});">
                    <div class="npp-flex npp-justify-between npp-items-center">
                        <strong>${m.icon} ${escapeHtml(a.customer_name)}</strong>
                        <span class="npp-badge npp-badge-${m.badge}">${m.label}</span>
                    </div>
                    <div class="npp-text-sm npp-text-muted npp-mt-2">${escapeHtml(a.territory || '')} · ${escapeHtml(a.message)}</div>
                </a>`;
            }).join('')}
        </div>
    `;
}
