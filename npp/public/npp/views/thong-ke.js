import { html } from '../lib/dom.js';
import { formatCurrency, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

let chartLib = null;     // lazy-loaded Chart.js
let charts = [];         // chart instances — destroy trước khi vẽ lại

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

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Phân tích kinh doanh', subtitle: 'Tình hình nhập hàng của NPP' })}
        <div class="npp-flex npp-justify-between npp-items-center">
            <h3 class="npp-font-bold">Tổng quan</h3>
            <select id="npp-tk-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);">
                <option value="3">3 tháng</option>
                <option value="6">6 tháng</option>
                <option value="12" selected>12 tháng</option>
            </select>
        </div>
        <div class="npp-kpi-grid" id="npp-tk-kpis">
            <div class="npp-skeleton" style="height:90px;"></div>
            <div class="npp-skeleton" style="height:90px;"></div>
            <div class="npp-skeleton" style="height:90px;"></div>
            <div class="npp-skeleton" style="height:90px;"></div>
        </div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Doanh số &amp; sản lượng theo tháng</h3>
            <div class="npp-chart-wrap"><canvas id="npp-chart-month"></canvas></div></div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Tỉ trọng nhóm sản phẩm</h3>
            <div class="npp-chart-wrap"><canvas id="npp-chart-group"></canvas></div></div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Top 10 sản phẩm (sản lượng)</h3>
            <div class="npp-chart-wrap"><canvas id="npp-chart-top"></canvas></div>
            <div id="npp-tk-top-table" class="npp-mt-3"></div></div>
    `;

    document.getElementById('npp-tk-period').addEventListener('change', (e) => {
        loadData(parseInt(e.target.value, 10) || 12);
    });
    await loadData(12);
}

async function loadData(months) {
    try {
        const Chart = await loadChartLib();
        const [kpi, monthData, groupData, topData] = await Promise.all([
            api.call('npp.api.analytics.kpi', { months }),
            api.salesByMonth(months),
            api.salesByItemGroup(months),
            api.topItems(months),
        ]);
        renderKpis(kpi);
        charts.forEach((c) => c.destroy());
        charts = [];
        renderCharts(Chart, monthData, groupData, topData);
        renderTopTable(topData);
    } catch (err) {
        const k = document.getElementById('npp-tk-kpis');
        if (k) k.innerHTML = `<div class="npp-empty" style="grid-column:1/-1;"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderKpis(k) {
    const root = document.getElementById('npp-tk-kpis');
    if (!root) return;
    let growth;
    if (k.growth_pct === null || k.growth_pct === undefined) {
        growth = 'Kỳ trước chưa có dữ liệu';
    } else {
        const up = k.growth_pct >= 0;
        growth = `<span style="color:${up ? 'var(--npp-success)' : 'var(--npp-danger)'};font-weight:800;">${up ? '▲' : '▼'} ${Math.abs(k.growth_pct).toFixed(1)}%</span> so với kỳ trước`;
    }
    root.innerHTML = html`
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Doanh số (${k.months} tháng)</div>
            <div class="npp-kpi-value">${formatCurrency(k.revenue)}</div>
            <div class="npp-kpi-sub">${growth}</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Sản lượng nhập</div>
            <div class="npp-kpi-value">${formatNumber(k.qty)} <span style="font-size:.8rem;font-weight:600;">thùng</span></div>
            <div class="npp-kpi-sub">Tổng trong kỳ</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Số đơn</div>
            <div class="npp-kpi-value">${formatNumber(k.order_count)}</div>
            <div class="npp-kpi-sub">Hóa đơn đã chốt</div>
        </div>
        <div class="npp-kpi-card">
            <div class="npp-kpi-label">Trung bình / đơn</div>
            <div class="npp-kpi-value">${formatCurrency(k.avg_order_value)}</div>
            <div class="npp-kpi-sub">Giá trị TB mỗi đơn</div>
        </div>
    `;
}

function renderCharts(Chart, monthData, groupData, topData) {
    // Doanh số (đường) + sản lượng thùng (cột) theo tháng — 2 trục.
    charts.push(new Chart(document.getElementById('npp-chart-month'), {
        data: {
            labels: monthData.map((d) => d.month),
            datasets: [
                { type: 'bar',  label: 'Số thùng',  data: monthData.map((d) => d.qty || 0),  backgroundColor: 'rgba(16,185,129,0.45)', yAxisID: 'y1', order: 2 },
                { type: 'line', label: 'Doanh số',  data: monthData.map((d) => d.revenue),    borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)', tension: 0.3, fill: true, yAxisID: 'y', order: 1 },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: (ctx) => ctx.dataset.yAxisID === 'y'
                    ? `Doanh số: ${formatCurrency(ctx.parsed.y)}`
                    : `Số thùng: ${formatNumber(ctx.parsed.y)}` } },
            },
            scales: {
                y:  { position: 'left',  ticks: { callback: (v) => formatCurrency(v) } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => formatNumber(v) } },
            },
        },
    }));

    charts.push(new Chart(document.getElementById('npp-chart-group'), {
        type: 'doughnut',
        data: {
            labels: groupData.map((d) => d.item_group),
            datasets: [{ data: groupData.map((d) => d.amount), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'] }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.parsed)}` } },
            },
        },
    }));

    charts.push(new Chart(document.getElementById('npp-chart-top'), {
        type: 'bar',
        data: {
            labels: topData.map((d) => d.item_name),
            datasets: [{ label: 'Số thùng', data: topData.map((d) => d.qty), backgroundColor: '#10b981' }],
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    }));
}

function renderTopTable(topData) {
    const root = document.getElementById('npp-tk-top-table');
    if (!root) return;
    if (!topData.length) { root.innerHTML = ''; return; }
    root.innerHTML = html`
        <table class="npp-table">
            <thead><tr><th>Sản phẩm</th><th class="npp-text-end">Số thùng</th><th class="npp-text-end">Doanh số</th></tr></thead>
            <tbody>
                ${topData.map((d) => html`<tr>
                    <td data-label="Sản phẩm">${escapeHtml(d.item_name)}</td>
                    <td data-label="Số thùng" class="npp-text-end">${formatNumber(d.qty)}</td>
                    <td data-label="Doanh số" class="npp-text-end">${formatCurrency(d.amount)}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
}
