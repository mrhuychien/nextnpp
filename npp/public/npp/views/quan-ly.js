import { html } from '../lib/dom.js';
import { formatCurrency, formatNumber, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showModal } from '../components/modal.js';

// ─── Dashboard QUẢN LÝ KÊNH (Phase 1: điều hành + phân tích NPP) ──────────
// Quyền do server kiểm (npp.api.manager.* → role quản lý).

let chartLib = null;
let charts = [];
let _rows = [];          // bảng NPP (cho lọc/tìm client-side)

async function loadChartLib() {
    if (chartLib) return chartLib;
    return new Promise((resolve, reject) => {
        if (window.Chart) { chartLib = window.Chart; return resolve(chartLib); }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
        s.onload  = () => { chartLib = window.Chart; resolve(chartLib); };
        s.onerror = () => reject(new Error('Không tải được Chart.js'));
        document.head.appendChild(s);
    });
}

const STATUS_BADGE = {
    'Hoạt động': 'success',
    'Ngủ đông':  'warning',
    'Chưa mua':  'muted',
};
const RANK_BADGE = { A: 'success', B: 'primary', C: 'muted' };

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Quản lý kênh', subtitle: 'Phân tích doanh số & sức khỏe NPP toàn kênh' })}
        <div class="npp-flex npp-justify-between npp-items-center">
            <h3 class="npp-font-bold">Tổng quan</h3>
            <select id="npp-ql-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);">
                <option value="1">Tháng này</option>
                <option value="3" selected>3 tháng</option>
                <option value="6">6 tháng</option>
                <option value="12">12 tháng</option>
            </select>
        </div>
        <div class="npp-kpi-grid" id="npp-ql-kpis">
            ${'<div class="npp-skeleton" style="height:92px;"></div>'.repeat(6)}
        </div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Xu hướng doanh số &amp; sản lượng</h3>
            <div class="npp-chart-wrap"><canvas id="npp-ql-trend"></canvas></div></div>
        <div class="npp-grid-2 npp-mt-3">
            <div class="npp-card"><h3 class="npp-font-bold">Cơ cấu nhóm hàng</h3>
                <div class="npp-chart-wrap"><canvas id="npp-ql-group"></canvas></div></div>
            <div class="npp-card"><h3 class="npp-font-bold">Doanh số theo tỉnh</h3>
                <div class="npp-chart-wrap"><canvas id="npp-ql-terr"></canvas></div></div>
        </div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Top 10 NPP theo doanh số</h3>
            <div class="npp-chart-wrap"><canvas id="npp-ql-top"></canvas></div></div>

        <div class="npp-card npp-mt-3">
            <h3 class="npp-font-bold">Danh sách NPP</h3>
            <div class="npp-ql-filters npp-mt-3">
                <input id="npp-ql-search" class="npp-dh-search" placeholder="Tìm NPP...">
                <select id="npp-ql-f-terr"><option value="">Tất cả tỉnh</option></select>
                <select id="npp-ql-f-rank"><option value="">Mọi hạng</option><option value="A">Hạng A</option><option value="B">Hạng B</option><option value="C">Hạng C</option></select>
                <select id="npp-ql-f-status"><option value="">Mọi trạng thái</option><option value="Hoạt động">Hoạt động</option><option value="Ngủ đông">Ngủ đông</option><option value="Chưa mua">Chưa mua</option></select>
            </div>
            <div id="npp-ql-table" class="npp-mt-3"><div class="npp-skeleton" style="height:240px;"></div></div>
        </div>
    `;

    document.getElementById('npp-ql-period').addEventListener('change', (e) => loadData(parseInt(e.target.value, 10) || 3));
    ['npp-ql-search', 'npp-ql-f-terr', 'npp-ql-f-rank', 'npp-ql-f-status'].forEach((id) =>
        document.getElementById(id).addEventListener('input', applyFilters));
    await loadData(3);
}

async function loadData(months) {
    try {
        const Chart = await loadChartLib();
        const data = await api.call('npp.api.manager.overview', { months });
        _rows = data.customers || [];
        renderKpis(data);
        fillTerritoryFilter(_rows);
        charts.forEach((c) => c.destroy());
        charts = [];
        renderCharts(Chart, data);
        applyFilters();
    } catch (err) {
        document.getElementById('npp-ql-kpis').innerHTML =
            `<div class="npp-empty" style="grid-column:1/-1;"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
        document.getElementById('npp-ql-table').innerHTML = '';
    }
}

