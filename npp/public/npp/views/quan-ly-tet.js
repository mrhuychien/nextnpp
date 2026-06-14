import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

let chartLib = null, chart = null;

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

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'],
                   ['#/ql-debt', 'db', '💰 Công nợ'], ['#/ql-tet', 'tet', '🧧 Tết']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

function pct(v) {
    if (v == null) return '<span class="npp-text-muted">—</span>';
    const up = v >= 0;
    return `<span style="color:${up ? 'var(--npp-success)' : 'var(--npp-danger)'};font-weight:800;">${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Theo dõi mùa Tết 🧧', subtitle: 'Hàng Tết — độ phủ, lũy kế vs năm trước, NPP chưa nhập' })}
        ${nav('tet')}
        <div class="npp-kpi-grid" id="npp-tet-kpi">${'<div class="npp-skeleton" style="height:90px;"></div>'.repeat(4)}</div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Doanh số Hàng Tết theo tuần</h3>
            <div class="npp-chart-wrap"><canvas id="npp-tet-week"></canvas></div></div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">NPP chủ lực CHƯA nhập Tết (cơ hội)</h3>
            <div id="npp-tet-nb" class="npp-mt-2"></div></div>
    `;
    try {
        const Chart = await loadChartLib();
        const d = await api.call('npp.api.manager.tet_tracking');
        renderKpi(d);
        if (chart) { chart.destroy(); chart = null; }
        renderWeek(Chart, d.weekly || []);
        renderNotBuying(d.not_buying || []);
    } catch (err) {
        document.getElementById('npp-tet-kpi').innerHTML =
            `<div class="npp-empty" style="grid-column:1/-1;"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderKpi(d) {
    document.getElementById('npp-tet-kpi').innerHTML = html`
        <div class="npp-kpi-card"><div class="npp-kpi-label">Độ phủ Hàng Tết</div>
            <div class="npp-kpi-value">${(d.coverage_pct || 0).toFixed(0)}%</div>
            <div class="npp-kpi-sub">${d.buyers || 0}/${d.total_npp || 0} NPP đã nhập</div></div>
        <div class="npp-kpi-card"><div class="npp-kpi-label">DS Tết lũy kế (từ 01/11/${d.tet_year || ''})</div>
            <div class="npp-kpi-value">${formatVNDShort(d.this_revenue || 0)}</div>
            <div class="npp-kpi-sub">${pct(d.yoy_pct)} vs cùng kỳ năm trước</div></div>
        <div class="npp-kpi-card"><div class="npp-kpi-label">Cùng kỳ năm trước</div>
            <div class="npp-kpi-value">${formatVNDShort(d.ly_revenue || 0)}</div></div>
        <div class="npp-kpi-card"><div class="npp-kpi-label">Dự báo cả mùa Tết</div>
            <div class="npp-kpi-value">${formatVNDShort(d.forecast || 0)}</div>
            <div class="npp-kpi-sub">Theo nhịp hiện tại (~120 ngày)</div></div>
    `;
}

function renderWeek(Chart, weekly) {
    chart = new Chart(document.getElementById('npp-tet-week'), {
        type: 'bar',
        data: { labels: weekly.map((x) => x.week), datasets: [{ label: 'DS Tết', data: weekly.map((x) => x.revenue), backgroundColor: '#f43f5e' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => formatVNDShort(v) } } } },
    });
}

function renderNotBuying(list) {
    const root = document.getElementById('npp-tet-nb');
    root.innerHTML = !list.length ? '<div class="npp-text-muted">Mọi NPP chủ lực đều đã nhập Hàng Tết 🎉</div>' : html`
        <p class="npp-text-sm npp-text-muted">NPP có doanh số 90 ngày qua nhưng CHƯA nhập Hàng Tết — ưu tiên chào:</p>
        <table class="npp-table npp-mt-2">
            <thead><tr><th>NPP</th><th>Tỉnh</th><th class="npp-text-end">DS 90 ngày</th></tr></thead>
            <tbody>
                ${list.map((r) => html`<tr>
                    <td data-label="NPP">${escapeHtml(r.customer_name)}</td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="DS 90 ngày" class="npp-text-end">${formatCurrency(r.revenue)}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
}
