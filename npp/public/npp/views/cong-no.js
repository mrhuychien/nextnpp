import { html } from '../lib/dom.js';
import { formatCurrency, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Công nợ', subtitle: 'Tổng quan dư nợ với Hoàng Giang' })}
        <div id="npp-debt-summary"><div class="npp-skeleton" style="height:120px;"></div></div>
        <div class="npp-card npp-mt-3" id="npp-aging">
            <h3 class="npp-font-bold">Phân loại theo tuổi nợ</h3>
            <div class="npp-skeleton" style="height:150px;margin-top:0.5rem;"></div>
        </div>
        <div class="npp-card npp-mt-3" id="npp-overdue">
            <h3 class="npp-font-bold">Hóa đơn quá hạn</h3>
            <div class="npp-skeleton" style="height:200px;margin-top:0.5rem;"></div>
        </div>
    `;

    try {
        const [summary, aging] = await Promise.all([
            api.cached.outstanding(),
            api.aging(),
        ]);
        renderSummary(summary);
        renderAging(aging);
        renderOverdue(summary?.overdue_invoices || []);
    } catch (err) {
        container.querySelectorAll('.npp-skeleton').forEach((s) => s.remove());
        container.innerHTML += `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderSummary(d) {
    const root = document.getElementById('npp-debt-summary');
    root.innerHTML = html`
        <div class="npp-card npp-debt-hero">
            <div class="npp-text-muted npp-text-sm">Tổng nợ hiện tại</div>
            <div class="npp-debt-total">${formatCurrency(d?.total || 0)}</div>
            <div class="npp-text-sm npp-mt-2">${d?.invoice_count || 0} hóa đơn chưa thanh toán</div>
        </div>
    `;
}

function renderAging(a) {
    const root = document.getElementById('npp-aging');
    if (!a) return root.innerHTML = '<h3 class="npp-font-bold">Phân loại theo tuổi nợ</h3>' + emptyState({ icon: '📊', title: 'Không có dữ liệu' });
    const buckets = [
        { label: '0-30 ngày',   value: a['0_30']   || 0, color: 'var(--npp-success)' },
        { label: '31-60 ngày',  value: a['31_60']  || 0, color: 'var(--npp-warning)' },
        { label: '61-90 ngày',  value: a['61_90']  || 0, color: '#f97316' },
        { label: '90+ ngày',    value: a['over_90']|| 0, color: 'var(--npp-danger)'  },
    ];
    const total = buckets.reduce((s, b) => s + b.value, 0) || 1;
    root.innerHTML = html`
        <h3 class="npp-font-bold">Phân loại theo tuổi nợ</h3>
        <div class="npp-aging-list npp-mt-3">
            ${buckets.map((b) => html`
                <div class="npp-aging-row">
                    <div class="npp-flex npp-justify-between npp-text-sm">
                        <span>${b.label}</span><strong>${formatCurrency(b.value)}</strong>
                    </div>
                    <div class="npp-aging-bar"><div style="width:${(b.value / total * 100).toFixed(1)}%;background:${b.color};"></div></div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderOverdue(list) {
    const root = document.getElementById('npp-overdue');
    if (!list.length) {
        root.innerHTML = '<h3 class="npp-font-bold">Hóa đơn quá hạn</h3>' + emptyState({ icon: '✅', title: 'Không có hóa đơn quá hạn' });
        return;
    }
    root.innerHTML = html`
        <h3 class="npp-font-bold">Hóa đơn quá hạn (${list.length})</h3>
        <div class="npp-mt-3">
            ${list.map((inv) => html`
                <a href="#/don-hang/${encodeURIComponent(inv.name)}" class="npp-card npp-order-card">
                    <div class="npp-flex npp-justify-between"><strong>${escapeHtml(inv.name)}</strong><span class="npp-badge npp-badge-danger">${inv.days_overdue} ngày</span></div>
                    <div class="npp-flex npp-justify-between npp-mt-2 npp-text-sm">
                        <span class="npp-text-muted">${formatDate(inv.due_date)}</span>
                        <strong>${formatCurrency(inv.outstanding_amount)}</strong>
                    </div>
                </a>
            `).join('')}
        </div>
    `;
}
