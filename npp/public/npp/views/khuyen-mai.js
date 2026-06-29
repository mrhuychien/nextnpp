import { html } from '../lib/dom.js';
import { formatDate, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';

// Khuyến mại — NPP quản lý & theo dõi chương trình trưng bày TRÊN ĐỊA BÀN của mình.
// Dữ liệu từ app `salep` (cùng site), scope server-side theo require_customer.

const STATUS_BADGE = { 'Nháp': 'muted', 'Đang chạy': 'success', 'Kết thúc': 'primary' };
const WF_BADGE = { 'Nháp': 'muted', 'Chờ duyệt': 'warning', 'Đã duyệt': 'success', 'Từ chối': 'danger' };

function bar(pct, color) {
    pct = Math.max(0, Math.min(100, pct || 0));
    return `<div style="height:6px;background:var(--npp-surface-2);border-radius:4px;overflow:hidden;margin-top:4px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}
function gpsLink(lat, lng) {
    return (lat && lng) ? `<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" class="npp-link">📍</a>` : '';
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Khuyến mại', subtitle: 'Quản lý chương trình trưng bày trên địa bàn của bạn' })}
        <div id="npp-km-body"><div class="npp-skeleton" style="height:320px;"></div></div>
    `;
    try {
        const d = await api.call('npp.api.promo.npp_overview');
        renderBody(d);
        loadParticipations('');
    } catch (err) {
        const msg = String((err && err.message) || '');
        const hint = /salep|module Khuyến/i.test(msg)
            ? 'Site chưa cài module Khuyến mại (salep).'
            : (/custom_customer|chưa.*gán|not.*customer/i.test(msg)
                ? 'Tài khoản chưa gán Nhà phân phối (Customer).'
                : escapeHtml(msg));
        document.getElementById('npp-km-body').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">🎁</div><div class="npp-empty-title">Chưa tải được dữ liệu khuyến mại</div><div class="npp-text-sm npp-text-muted">${hint}</div></div>`;
    }
}

