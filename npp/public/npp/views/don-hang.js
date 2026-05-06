import { html } from '../lib/dom.js';
import { formatCurrency, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { showToast } from '../components/toast.js';
import { showLoading, hideLoading } from '../components/loading.js';
import { emptyState } from '../components/empty-state.js';
import { SI_FIELDS, DELIVERY_STATUS, DELIVERY_STATUS_LABELS } from './_config.js';

const STATUS_LABELS = {
    'Draft':     { label: 'Nháp',     color: 'warning' },
    'Submitted': { label: 'Đã gửi',   color: 'success' },
    'Paid':      { label: 'Đã thanh toán', color: 'success' },
    'Overdue':   { label: 'Quá hạn',  color: 'danger'  },
    'Cancelled': { label: 'Đã hủy',   color: 'muted'   },
};

export async function render({ container, params, query }) {
    if (params?.name) return renderDetail({ container, name: params.name, query });
    return renderList({ container, query });
}

// ─── List view ─────────────────────────────────────────────────────────
async function renderList({ container, query }) {
    const filters = buildFilters(query);
    container.innerHTML = html`
        <div class="npp-dh-list-filters">
            <select id="npp-status">
                <option value="">Tất cả trạng thái</option>
                <option value="Draft">Nháp</option>
                <option value="Submitted">Đã gửi</option>
                <option value="Paid">Đã thanh toán</option>
                <option value="Overdue">Quá hạn</option>
            </select>
            <input type="date" id="npp-from" placeholder="Từ">
            <input type="date" id="npp-to" placeholder="Đến">
        </div>
        <div id="npp-orders"><div class="npp-skeleton" style="height:300px;"></div></div>
    `;

    document.getElementById('npp-status').value = query.status || '';
    document.getElementById('npp-from').value   = query.from   || '';
    document.getElementById('npp-to').value     = query.to     || '';

    ['npp-status', 'npp-from', 'npp-to'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => {
            const q = {
                status: document.getElementById('npp-status').value,
                from:   document.getElementById('npp-from').value,
                to:     document.getElementById('npp-to').value,
            };
            const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
            location.hash = '#/don-hang' + (qs ? '?' + qs : '');
        });
    });

    try {
        const ctx = window.NPP_CONTEXT || {};
        const list = await api.list('Sales Invoice', {
            fields: [
                'name', 'posting_date', 'grand_total', 'status', 'docstatus',
                'customer', 'customer_name',
                SI_FIELDS.delivery_status,
                SI_FIELDS.shipping_type,
                SI_FIELDS.chuyen_xe,
            ],
            filters: [['customer', '=', ctx.customer], ...filters],
            order_by: 'posting_date desc, creation desc',
            limit: 50,
        });
        renderOrderList(list);
    } catch (err) {
        document.getElementById('npp-orders').innerHTML = `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function buildFilters(query) {
    const f = [];
    if (query.status) f.push(['status', '=', query.status]);
    if (query.from)   f.push(['posting_date', '>=', query.from]);
    if (query.to)     f.push(['posting_date', '<=', query.to]);
    return f;
}

function renderOrderList(list) {
    const root = document.getElementById('npp-orders');
    if (!list || list.length === 0) {
        root.innerHTML = emptyState({ icon: '📭', title: 'Chưa có đơn nào' });
        return;
    }
    root.innerHTML = list.map((inv) => {
        // Ưu tiên trạng thái vận chuyển — nếu chưa có thì fallback sang docstatus
        const deliveryStatus = inv[SI_FIELDS.delivery_status];
        const statusLabel = deliveryStatus ? DELIVERY_STATUS_LABELS[deliveryStatus] : null;

        let badgeHtml;
        if (statusLabel) {
            badgeHtml = `<span class="npp-badge npp-badge-${statusLabel.color}">${statusLabel.icon} ${escapeHtml(deliveryStatus)}</span>`;
        } else if (inv.docstatus === 0) {
            badgeHtml = `<span class="npp-badge npp-badge-warning">📝 Nháp</span>`;
        } else {
            const fb = STATUS_LABELS[inv.status] || { label: inv.status, color: 'muted' };
            badgeHtml = `<span class="npp-badge npp-badge-${fb.color}">${escapeHtml(fb.label)}</span>`;
        }

        const tripBadge = inv[SI_FIELDS.chuyen_xe]
            ? `<span class="npp-text-sm npp-text-muted">&nbsp;<i class="fas fa-truck"></i> ${escapeHtml(inv[SI_FIELDS.chuyen_xe])}</span>`
            : '';

        return html`
            <a href="#/don-hang/${encodeURIComponent(inv.name)}" class="npp-card npp-order-card">
                <div class="npp-flex npp-justify-between npp-items-center">
                    <strong>${escapeHtml(inv.name)}</strong>
                    ${badgeHtml}
                </div>
                <div class="npp-flex npp-justify-between npp-mt-2 npp-text-sm">
                    <span class="npp-text-muted">${formatDate(inv.posting_date)}${tripBadge}</span>
                    <strong>${formatCurrency(inv.grand_total)}</strong>
                </div>
            </a>`;
    }).join('');
}

// ─── Detail view ───────────────────────────────────────────────────────
async function renderDetail({ container, name, query }) {
    container.innerHTML = '<div class="npp-skeleton" style="height:400px;"></div>';
    try {
        const inv = await api.get('Sales Invoice', name);
        const s = STATUS_LABELS[inv.status] || { label: inv.status, color: 'muted' };

        container.innerHTML = html`
            <div class="npp-card">
                <div class="npp-flex npp-justify-between npp-items-center">
                    <h2 class="npp-text-lg npp-font-bold">${escapeHtml(inv.name)}</h2>
                    <span class="npp-badge npp-badge-${s.color}">${s.label}</span>
                </div>
                <div class="npp-text-sm npp-text-muted npp-mt-2">${formatDate(inv.posting_date)}</div>

                <table class="npp-table npp-mt-4">
                    <thead><tr><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Tiền</th></tr></thead>
                    <tbody>
                        ${inv.items.map((it) => html`<tr>
                            <td data-label="SP">${escapeHtml(it.item_name || it.item_code)}</td>
                            <td data-label="SL">${it.qty} ${it.uom || ''}</td>
                            <td data-label="Đơn giá">${formatCurrency(it.rate)}</td>
                            <td data-label="Tiền">${formatCurrency(it.amount)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>

                <div class="npp-card npp-mt-3 npp-flex npp-justify-between">
                    <strong>Tổng tiền:</strong>
                    <strong style="color:var(--npp-season-1);">${formatCurrency(inv.grand_total)}</strong>
                </div>

                ${renderShippingSection(inv)}
                ${renderNoteSection(inv)}

                ${inv.docstatus === 0 ? html`
                <div class="npp-flex npp-gap-2 npp-mt-4">
                    <button class="npp-btn-primary" id="npp-back-list" type="button"><i class="fas fa-arrow-left"></i> Quay lại</button>
                    <button class="npp-btn-danger" id="npp-delete" type="button"><i class="fas fa-trash"></i> Xóa</button>
                </div>` : html`
                <div class="npp-mt-4">
                    <button class="npp-btn-primary" id="npp-back-list" type="button"><i class="fas fa-arrow-left"></i> Quay lại danh sách</button>
                </div>`}
            </div>
        `;

        document.getElementById('npp-back-list').addEventListener('click', () => location.hash = '#/don-hang');
        if (inv.docstatus === 0) {
            document.getElementById('npp-delete').addEventListener('click', () => deleteOrder(inv.name));
        }
    } catch (err) {
        container.innerHTML = `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderShippingSection(inv) {
    const fields = [
        { label: 'Hình thức',    value: inv[SI_FIELDS.shipping_type] },
        { label: 'Chuyến xe',    value: inv[SI_FIELDS.chuyen_xe] },
        { label: 'Xe (biển số)', value: inv[SI_FIELDS.vehicle] },
        { label: 'Tên lái xe',   value: inv[SI_FIELDS.driver] },
        {
            label: 'Điện thoại',
            value: inv[SI_FIELDS.driver_phone],
            renderer: (v) => `<a href="tel:${escapeHtml(v)}" class="npp-link">${escapeHtml(v)}</a>`,
        },
    ].filter((f) => f.value);

    if (fields.length === 0) return '';

    const status = inv[SI_FIELDS.delivery_status] || 'Chờ xử lý';
    const statusInfo = DELIVERY_STATUS_LABELS[status] || { color: 'muted', icon: '❓' };

    return html`
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center">
                <h4 class="npp-font-bold"><i class="fas fa-truck"></i> Vận chuyển</h4>
                <span class="npp-badge npp-badge-${statusInfo.color}">
                    ${statusInfo.icon} ${escapeHtml(status)}
                </span>
            </div>
            <dl class="npp-detail-list npp-mt-3">
                ${fields.map((f) => html`
                    <dt>${escapeHtml(f.label)}</dt>
                    <dd>${f.renderer ? f.renderer(f.value) : escapeHtml(f.value)}</dd>
                `).join('')}
            </dl>
        </div>
    `;
}

function renderNoteSection(inv) {
    const noteNpp = inv[SI_FIELDS.note_npp];
    const noteInternal = inv[SI_FIELDS.note_internal];
    if (!noteNpp && !noteInternal) return '';
    return html`
        <div class="npp-card npp-mt-3">
            <h4 class="npp-font-bold"><i class="fas fa-sticky-note"></i> Ghi chú</h4>
            ${noteNpp ? html`
                <div class="npp-mt-2">
                    <div class="npp-text-sm npp-text-muted">Từ NPP:</div>
                    <div class="npp-note-block npp-note-npp">${escapeHtml(noteNpp)}</div>
                </div>` : ''}
            ${noteInternal ? html`
                <div class="npp-mt-2">
                    <div class="npp-text-sm npp-text-muted">Nội bộ:</div>
                    <div class="npp-note-block npp-note-internal">${escapeHtml(noteInternal)}</div>
                </div>` : ''}
        </div>
    `;
}

async function deleteOrder(name) {
    if (!confirm('Xóa đơn hàng này?')) return;
    showLoading('Đang xóa...');
    try {
        await api.remove('Sales Invoice', name);
        hideLoading();
        showToast('Đã xóa đơn', 'success');
        location.hash = '#/don-hang';
    } catch (err) {
        hideLoading();
        showToast('Lỗi: ' + err.message, 'error');
    }
}