function pct(v) {
    if (v === null || v === undefined) return '<span class="npp-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--npp-success)' : 'var(--npp-danger)'};font-weight:800;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

function renderKpis(d) {
    const t = d.totals || {};
    const g = d.growth || {};
    document.getElementById('npp-ql-kpis').innerHTML = html`
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Doanh số (${d.months} tháng)</div>
            <div class="npp-kpi-value">${formatCurrency(t.revenue || 0)}</div>
            <div class="npp-kpi-sub">${pct(g.growth_pct)} kỳ trước · ${pct(g.yoy_pct)} YoY</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Dự báo tháng (run-rate)</div>
            <div class="npp-kpi-value">${formatCurrency(t.run_rate || 0)}</div>
            <div class="npp-kpi-sub">Ước tính cuối tháng này</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Sản lượng</div>
            <div class="npp-kpi-value">${formatNumber(t.qty || 0)} <span style="font-size:.8rem;font-weight:600;">thùng</span></div>
            <div class="npp-kpi-sub">${formatNumber(t.orders || 0)} đơn · TB/đơn ${formatCurrency(t.aov || 0)}</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">NPP hoạt động</div>
            <div class="npp-kpi-value">${formatNumber(t.active || 0)}<span style="font-size:.8rem;font-weight:600;">/${formatNumber(t.npp_count || 0)}</span></div>
            <div class="npp-kpi-sub">😴 ${formatNumber(t.dormant || 0)} ngủ đông · 🆕 ${formatNumber(t.new || 0)} mới</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Tổng công nợ</div>
            <div class="npp-kpi-value danger">${formatCurrency(t.debt || 0)}</div>
            <div class="npp-kpi-sub">DSO ~${Math.round(t.dso || 0)} ngày</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Cần thanh toán</div>
            <div class="npp-kpi-value warning">${formatCurrency(t.required_payment || 0)}</div>
            <div class="npp-kpi-sub">Theo chính sách ${d.policy === 'tet' ? 'Tết' : 'thường'}</div>
        </div>
    `;
}