function renderBody(d) {
    const t = d.totals || {};
    const programs = d.programs || [];
    const points = d.points || [];
    const staff = d.staff || [];

    document.getElementById('npp-km-body').innerHTML = html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Chương trình đang chạy</div><div class="npp-kpi-value">${t.running || 0}<span style="font-size:.8rem;font-weight:600;">/${t.programs || 0}</span></div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Điểm bán</div><div class="npp-kpi-value">${t.active_points || 0}<span style="font-size:.8rem;font-weight:600;">/${t.points || 0}</span></div><div class="npp-kpi-sub">${t.participated_points || 0} điểm đã tham gia</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Lượt được duyệt</div><div class="npp-kpi-value">${formatNumber(t.approved || 0)}</div><div class="npp-kpi-sub">/${formatNumber(t.participations || 0)} lượt</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Nhân viên</div><div class="npp-kpi-value">${t.staff || 0}</div></div>
        </div>

        <!-- Chương trình & tiến độ -->
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Chương trình & tiến độ triển khai</h3>
            ${programs.length ? html`<div class="npp-mt-2" style="display:flex;flex-direction:column;gap:10px;">
                ${programs.map((p) => {
                    const cov = p.coverage_pct || 0;
                    const cColor = cov >= 80 ? 'var(--npp-success)' : (cov >= 40 ? 'var(--npp-warning)' : 'var(--npp-danger)');
                    return `<div style="border:1px solid var(--npp-border);border-radius:12px;padding:12px;">
                        <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                            <strong>${escapeHtml(p.program_name)}</strong>
                            <span class="npp-badge npp-badge-${STATUS_BADGE[p.status] || 'muted'}">${escapeHtml(p.status || '—')}</span>
                        </div>
                        <div class="npp-text-sm npp-text-muted npp-mt-1">${p.start_date ? formatDate(p.start_date) : ''}${p.end_date ? ' → ' + formatDate(p.end_date) : ''}${p.reward_per_point ? ' · ' + formatNumber(p.reward_per_point) + 'đ/điểm' : ''}</div>
                        <div class="npp-flex npp-justify-between npp-text-sm npp-mt-2"><span>Độ phủ điểm bán (đã duyệt)</span><strong>${p.approved_points}/${(d.totals || {}).active_points || 0} (${cov.toFixed(0)}%)</strong></div>
                        ${bar(cov, cColor)}
                        <div class="npp-flex npp-justify-between npp-text-sm npp-mt-2 npp-text-muted">
                            <span>Tham gia: <strong>${p.participations}</strong> · Đã duyệt: <strong style="color:var(--npp-success);">${p.approved}</strong></span>
                            <a href="javascript:void(0)" class="npp-link npp-km-progfilter" data-p="${escapeHtml(p.program)}">Xem điểm tham gia →</a>
                        </div>
                    </div>`;
                }).join('')}
            </div>` : `<div class="npp-mt-2">${emptyState({ icon: '📭', title: 'Chưa có chương trình' })}</div>`}
        </div>

        <!-- Điểm bán tham gia chương trình -->
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:8px;">
                <h3 class="npp-font-bold">Điểm bán tham gia chương trình</h3>
                <select id="npp-km-progsel" style="padding:7px 10px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);">
                    <option value="">Tất cả chương trình</option>
                    ${programs.map((p) => `<option value="${escapeHtml(p.program)}">${escapeHtml(p.program_name)}</option>`).join('')}
                </select>
            </div>
            <div id="npp-km-parts" class="npp-mt-2"><div class="npp-skeleton" style="height:160px;"></div></div>
        </div>

        <!-- Danh sách điểm bán -->
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Danh sách điểm bán (${points.length})</h3>
            ${points.length ? html`<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>Điểm bán</th><th>Địa chỉ</th><th class="npp-text-center">Trạng thái</th><th class="npp-text-center">Tham gia</th><th></th></tr></thead>
                <tbody>${points.map((p) => `<tr>
                    <td data-label="Điểm bán"><strong>${escapeHtml(p.point_name || p.name)}</strong>${p.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(p.phone)}</div>` : ''}</td>
                    <td data-label="Địa chỉ" class="npp-text-sm">${escapeHtml(p.address_line || '—')}</td>
                    <td data-label="Trạng thái" class="npp-text-center">${p.is_active ? '<span class="npp-badge npp-badge-success">Hoạt động</span>' : '<span class="npp-badge npp-badge-muted">Ngừng</span>'}</td>
                    <td data-label="Tham gia" class="npp-text-center">${p.participated ? '✅' : '—'}</td>
                    <td class="npp-text-center">${gpsLink(p.latitude, p.longitude)}</td>
                </tr>`).join('')}</tbody></table></div>`
                : `<div class="npp-mt-2">${emptyState({ icon: '🏪', title: 'Chưa có điểm bán' })}</div>`}
        </div>

        <!-- Nhân viên & tiến độ -->
        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Nhân viên & tiến độ triển khai</h3>
            ${staff.length ? html`<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>Nhân viên</th><th class="npp-text-end">Lượt</th><th class="npp-text-end">Đã duyệt</th><th style="min-width:120px;">Tỷ lệ duyệt</th></tr></thead>
                <tbody>${staff.map((s) => {
                    const rate = s.total ? s.approved / s.total * 100 : 0;
                    return `<tr>
                        <td data-label="Nhân viên"><strong>${escapeHtml(s.full_name)}</strong>${s.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(s.phone)}</div>` : ''}</td>
                        <td data-label="Lượt" class="npp-text-end">${formatNumber(s.total)}</td>
                        <td data-label="Đã duyệt" class="npp-text-end"><strong style="color:var(--npp-success);">${formatNumber(s.approved)}</strong></td>
                        <td data-label="Tỷ lệ">${rate.toFixed(0)}%${bar(rate, 'var(--npp-success)')}</td>
                    </tr>`;
                }).join('')}</tbody></table></div>`
                : `<div class="npp-mt-2">${emptyState({ icon: '👥', title: 'Chưa có nhân viên' })}</div>`}
        </div>
    `;

    const sel = document.getElementById('npp-km-progsel');
    sel.addEventListener('change', () => loadParticipations(sel.value));
    document.querySelectorAll('.npp-km-progfilter').forEach((a) => a.addEventListener('click', () => {
        sel.value = a.dataset.p; loadParticipations(a.dataset.p);
        document.getElementById('npp-km-parts').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
}

async function loadParticipations(program) {
    const root = document.getElementById('npp-km-parts');
    if (!root) return;
    root.innerHTML = '<div class="npp-skeleton" style="height:160px;"></div>';
    try {
        const rows = await api.call('npp.api.promo.npp_participations', { program: program || undefined });
        if (!rows.length) { root.innerHTML = emptyState({ icon: '📭', title: 'Chưa có điểm bán tham gia' }); return; }
        root.innerHTML = `<div style="overflow-x:auto;"><table class="npp-table">
            <thead><tr><th>Điểm bán</th><th>Chương trình</th><th class="npp-text-center">Trạng thái</th><th>Cập nhật</th><th></th></tr></thead>
            <tbody>${rows.map((r) => `<tr>
                <td data-label="Điểm bán"><strong>${escapeHtml(r.point_name)}</strong></td>
                <td data-label="Chương trình" class="npp-text-sm">${escapeHtml(r.program_name)}</td>
                <td data-label="Trạng thái" class="npp-text-center"><span class="npp-badge npp-badge-${WF_BADGE[r.workflow_state] || 'muted'}">${escapeHtml(r.workflow_state || '—')}</span>${r.workflow_state === 'Từ chối' && r.reject_reason ? `<div class="npp-text-sm npp-text-muted" title="${escapeHtml(r.reject_reason)}">lý do…</div>` : ''}</td>
                <td data-label="Cập nhật" class="npp-text-sm">${r.modified ? formatDate(r.modified) : ''}</td>
                <td class="npp-text-center">${gpsLink(r.latitude, r.longitude)}</td>
            </tr>`).join('')}</tbody></table></div>
            <div class="npp-text-sm npp-text-muted npp-mt-2">${rows.length} lượt tham gia</div>`;
    } catch (err) {
        root.innerHTML = `<div class="npp-text-muted">${escapeHtml((err && err.message) || 'Lỗi')}</div>`;
    }
}
