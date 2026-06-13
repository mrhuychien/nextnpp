import { html } from '../lib/dom.js';
import { formatCurrency, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';
import { showModal } from '../components/modal.js';

let _due = null;   // payload payment_due — dùng lại cho modal chi tiết

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Công nợ', subtitle: 'Tổng quan dư nợ với Hoàng Giang' })}
        <div id="npp-cn-policy"><div class="npp-skeleton" style="height:72px;"></div></div>
        <div class="npp-kpi-grid" id="npp-cn-kpis">
            <div class="npp-skeleton" style="height:96px;"></div>
            <div class="npp-skeleton" style="height:96px;"></div>
        </div>
        <div class="npp-card npp-mt-3" id="npp-aging">
            <h3 class="npp-font-bold">Phân loại theo tuổi nợ</h3>
            <div class="npp-skeleton" style="height:150px;margin-top:0.5rem;"></div>
        </div>
        <div class="npp-card npp-mt-3" id="npp-overdue">
            <h3 class="npp-font-bold">Hóa đơn quá hạn</h3>
            <div class="npp-skeleton" style="height:160px;margin-top:0.5rem;"></div>
        </div>
    `;

    try {
        // payment_due: tính server-side, CHỈ cho NPP đang đăng nhập (require_customer).
        const [summary, aging, due] = await Promise.all([
            api.cached.outstanding(),
            api.aging(),
            api.call('npp.api.outstanding.payment_due'),
        ]);
        _due = due;
        renderPolicy(due);
        renderKpis(summary, due);
        renderAging(aging);
        renderOverdue(summary?.overdue_invoices || []);
    } catch (err) {
        document.getElementById('npp-cn-kpis')?.remove();
        document.getElementById('npp-cn-policy').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderPolicy(due) {
    const root = document.getElementById('npp-cn-policy');
    if (!root) return;
    if (due?.policy === 'tet') {
        root.innerHTML = html`
            <div class="npp-policy-card tet">
                <div class="npp-policy-icon">🧧</div>
                <div>
                    <h4>Chính sách Tết (từ 01/11/${due.tet_year})</h4>
                    <p>Được nợ tối đa <strong>50%</strong> tổng hóa đơn từ 01/11. Phần vượt quá phải thanh toán ngay.</p>
                </div>
            </div>`;
    } else {
        const next = due?.next_payment ? ` Kỳ kế tiếp: <strong>${formatDate(due.next_payment)}</strong>.` : '';
        root.innerHTML = html`
            <div class="npp-policy-card normal">
                <div class="npp-policy-icon">📅</div>
                <div>
                    <h4>Chính sách thường</h4>
                    <p>Hóa đơn quá <strong>30 ngày</strong> kể từ ngày phát hành cần thanh toán.${next}</p>
                </div>
            </div>`;
    }
}

function renderKpis(summary, due) {
    const root = document.getElementById('npp-cn-kpis');
    if (!root) return;
    const total = summary?.total || 0;
    const required = due?.required_payment || 0;
    const sub = due?.policy === 'tet'
        ? `50% được nợ: ${formatCurrency(due.tet_allowed_debt || 0)}`
        : `${(due?.details || []).length} HĐ quá hạn`;
    root.innerHTML = html`
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Tổng công nợ</div>
            <div class="npp-kpi-value">${formatCurrency(total)}</div>
            <div class="npp-kpi-sub">${summary?.invoice_count || 0} hóa đơn chưa TT</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Cần thanh toán</div>
            <div class="npp-kpi-value warning">
                ${required > 0
                    ? `<button class="npp-cn-clickable" id="npp-cn-due-btn">${formatCurrency(required)}</button>`
                    : formatCurrency(0)}
            </div>
            <div class="npp-kpi-sub">${escapeHtml(sub)}</div>
        </div>
    `;
    document.getElementById('npp-cn-due-btn')?.addEventListener('click', showDueDetail);
}

function showDueDetail() {
    const due = _due;
    if (!due) return;
    const details = due.details || [];
    let body;

    if (due.policy === 'tet') {
        body = html`
            <div class="npp-policy-card tet" style="margin-top:0;">
                <div class="npp-policy-icon">🧧</div>
                <div><h4>Công thức</h4><p>Cần TT = Công nợ − 50% tổng HĐ từ 01/11/${due.tet_year}</p></div>
            </div>
            <div class="npp-kpi-grid">
                <div class="npp-kpi-card"><div class="npp-kpi-label">Công nợ hiện tại</div><div class="npp-kpi-value">${formatCurrency(due.current_debt)}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng HĐ từ 01/11</div><div class="npp-kpi-value">${formatCurrency(due.tet_invoice_total)}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">50% được nợ</div><div class="npp-kpi-value">${formatCurrency(due.tet_allowed_debt)}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Cần thanh toán</div><div class="npp-kpi-value warning">${formatCurrency(due.required_payment)}</div></div>
            </div>
            <div class="npp-text-sm npp-text-muted npp-mt-3">Hóa đơn từ 01/11 (${details.length}):</div>
            <table class="npp-table npp-mt-2">
                <thead><tr><th>Hóa đơn</th><th>Ngày</th><th class="npp-text-end">Giá trị</th><th class="npp-text-end">50% được nợ</th></tr></thead>
                <tbody>
                    ${details.map((d) => html`<tr>
                        <td data-label="Hóa đơn">${escapeHtml(d.name)}</td>
                        <td data-label="Ngày">${formatDate(d.posting_date)}</td>
                        <td data-label="Giá trị" class="npp-text-end">${formatCurrency(d.grand_total)}</td>
                        <td data-label="50% được nợ" class="npp-text-end">${formatCurrency(d.allowed_debt)}</td>
                    </tr>`).join('') || '<tr><td colspan="4" class="npp-text-center npp-text-muted">Không có hóa đơn</td></tr>'}
                </tbody>
            </table>
        `;
    } else {
        body = html`
            <div class="npp-policy-card normal" style="margin-top:0;">
                <div class="npp-policy-icon">📅</div>
                <div><h4>Hóa đơn quá 30 ngày</h4><p>Các hóa đơn đã quá 30 ngày kể từ ngày phát hành.</p></div>
            </div>
            <div class="npp-text-sm npp-text-muted npp-mt-3">Chi tiết (${details.length}):</div>
            <table class="npp-table npp-mt-2">
                <thead><tr><th>Hóa đơn</th><th>Ngày</th><th class="npp-text-end">Còn nợ</th><th class="npp-text-end">Quá hạn</th></tr></thead>
                <tbody>
                    ${details.map((d) => html`<tr>
                        <td data-label="Hóa đơn">${escapeHtml(d.name)}</td>
                        <td data-label="Ngày">${formatDate(d.posting_date)}</td>
                        <td data-label="Còn nợ" class="npp-text-end">${formatCurrency(d.balance)}</td>
                        <td data-label="Quá hạn" class="npp-text-end">${d.days_overdue} ngày</td>
                    </tr>`).join('') || '<tr><td colspan="4" class="npp-text-center npp-text-muted">Không có hóa đơn quá hạn</td></tr>'}
                </tbody>
            </table>
        `;
    }
    showModal({ title: 'Chi tiết cần thanh toán', body });
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