function renderCharts(Chart, d) {
    const m = d.monthly || [];
    charts.push(new Chart(document.getElementById('npp-ql-trend'), {
        data: {
            labels: m.map((x) => x.month),
            datasets: [
                { type: 'bar',  label: 'Số thùng', data: m.map((x) => x.qty),     backgroundColor: 'rgba(16,185,129,0.45)', yAxisID: 'y1', order: 2 },
                { type: 'line', label: 'Doanh số', data: m.map((x) => x.revenue), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)', tension: 0.3, fill: true, yAxisID: 'y', order: 1 },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === 'y' ? `Doanh số: ${formatCurrency(c.parsed.y)}` : `Thùng: ${formatNumber(c.parsed.y)}` } } },
            scales: { y: { position: 'left', ticks: { callback: (v) => formatCurrency(v) } }, y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => formatNumber(v) } } },
        },
    }));

    const grp = d.by_group || [];
    charts.push(new Chart(document.getElementById('npp-ql-group'), {
        type: 'doughnut',
        data: { labels: grp.map((x) => x.item_group), datasets: [{ data: grp.map((x) => x.revenue), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${formatCurrency(c.parsed)}` } } } },
    }));

    const terr = d.by_territory || [];
    charts.push(new Chart(document.getElementById('npp-ql-terr'), {
        type: 'bar',
        data: { labels: terr.map((x) => x.territory), datasets: [{ label: 'Doanh số', data: terr.map((x) => x.revenue), backgroundColor: '#8b5cf6' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => formatCurrency(v) } } } },
    }));

    const top = [...(d.customers || [])].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    charts.push(new Chart(document.getElementById('npp-ql-top'), {
        type: 'bar',
        data: { labels: top.map((x) => x.customer_name), datasets: [{ label: 'Doanh số', data: top.map((x) => x.revenue), backgroundColor: '#3b82f6' }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.parsed.x) } } }, scales: { x: { ticks: { callback: (v) => formatCurrency(v) } } } },
    }));
}

function fillTerritoryFilter(rows) {
    const sel = document.getElementById('npp-ql-f-terr');
    if (!sel) return;
    const terrs = [...new Set(rows.map((r) => r.territory).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Tất cả tỉnh</option>' + terrs.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}

function applyFilters() {
    const q = (document.getElementById('npp-ql-search').value || '').toLowerCase().trim();
    const fTerr = document.getElementById('npp-ql-f-terr').value;
    const fRank = document.getElementById('npp-ql-f-rank').value;
    const fStatus = document.getElementById('npp-ql-f-status').value;
    let rows = _rows.filter((r) =>
        (!q || (r.customer_name || '').toLowerCase().includes(q) || (r.customer || '').toLowerCase().includes(q)) &&
        (!fTerr || r.territory === fTerr) &&
        (!fRank || r.rank === fRank) &&
        (!fStatus || r.status === fStatus));
    rows = rows.sort((a, b) => b.revenue - a.revenue);
    renderTable(rows);
}

function renderTable(rows) {
    const root = document.getElementById('npp-ql-table');
    if (!root) return;
    if (!rows.length) { root.innerHTML = '<div class="npp-text-muted npp-text-center" style="padding:1rem;">Không có NPP phù hợp</div>'; return; }
    root.innerHTML = html`
        <table class="npp-table">
            <thead><tr>
                <th>NPP</th><th>Tỉnh</th><th>Hạng</th>
                <th class="npp-text-end">Doanh số</th><th class="npp-text-end">Công nợ</th><th class="npp-text-end">Cần TT</th>
                <th>Trạng thái</th><th></th>
            </tr></thead>
            <tbody>
                ${rows.map((r) => html`<tr>
                    <td data-label="NPP"><strong>${escapeHtml(r.customer_name)}</strong>${r.is_new ? ' <span class="npp-badge npp-badge-primary">Mới</span>' : ''}<div class="npp-text-sm npp-text-muted">${escapeHtml(r.customer)}</div></td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="Hạng"><span class="npp-badge npp-badge-${RANK_BADGE[r.rank] || 'muted'}">${r.rank}</span></td>
                    <td data-label="Doanh số" class="npp-text-end">${formatCurrency(r.revenue)}</td>
                    <td data-label="Công nợ" class="npp-text-end">${formatCurrency(r.debt)}</td>
                    <td data-label="Cần TT" class="npp-text-end" style="color:${r.required_payment > 0 ? 'var(--npp-warning)' : 'var(--npp-text-3)'};font-weight:700;">${formatCurrency(r.required_payment)}</td>
                    <td data-label="Trạng thái"><span class="npp-badge npp-badge-${STATUS_BADGE[r.status] || 'muted'}">${escapeHtml(r.status)}</span></td>
                    <td><button class="npp-btn-primary npp-ql-view" data-c="${escapeHtml(r.customer)}" data-n="${escapeHtml(r.customer_name)}" type="button" style="padding:6px 12px;font-size:.8rem;">Xem</button></td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
    root.querySelectorAll('.npp-ql-view').forEach((b) => b.addEventListener('click', () => showDetail(b.dataset.c, b.dataset.n)));
}

async function showDetail(customer, name) {
    showModal({ title: `NPP: ${escapeHtml(name)}`, body: '<div class="npp-skeleton" style="height:220px;"></div>' });
    const mount = document.querySelector('#npp-modal-mount .npp-modal-body');
    try {
        const [kpi, due, orders] = await Promise.all([
            api.call('npp.api.analytics.kpi', { months: 12, customer }),
            api.call('npp.api.outstanding.payment_due', { customer }),
            api.list('Sales Invoice', {
                fields: ['name', 'posting_date', 'grand_total', 'outstanding_amount', 'status'],
                filters: [['customer', '=', customer], ['docstatus', '=', 1]],
                order_by: 'posting_date desc', limit: 10,
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
