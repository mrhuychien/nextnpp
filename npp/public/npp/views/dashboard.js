import { html } from '../lib/dom.js';
import { formatCurrency, formatNumber } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';

const cardSkeleton = () => html`<div class="npp-card npp-skeleton" style="height:90px;"></div>`;

export async function render({ container }) {
    const ctx = window.NPP_CONTEXT || {};
    const customerName = ctx.customerName || ctx.userFullName || ctx.userFirstName || 'Quý NPP';

    container.innerHTML = html`
        ${banner({
            title: `Xin chào, ${customerName}`,
            subtitle: ctx.customer ? `Mã KH: ${ctx.customer}` : 'Chào mừng đến với NPP Portal',
        })}
        <div class="npp-dashboard-grid" id="npp-dash-cards">
            ${cardSkeleton()}${cardSkeleton()}${cardSkeleton()}${cardSkeleton()}
        </div>
        <a href="#/dat-hang" class="npp-cta-block">
            <i class="fas fa-plus-circle"></i>
            <span>Đặt đơn hàng mới</span>
            <i class="fas fa-chevron-right"></i>
        </a>
    `;

    try {
        // Timeout phòng skeleton kẹt vĩnh viễn nếu API treo — hiện lỗi thay vì ô trắng.
        const data = await Promise.race([
            api.cached.dashboard(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Máy chủ phản hồi quá lâu. Bấm làm mới để thử lại.')), 20000)),
        ]);
        renderCards(data);
    } catch (err) {
        showToast('Lỗi tải dashboard: ' + err.message, 'error');
        document.getElementById('npp-dash-cards').innerHTML = `
            <div class="npp-empty">
                <div class="npp-empty-icon">⚠️</div>
                <div class="npp-empty-title">Không tải được dữ liệu</div>
                <div class="npp-text-sm">${err.message}</div>
            </div>`;
    }
}

function renderCards(d) {
    const grid = document.getElementById('npp-dash-cards');
    if (!grid) return;
    grid.innerHTML = html`
        <a href="#/cong-no" class="npp-card npp-dash-card npp-dash-debt">
            <div class="npp-dash-icon">💰</div>
            <div class="npp-dash-info">
                <div class="npp-dash-label">Công nợ hiện tại</div>
                <div class="npp-dash-value">${formatCurrency(d.outstanding_total || 0)}</div>
                ${d.overdue_count ? `<div class="npp-dash-sub">${d.overdue_count} HĐ quá hạn</div>` : '<div class="npp-dash-sub">Không có HĐ quá hạn</div>'}
            </div>
            <i class="fas fa-chevron-right npp-dash-chev"></i>
        </a>

        <a href="#/don-hang" class="npp-card npp-dash-card">
            <div class="npp-dash-icon">📦</div>
            <div class="npp-dash-info">
                <div class="npp-dash-label">Đơn hàng</div>
                <div class="npp-dash-value">${formatNumber(d.draft_count || 0)} nháp · ${formatNumber(d.shipping_count || 0)} đang giao</div>
                <div class="npp-dash-sub">Tháng này: ${formatNumber(d.month_count || 0)} đơn</div>
            </div>
            <i class="fas fa-chevron-right npp-dash-chev"></i>
        </a>

        <a href="#/khuyen-mai" class="npp-card npp-dash-card">
            <div class="npp-dash-icon">🎁</div>
            <div class="npp-dash-info">
                <div class="npp-dash-label">Khuyến mãi đang chạy</div>
                <div class="npp-dash-value">${formatNumber(d.promo_count || 0)} chương trình</div>
            </div>
            <i class="fas fa-chevron-right npp-dash-chev"></i>
        </a>

        <a href="#/thong-ke" class="npp-card npp-dash-card">
            <div class="npp-dash-icon">📊</div>
            <div class="npp-dash-info">
                <div class="npp-dash-label">Doanh số tháng này</div>
                <div class="npp-dash-value">${formatCurrency(d.month_revenue || 0)}</div>
                <div class="npp-dash-sub">${formatNumber(d.month_qty || 0)} thùng</div>
            </div>
            <i class="fas fa-chevron-right npp-dash-chev"></i>
        </a>
    `;
}
