import { html } from '../lib/dom.js';
import { formatCurrency, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

let chartLib = null;  // lazy-loaded Chart.js

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
        ${banner({ title: 'Thống kê', subtitle: '12 tháng gần nhất' })}
        <div class="npp-card"><h3 class="npp-font-bold">Doanh số theo tháng</h3>
            <div class="npp-chart-wrap"><canvas id="npp-chart-month"></canvas></div></div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Tỉ trọng nhóm sản phẩm (12 tháng)</h3>
            <div class="npp-chart-wrap"><canvas id="npp-chart-group"></canvas></div></div>
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Top 10 sản phẩm tháng này</h3>
            <div class="npp-chart-wrap"><canvas id="npp-chart-top"></canvas></div></div>
    `;

    try {
        const Chart = await loadChartLib();
        const [monthData, groupData, topData] = await Promise.all([
            api.salesByMonth(12),
            api.salesByItemGroup(12),
            api.topItems(1),
        ]);

        new Chart(document.getElementById('npp-chart-month'), {
            type: 'line',
            data: {
                labels: monthData.map((d) => d.month),
                datasets: [{
                    label: 'Doanh số (VNĐ)',
                    data:  monthData.map((d) => d.revenue),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    tension: 0.3, fill: true,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { ticks: { callback: (v) => formatCurrency(v) } } },
            },
        });

        new Chart(document.getElementById('npp-chart-group'), {
            type: 'doughnut',
            data: {
                labels: groupData.map((d) => d.item_group),
                datasets: [{
                    data: groupData.map((d) => d.amount),
                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.parsed)}`,
                        },
                    },
                },
            },
        });

        new Chart(document.getElementById('npp-chart-top'), {
            type: 'bar',
            data: {
                labels: topData.map((d) => d.item_name),
                datasets: [{ label: 'Số thùng', data: topData.map((d) => d.qty), backgroundColor: '#10b981' }],
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
            },
        });
    } catch (err) {
        container.innerHTML += `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}
