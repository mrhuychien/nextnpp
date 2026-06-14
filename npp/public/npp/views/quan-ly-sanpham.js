import { html } from '../lib/dom.js';
import { formatCurrency, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

let chartLib = null, charts = [], _groups = [], _months = 3, _top = [];
const _skuSort = { key: 'revenue', dir: -1 };

async function loadChartLib() {
    if (chartLib) return chartLib;
    return new Promise((resolve, reject) => {
        if (window.Chart) { chartLib = window.Chart; return resolve(chartLib); }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
        s.onload = () => { chartLib = window.Chart; resolve(chartLib); };
        s.onerror = () => reject(new Error('Không tải được Chart.js'));
        document.head.appendChild(s);
    });
}

export function managerNav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Phân tích sản phẩm', subtitle: 'Toàn kênh NPP' })}
        ${managerNav('sp')}
        <div class="npp-flex npp-justify-between npp-items-center">
            <h3 class="npp-font-bold">Sản phẩm</h3>
            <select id="npp-sp-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);">
                <option value="3" selected>3 tháng</option><option value="6">6 tháng</option><option value="12">12 tháng</option>
            </select>
        </div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Top 10 sản phẩm (doanh số)</h3>
            <div class="npp-chart-wrap"><canvas id="npp-sp-top"></canvas></div></div>
        <div class="npp-grid-2 npp-mt-3">
            <div class="npp-card"><h3 class="npp-font-bold">📈 Tăng mạnh</h3><div id="npp-sp-up" class="npp-mt-2"></div></div>
            <div class="npp-card"><h3 class="npp-font-bold">📉 Giảm mạnh</h3><div id="npp-sp-down" class="npp-mt-2"></div></div>
        </div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Độ phủ nhóm hàng</h3><div id="npp-sp-groups" class="npp-mt-2"></div></div>
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center">
                <h3 class="npp-font-bold">Bảng SKU đầy đủ</h3>
                <input id="npp-sp-skusearch" class="npp-dh-search" placeholder="Tìm SKU..." style="max-width:200px;">
            </div>
            <div id="npp-sp-skutable" class="npp-mt-2"></div>
        </div>
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center">
                <h3 class="npp-font-bold">SKU bán chậm / chết</h3>
                <select id="npp-sp-slowdays" style="padding:8px 10px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);">
                    <option value="60" selected>60 ngày</option><option value="90">90 ngày</option>
                </select>
            </div>
            <div id="npp-sp-slow" class="npp-mt-2"></div>
        </div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Chiều sâu danh mục (SKU/NPP)</h3><div id="npp-sp-depth" class="npp-mt-2"></div></div>
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center">
                <h3 class="npp-font-bold">Cơ hội bán thêm (NPP chưa mua nhóm)</h3>
                <select id="npp-sp-ws" style="padding:8px 10px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);"></select>
            </div>
            <div id="npp-sp-ws-list" class="npp-mt-3"></div>
        </div>
    `;
    document.getElementById('npp-sp-period').addEventListener('change', (e) => loadData(parseInt(e.target.value, 10) || 3));
    document.getElementById('npp-sp-ws').addEventListener('change', loadWhiteSpace);
    document.getElementById('npp-sp-skusearch').addEventListener('input', renderSkuTable);
    document.getElementById('npp-sp-slowdays').addEventListener('change', loadSlow);
    await loadData(3);
}

async function loadData(months) {
    _months = months;
    try {
        const Chart = await loadChartLib();
        const d = await api.call('npp.api.manager.products', { months });
        _groups = d.groups || [];
        charts.forEach((c) => c.destroy()); charts = [];
        renderTop(Chart, d.top || []);
        renderMovers(d.top || []);
        renderGroups(_groups);
        _top = d.top || [];
        renderSkuTable();
        loadSlow();
        loadDepth();
        const sel = document.getElementById('npp-sp-ws');
        sel.innerHTML = _groups.map((g) => `<option value="${escapeHtml(g.item_group)}">${escapeHtml(g.item_group)}</option>`).join('');
        loadWhiteSpace();
    } catch (err) {
        document.getElementById('npp-sp-groups').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderTop(Chart, top) {
    const t = top.slice(0, 10);
    charts.push(new Chart(document.getElementById('npp-sp-top'), {
        type: 'bar',
        data: { labels: t.map((x) => x.item_name), datasets: [{ label: 'Doanh số', data: t.map((x) => x.revenue), backgroundColor: '#3b82f6' }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.parsed.x) } } }, scales: { x: { ticks: { callback: (v) => formatCurrency(v) } } } },
    }));
}

function moverRow(x) {
    const up = (x.growth_pct || 0) >= 0;
    return `<div class="npp-flex npp-justify-between npp-text-sm" style="padding:6px 0;border-bottom:1px solid var(--npp-border);">
        <span>${escapeHtml(x.item_name)}</span>
        <strong style="color:${up ? 'var(--npp-success)' : 'var(--npp-danger)'};">${up ? '▲' : '▼'} ${Math.abs(x.growth_pct).toFixed(0)}%</strong></div>`;
}

function renderMovers(top) {
    const withPrev = top.filter((x) => x.growth_pct !== null && x.growth_pct !== undefined && isFinite(x.growth_pct));
    const up = [...withPrev].filter((x) => x.growth_pct > 0).sort((a, b) => b.growth_pct - a.growth_pct).slice(0, 8);
    const down = [...withPrev].filter((x) => x.growth_pct < 0).sort((a, b) => a.growth_pct - b.growth_pct).slice(0, 8);
    document.getElementById('npp-sp-up').innerHTML = up.length ? up.map(moverRow).join('') : '<div class="npp-text-muted npp-text-sm">Không có</div>';
    document.getElementById('npp-sp-down').innerHTML = down.length ? down.map(moverRow).join('') : '<div class="npp-text-muted npp-text-sm">Không có</div>';
}

function renderGroups(groups) {
    document.getElementById('npp-sp-groups').innerHTML = html`
        <table class="npp-table">
            <thead><tr><th>Nhóm hàng</th><th class="npp-text-end">Doanh số</th><th class="npp-text-end">Số thùng</th><th class="npp-text-end">Độ phủ NPP</th></tr></thead>
            <tbody>
                ${groups.map((g) => html`<tr>
                    <td data-label="Nhóm hàng">${escapeHtml(g.item_group)}</td>
                    <td data-label="Doanh số" class="npp-text-end">${formatCurrency(g.revenue)}</td>
                    <td data-label="Số thùng" class="npp-text-end">${formatNumber(g.qty)}</td>
                    <td data-label="Độ phủ" class="npp-text-end">${g.buyers}/${g.total_npp} (${(g.coverage_pct || 0).toFixed(0)}%)</td>
                </tr>`).join('') || '<tr><td colspan="4" class="npp-text-center npp-text-muted">Không có dữ liệu</td></tr>'}
            </tbody>
        </table>
    `;
}

function renderSkuTable() {
    const root = document.getElementById('npp-sp-skutable');
    if (!root) return;
    const q = (document.getElementById('npp-sp-skusearch')?.value || '').toLowerCase().trim();
    const { key, dir } = _skuSort;
    let rows = _top.filter((r) => !q || (r.item_name || '').toLowerCase().includes(q) || (r.item_code || '').toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => {
        let av = a[key], bv = b[key];
        if (av === null || av === undefined) av = -Infinity;
        if (bv === null || bv === undefined) bv = -Infinity;
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
    const hd = (k, label, end) => `<th class="${end ? 'npp-text-end' : ''}" data-sk="${k}" style="cursor:pointer;user-select:none;">${label}${key === k ? (dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
    root.innerHTML = `<div style="overflow-x:auto;"><table class="npp-table">
        <thead><tr>${hd('item_name', 'SKU')}<th>Nhóm</th>${hd('revenue', 'DS', 1)}${hd('qty', 'Thùng', 1)}${hd('margin_pct', 'Biên LN%', 1)}${hd('growth_pct', '%Thay đổi', 1)}</tr></thead>
        <tbody>${rows.map((r) => `<tr>
            <td data-label="SKU">${escapeHtml(r.item_name)}</td>
            <td data-label="Nhóm">${escapeHtml(r.item_group || '')}</td>
            <td data-label="DS" class="npp-text-end">${formatCurrency(r.revenue)}</td>
            <td data-label="Thùng" class="npp-text-end">${formatNumber(r.qty)}</td>
            <td data-label="Biên LN%" class="npp-text-end">${r.margin_pct == null ? '—' : r.margin_pct.toFixed(1) + '%'}</td>
            <td data-label="%Thay đổi" class="npp-text-end">${r.growth_pct == null ? '—' : (r.growth_pct >= 0 ? '▲' : '▼') + Math.abs(r.growth_pct).toFixed(0) + '%'}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="npp-text-center npp-text-muted">Không có SKU</td></tr>'}</tbody>
    </table></div>`;
    root.querySelectorAll('th[data-sk]').forEach((th) => th.addEventListener('click', () => {
        const k = th.dataset.sk;
        if (_skuSort.key === k) _skuSort.dir *= -1; else { _skuSort.key = k; _skuSort.dir = -1; }
        renderSkuTable();
    }));
}

async function loadSlow() {
    const root = document.getElementById('npp-sp-slow');
    if (!root) return;
    const days = parseInt(document.getElementById('npp-sp-slowdays')?.value, 10) || 60;
    root.innerHTML = '<div class="npp-skeleton" style="height:120px;"></div>';
    try {
        const list = await api.call('npp.api.manager.slow_skus', { days });
        root.innerHTML = !list.length ? '<div class="npp-text-muted">Không có SKU chậm trong ngưỡng này.</div>' : `
            <table class="npp-table"><thead><tr><th>SKU</th><th>Bán cuối</th><th class="npp-text-end">Số ngày</th><th class="npp-text-end">Thùng (12T)</th></tr></thead>
            <tbody>${list.map((r) => `<tr><td data-label="SKU">${escapeHtml(r.item_name)}</td><td data-label="Bán cuối">${escapeHtml(r.last_sold)}</td><td data-label="Số ngày" class="npp-text-end">${r.days_since}</td><td data-label="Thùng" class="npp-text-end">${formatNumber(r.qty)}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) { root.innerHTML = `<div class="npp-text-muted">${escapeHtml(err.message)}</div>`; }
}

async function loadDepth() {
    const root = document.getElementById('npp-sp-depth');
    if (!root) return;
    root.innerHTML = '<div class="npp-skeleton" style="height:120px;"></div>';
    try {
        const d = await api.call('npp.api.manager.catalog_depth', { months: _months });
        const rows = d.rows || [];
        root.innerHTML = !rows.length ? '<div class="npp-text-muted">Chưa có dữ liệu.</div>' : `
            <p class="npp-text-sm npp-text-muted">⚠️ = danh mục mỏng (< ${d.thin} SKU) → ưu tiên cross-sell.</p>
            <table class="npp-table npp-mt-2"><thead><tr><th>NPP</th><th>Tỉnh</th><th class="npp-text-end">Số SKU</th><th class="npp-text-end">Doanh số</th></tr></thead>
            <tbody>${rows.map((r) => `<tr><td data-label="NPP">${r.thin ? '⚠️ ' : ''}${escapeHtml(r.customer_name)}</td><td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td><td data-label="Số SKU" class="npp-text-end">${r.sku_count}</td><td data-label="Doanh số" class="npp-text-end">${formatCurrency(r.revenue)}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) { root.innerHTML = `<div class="npp-text-muted">${escapeHtml(err.message)}</div>`; }
}

async function loadWhiteSpace() {
    const group = document.getElementById('npp-sp-ws').value;
    const root = document.getElementById('npp-sp-ws-list');
    if (!group) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="npp-skeleton" style="height:120px;"></div>';
    try {
        const list = await api.call('npp.api.manager.white_space', { item_group: group, months: _months });
        if (!list.length) { root.innerHTML = `<div class="npp-text-muted">Tất cả NPP đang mua đều đã có "${escapeHtml(group)}".</div>`; return; }
        root.innerHTML = html`
            <div class="npp-text-sm npp-text-muted">${list.length} NPP có doanh số nhưng CHƯA mua "${escapeHtml(group)}" → ưu tiên chào hàng:</div>
            <table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th>Tỉnh</th><th class="npp-text-end">Doanh số kỳ</th></tr></thead>
                <tbody>
                    ${list.map((r) => html`<tr>
                        <td data-label="NPP">${escapeHtml(r.customer_name)}</td>
                        <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                        <td data-label="Doanh số" class="npp-text-end">${formatCurrency(r.revenue)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        root.innerHTML = `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}
