import { html } from '../lib/dom.js';
import { formatCurrency, formatNumber, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showModal } from '../components/modal.js';

// View cho QUẢN LÝ KÊNH: tổng quan toàn bộ NPP + xem chi tiết 1 NPP.
// Quyền do server kiểm (npp.api.manager.* gọi _guard → role quản lý).
let _rows = [];

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Quản lý NPP', subtitle: 'Tổng quan toàn bộ nhà phân phối' })}
        <div class="npp-kpi-grid" id="npp-ql-totals">
            <div class="npp-skeleton" style="height:90px;"></div>
            <div class="npp-skeleton" style="height:90px;"></div>
            <div class="npp-skeleton" style="height:90px;"></div>
        </div>
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center">
                <h3 class="npp-font-bold">Danh sách NPP</h3>
                <input id="npp-ql-search" class="npp-dh-search" placeholder="Tìm NPP..." style="max-width:220px;">
            </div>
            <div id="npp-ql-table" class="npp-mt-3"><div class="npp-skeleton" style="height:240px;"></div></div>
        </div>
    `;

    try {
        const data = await api.call('npp.api.manager.overview', { months: 3 });
        _rows = data.customers || [];
        renderTotals(data);
        renderTable(_rows);
        document.getElementById('npp-ql-search').addEventListener('input', (e) => {
            const t = e.target.value.toLowerCase().trim();
            renderTable(!t ? _rows : _rows.filter((r) =>
                (r.customer_name || '').toLowerCase().includes(t) ||
                (r.customer || '').toLowerCase().includes(t)));
        });
    } catch (err) {
        document.getElementById('npp-ql-totals')?.remove();
        document.getElementById('npp-ql-table').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderTotals(d) {
    const t = d.totals || {};
    const root = document.getElementById('npp-ql-totals');
    if (!root) return;
    root.innerHTML = html`
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Số NPP</div>
            <div class="npp-kpi-value">${formatNumber(t.count || 0)}</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Doanh số (${d.months} tháng)</div>
            <div class="npp-kpi-value">${formatCurrency(t.revenue || 0)}</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Tổng công nợ</div>
            <div class="npp-kpi-value danger">${formatCurrency(t.debt || 0)}</div>
            <div class="npp-kpi-sub">Cần TT: ${formatCurrency(t.required_payment || 0)}</div>
        </div>
    `;
}

function renderTable(rows) {
    const root = document.getElementById('npp-ql-table');
    if (!root) return;
    if (!rows.length) {
        root.innerHTML = '<div class="npp-text-muted npp-text-center" style="padding:1rem;">Không có NPP phù hợp</div>';
        return;
    }
    root.innerHTML = html`
        <table class="npp-table">
            <thead><tr>
                <th>NPP</th>
                <th class="npp-text-end">Doanh số</th>
                <th class="npp-text-end">Công nợ</th>
                <th class="npp-text-end">Cần TT</th>
                <th>Đơn cuối</th>
                <th></th>
            </tr></thead>
            <tbody>
                ${rows.map((r) => html`<tr>
                    <td data-label="NPP">
                        <strong>${escapeHtml(r.customer_name)}</strong>
                        <div class="npp-text-sm npp-text-muted">${escapeHtml(r.customer)}</div>
                    </td>
                    <td data-label="Doanh số" class="npp-text-end">${formatCurrency(r.revenue)}</td>
                    <td data-label="Công nợ" class="npp-text-end">${formatCurrency(r.debt)}</td>
                    <td data-label="Cần TT" class="npp-text-end" style="color:${r.required_payment > 0 ? 'var(--npp-warning)' : 'var(--npp-text-3)'};font-weight:700;">${formatCurrency(r.required_payment)}</td>
                    <td data-label="Đơn cuối">${r.last_order ? formatDate(r.last_order) : '—'}</td>
                    <td><button class="npp-btn-primary npp-ql-view" data-c="${escapeHtml(r.customer)}" data-n="${escapeHtml(r.customer_name)}" type="button" style="padding:6px 12px;font-size:.8rem;">Xem</button></td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
    root.querySelectorAll('.npp-ql-view').forEach((b) => {
        b.addEventListener('click', () => showDetail(b.dataset.c, b.dataset.n));
    });
}

async function showDetail(customer, name) {
    showModal({ title: `NPP: ${escapeHtml(name)}`, body: '<div class="npp-skeleton" style="height:220px;"></div>' });
    const mount = document.querySelector('#npp-modal-mount .npp-modal-body');
    try {
        // Drill-down tái dùng đúng các endpoint self-view, truyền customer=<NPP>
        // (server cho phép vì user là quản lý — require_customer(customer)).
        const [kpi, due, orders] = await Promise.all([
            api.call('npp.api.analytics.kpi', { months: 12, customer }),
            api.call('npp.api.outstanding.payment_due', { customer }),
            api.list('Sales Invoice', {
                fields: ['name', 'posting_date', 'grand_total', 'outstanding_amount', 'status'],
                filters: [['customer', '=', customer], ['docstatus', '=', 1]],
                order_by: 'posting_date desc',
                limit: 10,
            }),
        ]);
        if (!mount) return;
        mount.innerHTML = html`
            <div class="npp-kpi-grid">
                <div class="npp-kpi-card"><div class="npp-kpi-label">Doanh số 12 tháng</div><div class="npp-kpi-value">${formatCurrency(kpi.revenue)}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Sản lượng</div><div class="npp-kpi-value">${formatNumber(kpi.qty)} <span style="font-size:.8rem;font-weight:600;">thùng</span></div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Công nợ</div><div class="npp-kpi-value danger">${formatCurrency(due.current_debt)}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Cần thanh toán</div><div class="npp-kpi-value warning">${formatCurrency(due.required_payment)}</div></div>
            </div>
            <div class="npp-text-sm npp-text-muted npp-mt-3">10 đơn gần nhất:</div>
            <table class="npp-table npp-mt-2">
                <thead><tr><th>Hóa đơn</th><th>Ngày</th><th class="npp-text-end">Tổng</th><th class="npp-text-end">Còn nợ</th></tr></thead>
                <tbody>
                    ${(orders || []).map((o) => html`<tr>
                        <td data-label="Hóa đơn">${escapeHtml(o.name)}</td>
                        <td data-label="Ngày">${formatDate(o.posting_date)}</td>
                        <td data-label="Tổng" class="npp-text-end">${formatCurrency(o.grand_total)}</td>
                        <td data-label="Còn nợ" class="npp-text-end">${formatCurrency(o.outstanding_amount)}</td>
                    </tr>`).join('') || '<tr><td colspan="4" class="npp-text-center npp-text-muted">Chưa có đơn</td></tr>'}
                </tbody>
            </table>
        `;
    } catch (err) {
        if (mount) mount.innerHTML = `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}
