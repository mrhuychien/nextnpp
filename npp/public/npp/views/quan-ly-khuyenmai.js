import { html } from '../lib/dom.js';
import { formatNumber, formatVNDShort, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { renderPointsMap } from '../components/map.js';

// Quản lý khuyến mại cấp KÊNH — duyệt tham gia, chương trình, điểm bán, nhân viên (toàn NPP).
// Dữ liệu app salep qua npp.api.promo_admin.* (gate quản lý).

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'], ['#/ql-npp', 'npp', '🔍 Chi tiết NPP'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'], ['#/ql-debt', 'db', '💰 Công nợ'],
                   ['#/ql-tet', 'tet', '🧧 Tết'], ['#/ql-ds', 'ds', '📅 DS tháng'], ['#/ql-km', 'km', '🎁 Khuyến mại']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

const STATUS_BADGE = { 'Nháp': 'muted', 'Đang chạy': 'success', 'Kết thúc': 'primary' };
const WF_BADGE = { 'Nháp': 'muted', 'Chờ duyệt': 'warning', 'Đã duyệt': 'success', 'Từ chối': 'danger' };

function errBox(msg) {
    const m = String(msg || '');
    const hint = /salep|module Khuyến/i.test(m) ? 'Site chưa cài module Khuyến mại (salep).'
        : (/Permission|quyền|403|forbidden/i.test(m) ? 'Tài khoản chưa đủ quyền (cần quản lý kênh / Channel Manager).' : escapeHtml(m));
    return `<div class="npp-empty"><div class="npp-empty-icon">🎁</div><div class="npp-empty-title">Chưa tải được dữ liệu</div><div class="npp-text-sm npp-text-muted">${hint}</div></div>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Quản lý khuyến mại', subtitle: 'Toàn kênh — duyệt, chương trình, điểm bán, nhân viên' })}
        ${nav('km')}
        <div class="npp-ql-nav" id="km-subtabs">
            <a href="javascript:void(0)" data-t="cd" class="npp-active">🔔 Cần duyệt</a>
            <a href="javascript:void(0)" data-t="ct">🎯 Chương trình</a>
            <a href="javascript:void(0)" data-t="db">🏪 Điểm bán</a>
            <a href="javascript:void(0)" data-t="nv">👥 Nhân viên</a>
        </div>
        <div id="km-content"><div class="npp-skeleton" style="height:300px;"></div></div>
    `;
    document.querySelectorAll('#km-subtabs a').forEach((a) => a.addEventListener('click', () => switchTab(a.dataset.t)));
    switchTab('cd');
}

function switchTab(t) {
    document.querySelectorAll('#km-subtabs a').forEach((a) => a.classList.toggle('npp-active', a.dataset.t === t));
    loadTab(t);
}

async function loadTab(t) {
    const c = document.getElementById('km-content');
    if (!c) return;
    c.innerHTML = '<div class="npp-skeleton" style="height:300px;"></div>';
    try {
        if (t === 'cd') return renderPending(await api.call('npp.api.promo_admin.pending_participations'));
        if (t === 'ct') return renderPrograms(await api.call('npp.api.promo_admin.programs'));
        if (t === 'db') return renderPoints(await api.call('npp.api.promo_admin.points_by_npp'));
        if (t === 'nv') return renderStaff(await api.call('npp.api.promo_admin.staff_by_npp'));
    } catch (err) {
        c.innerHTML = errBox(err && err.message);
    }
}

// ─── Cần duyệt ────────────────────────────────────────────────────────────
function renderPending(rows) {
    const c = document.getElementById('km-content');
    if (!rows.length) {
        c.innerHTML = '<div class="npp-empty" id="km-empty"><div class="npp-empty-icon">✅</div><div class="npp-empty-title">Không có điểm bán nào cần duyệt</div><div class="npp-text-sm npp-text-muted">Tất cả lượt tham gia đã được duyệt/từ chối — hoặc chưa có lượt nào.</div></div>';
        // Chẩn đoán: hiển thị tổng lượt + phân bố trạng thái để biết vì sao rỗng.
        api.call('npp.api.promo_admin.state_summary').then((s) => {
            const el = document.getElementById('km-empty');
            if (!el || !s) return;
            const parts = Object.entries(s.by_state || {}).map(([k, v]) => `${escapeHtml(k)}: ${formatNumber(v)}`).join(' · ');
            el.insertAdjacentHTML('beforeend',
                `<div class="npp-text-sm npp-text-muted npp-mt-2">Tổng ${formatNumber(s.total)} lượt tham gia${parts ? ` (${parts})` : ''} · ${formatNumber(s.points)} điểm bán · ${formatNumber(s.programs)} chương trình</div>`);
        }).catch(() => {});
        return;
    }
    c.innerHTML = `<div class="npp-card"><h3 class="npp-font-bold">Điểm bán cần duyệt (${rows.length})</h3>
        <div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
            <thead><tr><th>Điểm bán</th><th>NPP</th><th>Chương trình</th><th>Nhân viên</th><th>Trạng thái</th><th>Ngày</th></tr></thead>
            <tbody>${rows.map((r) => `<tr class="km-prow" data-n="${escapeHtml(r.name)}" style="cursor:pointer;">
                <td data-label="Điểm bán"><strong>${escapeHtml(r.point_name)}</strong></td>
                <td data-label="NPP">${escapeHtml(r.npp || '—')}</td>
                <td data-label="Chương trình" class="npp-text-sm">${escapeHtml(r.program_name)}</td>
                <td data-label="Nhân viên" class="npp-text-sm">${escapeHtml(r.staff || '—')}</td>
                <td data-label="Trạng thái"><span class="npp-badge npp-badge-${WF_BADGE[r.workflow_state] || 'muted'}">${escapeHtml(r.workflow_state || '—')}</span></td>
                <td data-label="Ngày" class="npp-text-sm">${r.modified ? formatDate(r.modified) : ''}</td>
            </tr>`).join('')}</tbody></table></div>
        <p class="npp-text-sm npp-text-muted npp-mt-2">Bấm 1 dòng để xem chi tiết + ảnh và Duyệt / Từ chối.</p></div>`;
    c.querySelectorAll('.km-prow').forEach((tr) => tr.addEventListener('click', () => participationModal(tr.dataset.n)));
}

async function participationModal(name) {
    showModal({ title: 'Đang tải…', body: '<div class="npp-skeleton" style="height:240px;"></div>' });
    try {
        const d = await api.call('npp.api.promo_admin.participation_detail', { name });
        const p = d.participation || {}, pt = d.point || {}, pg = d.program || {};
        const pending = !['Đã duyệt', 'Từ chối'].includes(p.workflow_state);  // chưa quyết định → cho Duyệt/Từ chối
        const imgs = (d.images || []).map((im) =>
            `<figure style="margin:0;"><img src="${escapeHtml(im.url)}" alt="${escapeHtml(im.label)}" loading="lazy"
                style="width:100%;height:160px;object-fit:cover;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface-2);">
                <figcaption class="npp-text-sm npp-text-muted" style="margin-top:4px;">${escapeHtml(im.label)}</figcaption></figure>`).join('')
            || '<div class="npp-text-muted npp-text-sm">Không có ảnh</div>';
        showModal({
            title: '🏪 ' + escapeHtml(pt.point_name || p.display_point || ''),
            body: html`
                <div class="npp-card" style="margin-top:0;">
                    <div class="npp-flex npp-justify-between"><span class="npp-text-muted">Chương trình</span><strong style="text-align:right;">${escapeHtml(pg.program_name || '')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">NPP</span><strong>${escapeHtml(d.npp || '—')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Nhân viên</span><strong>${escapeHtml(d.staff || '—')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Địa chỉ</span><strong style="text-align:right;">${escapeHtml(pt.address_line || '—')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Điện thoại</span><strong>${escapeHtml(pt.phone || '—')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Trạng thái</span><span class="npp-badge npp-badge-${WF_BADGE[p.workflow_state] || 'muted'}">${escapeHtml(p.workflow_state || '')}</span></div>
                    ${(p.latitude && p.longitude) ? `<div class="npp-mt-2"><a href="https://www.google.com/maps?q=${p.latitude},${p.longitude}" target="_blank" rel="noopener" class="npp-link">📍 Mở bản đồ</a></div>` : ''}
                    ${p.reject_reason ? `<div class="npp-mt-2 npp-text-sm" style="color:var(--npp-danger);">Lý do từ chối: ${escapeHtml(p.reject_reason)}</div>` : ''}
                </div>
                <h4 class="npp-font-bold npp-mt-3">Hình ảnh</h4>
                <div class="npp-mt-2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${imgs}</div>
                ${pending ? html`<div class="npp-flex" style="gap:8px;margin-top:12px;">
                    <button id="pa-approve" type="button" class="npp-btn-primary" style="flex:1;padding:10px;">✓ Duyệt</button>
                    <button id="pa-reject" type="button" class="npp-cn-btn" style="flex:1;padding:10px;color:var(--npp-danger);">✕ Từ chối</button>
                </div>` : ''}`,
        });
        if (pending) {
            document.getElementById('pa-approve').addEventListener('click', () => approveP(name));
            document.getElementById('pa-reject').addEventListener('click', () => rejectP(name));
        }
    } catch (err) {
        showModal({ title: '⚠️ Lỗi', body: errBox(err && err.message) });
    }
}

async function approveP(name) {
    try {
        await api.call('npp.api.promo_admin.approve_participation', { name });
        closeModal(); showToast('Đã duyệt', 'success'); loadTab('cd');
    } catch (err) { showToast('Lỗi: ' + ((err && err.message) || ''), 'error'); }
}

async function rejectP(name) {
    const reason = window.prompt('Lý do từ chối:');
    if (reason === null) return;
    if (!reason.trim()) return showToast('Cần nhập lý do từ chối', 'warning');
    try {
        await api.call('npp.api.promo_admin.reject_participation', { name, reason });
        closeModal(); showToast('Đã từ chối', 'success'); loadTab('cd');
    } catch (err) { showToast('Lỗi: ' + ((err && err.message) || ''), 'error'); }
}

// ─── Chương trình ─────────────────────────────────────────────────────────
function renderPrograms(rows) {
    const c = document.getElementById('km-content');
    if (!rows.length) {
        c.innerHTML = '<div class="npp-empty"><div class="npp-empty-icon">📭</div><div class="npp-empty-title">Chưa có chương trình</div></div>';
        return;
    }
    c.innerHTML = `<div class="npp-card"><h3 class="npp-font-bold">Chương trình (${rows.length})</h3>
        <div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
            <thead><tr><th>Chương trình</th><th>Trạng thái</th><th class="npp-text-end">Tham gia</th><th class="npp-text-end">Chờ duyệt</th><th class="npp-text-end">Đã duyệt</th><th class="npp-text-end">NPP</th></tr></thead>
            <tbody>${rows.map((r) => `<tr class="km-progrow" data-p="${escapeHtml(r.program)}" style="cursor:pointer;">
                <td data-label="Chương trình"><strong>${escapeHtml(r.program_name)}</strong></td>
                <td data-label="Trạng thái"><span class="npp-badge npp-badge-${STATUS_BADGE[r.status] || 'muted'}">${escapeHtml(r.status || '—')}</span></td>
                <td data-label="Tham gia" class="npp-text-end">${formatNumber(r.participations)}</td>
                <td data-label="Chờ duyệt" class="npp-text-end">${r.pending ? `<strong style="color:var(--npp-warning);">${formatNumber(r.pending)}</strong>` : '0'}</td>
                <td data-label="Đã duyệt" class="npp-text-end"><strong style="color:var(--npp-success);">${formatNumber(r.approved)}</strong></td>
                <td data-label="NPP" class="npp-text-end">${formatNumber(r.npp_count)}</td>
            </tr>`).join('')}</tbody></table></div>
        <p class="npp-text-sm npp-text-muted npp-mt-2">Bấm 1 chương trình để xem chi tiết theo NPP / nhân viên, độ phủ, độ mở.</p></div>`;
    c.querySelectorAll('.km-progrow').forEach((tr) => tr.addEventListener('click', () => programDetail(tr.dataset.p)));
}

async function programDetail(program) {
    const c = document.getElementById('km-content');
    c.innerHTML = '<div class="npp-skeleton" style="height:300px;"></div>';
    try {
        const d = await api.call('npp.api.promo_admin.program_detail', { program });
        const pg = d.program || {}, cov = d.coverage || {}, t = d.totals || {};
        const pgPts = (d.points || []).map((p) => ({
            lat: p.latitude, lng: p.longitude, color: p.approved ? '#10b981' : '#f59e0b',
            html: `<strong>${escapeHtml(p.name || '')}</strong><br><span style="color:#64748b;">${escapeHtml(p.npp || '')}</span>`
                + `${p.address_line ? `<br>${escapeHtml(p.address_line)}` : ''}<br>${p.approved ? '🟢 Đã duyệt' : '🟠 Chờ duyệt'}`,
        }));
        const pgWithGps = pgPts.filter((p) => p.lat && p.lng).length;
        c.innerHTML = html`
            <a href="javascript:void(0)" id="km-back" class="npp-link">← Quay lại danh sách chương trình</a>
            <div class="npp-card npp-mt-2">
                <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                    <h3 class="npp-font-bold">${escapeHtml(pg.program_name || '')}</h3>
                    <span class="npp-badge npp-badge-${STATUS_BADGE[pg.status] || 'muted'}">${escapeHtml(pg.status || '')}</span>
                </div>
                <div class="npp-text-sm npp-text-muted npp-mt-1">${pg.start_date ? formatDate(pg.start_date) : ''}${pg.end_date ? ' → ' + formatDate(pg.end_date) : ''}${pg.budget ? ' · NS ' + formatVNDShort(pg.budget) : ''}${pg.reward_per_point ? ' · ' + formatNumber(pg.reward_per_point) + 'đ/điểm' : ''}</div>
            </div>
            <div class="npp-kpi-grid npp-mt-3">
                <div class="npp-kpi-card"><div class="npp-kpi-label">Chờ duyệt</div><div class="npp-kpi-value warning">${formatNumber(t.pending || 0)}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Đã duyệt</div><div class="npp-kpi-value">${formatNumber(t.approved || 0)}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Độ phủ</div><div class="npp-kpi-value">${(cov.pct || 0).toFixed(0)}%</div><div class="npp-kpi-sub">${cov.approved_points || 0}/${cov.total_active || 0} điểm</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Độ mở (điểm mới)</div><div class="npp-kpi-value">${formatNumber(d.new_points || 0)}</div><div class="npp-kpi-sub">mở trong kỳ CT</div></div>
            </div>
            <div class="npp-card npp-mt-3">
                <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                    <h3 class="npp-font-bold">Bản đồ điểm bán tham gia</h3>
                    <span class="npp-text-sm npp-text-muted">${pgWithGps}/${(d.points || []).length} điểm có toạ độ</span>
                </div>
                <div id="km-pgmap" class="npp-map-wrap"></div>
                <div class="npp-map-legend"><span><i style="background:#10b981;"></i>Đã duyệt</span><span><i style="background:#f59e0b;"></i>Chờ duyệt</span></div>
            </div>
            <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Điểm bán cần duyệt (${(d.pending || []).length})</h3>
                ${(d.pending || []).length ? `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2"><thead><tr><th>Điểm bán</th><th>NPP</th><th>Nhân viên</th><th>Trạng thái</th><th>Ngày</th></tr></thead>
                    <tbody>${d.pending.map((x) => `<tr class="km-prow" data-n="${escapeHtml(x.name)}" style="cursor:pointer;"><td data-label="Điểm bán"><strong>${escapeHtml(x.point_name)}</strong></td><td data-label="NPP">${escapeHtml(x.npp || '—')}</td><td data-label="Nhân viên" class="npp-text-sm">${escapeHtml(x.staff || '—')}</td><td data-label="Trạng thái"><span class="npp-badge npp-badge-${WF_BADGE[x.workflow_state] || 'muted'}">${escapeHtml(x.workflow_state || '—')}</span></td><td data-label="Ngày" class="npp-text-sm">${x.modified ? formatDate(x.modified) : ''}</td></tr>`).join('')}</tbody></table></div>`
                    : '<div class="npp-text-muted npp-mt-2">Không có lượt cần duyệt 🎉</div>'}
            </div>
            <div class="npp-grid-2 npp-mt-3">
                <div class="npp-card"><h3 class="npp-font-bold">Tiến độ theo NPP</h3>
                    ${(d.by_npp || []).length ? `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2"><thead><tr><th>NPP</th><th class="npp-text-end">Duyệt/Tham gia</th><th class="npp-text-end">Độ phủ</th></tr></thead>
                        <tbody>${d.by_npp.map((x) => `<tr><td data-label="NPP">${escapeHtml(x.customer_name)}</td><td data-label="Duyệt" class="npp-text-end">${formatNumber(x.approved)}/${formatNumber(x.total)}</td><td data-label="Độ phủ" class="npp-text-end">${x.approved_points}/${x.active_points} (${(x.coverage_pct || 0).toFixed(0)}%)</td></tr>`).join('')}</tbody></table></div>` : '<div class="npp-text-muted npp-mt-2">—</div>'}
                </div>
                <div class="npp-card"><h3 class="npp-font-bold">Tiến độ theo nhân viên</h3>
                    ${(d.by_staff || []).length ? `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2"><thead><tr><th>Nhân viên</th><th class="npp-text-end">Đã duyệt</th><th class="npp-text-end">Lượt</th></tr></thead>
                        <tbody>${d.by_staff.map((x) => `<tr><td data-label="Nhân viên">${escapeHtml(x.full_name)}</td><td data-label="Đã duyệt" class="npp-text-end"><strong style="color:var(--npp-success);">${formatNumber(x.approved)}</strong></td><td data-label="Lượt" class="npp-text-end">${formatNumber(x.total)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="npp-text-muted npp-mt-2">—</div>'}
                </div>
            </div>`;
        document.getElementById('km-back').addEventListener('click', () => loadTab('ct'));
        c.querySelectorAll('.km-prow').forEach((tr) => tr.addEventListener('click', () => participationModal(tr.dataset.n)));
        renderPointsMap(document.getElementById('km-pgmap'), pgPts);
    } catch (err) {
        c.innerHTML = errBox(err && err.message);
    }
}

// ─── Điểm bán theo NPP ────────────────────────────────────────────────────
function renderPoints(d) {
    const c = document.getElementById('km-content');
    const npps = d.npps || [];
    if (!npps.length) {
        c.innerHTML = '<div class="npp-empty"><div class="npp-empty-icon">🏪</div><div class="npp-empty-title">Chưa có điểm bán</div></div>';
        return;
    }
    const allPts = [];
    npps.forEach((g) => (g.points || []).forEach((p) => allPts.push({
        lat: p.latitude, lng: p.longitude, active: !!p.is_active,
        html: `<strong>${escapeHtml(p.point_name || '')}</strong><br><span style="color:#64748b;">${escapeHtml(g.customer_name)}</span>`
            + `${p.address_line ? `<br>${escapeHtml(p.address_line)}` : ''}${p.phone ? `<br>📞 ${escapeHtml(p.phone)}` : ''}`
            + `<br>${p.is_active ? '🟢 Hoạt động' : '⚪ Ngừng'}`,
    })));
    const withGps = allPts.filter((p) => p.lat && p.lng).length;
    c.innerHTML = `<div class="npp-card"><div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
            <h3 class="npp-font-bold">Bản đồ điểm bán</h3>
            <span class="npp-text-sm npp-text-muted">${withGps}/${d.total} điểm có toạ độ · ${npps.length} NPP</span></div>
            <div id="km-map" class="npp-map-wrap"></div>
            <div class="npp-map-legend"><span><i style="background:#10b981;"></i>Hoạt động</span><span><i style="background:#94a3b8;"></i>Ngừng</span></div>
        </div>
        <div class="npp-text-sm npp-text-muted" style="margin:.75rem 0 .5rem;">Tổng ${d.total} điểm bán · ${npps.length} NPP</div>` +
        npps.map((g) => `<div class="npp-card npp-mt-2">
            <div class="npp-flex npp-justify-between npp-items-center"><h3 class="npp-font-bold">${escapeHtml(g.customer_name)}</h3><span class="npp-badge npp-badge-muted">${g.active}/${g.count} hoạt động</span></div>
            <div style="overflow-x:auto;"><table class="npp-table npp-mt-2"><thead><tr><th>Điểm bán</th><th>Địa chỉ</th><th class="npp-text-center">TT</th><th></th></tr></thead>
                <tbody>${g.points.map((p) => `<tr>
                    <td data-label="Điểm bán"><strong>${escapeHtml(p.point_name)}</strong>${p.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(p.phone)}</div>` : ''}</td>
                    <td data-label="Địa chỉ" class="npp-text-sm">${escapeHtml(p.address_line || '—')}</td>
                    <td data-label="TT" class="npp-text-center">${p.is_active ? '🟢' : '⚪'}</td>
                    <td class="npp-text-center">${(p.latitude && p.longitude) ? `<a href="https://www.google.com/maps?q=${p.latitude},${p.longitude}" target="_blank" rel="noopener" class="npp-link">📍</a>` : ''}</td>
                </tr>`).join('')}</tbody></table></div>
        </div>`).join('');
    renderPointsMap(document.getElementById('km-map'), allPts);
}

// ─── Nhân viên theo NPP ───────────────────────────────────────────────────
function renderStaff(d) {
    const c = document.getElementById('km-content');
    const npps = d.npps || [];
    if (!npps.length) {
        c.innerHTML = '<div class="npp-empty"><div class="npp-empty-icon">👥</div><div class="npp-empty-title">Chưa có nhân viên</div></div>';
        return;
    }
    c.innerHTML = `<div class="npp-text-sm npp-text-muted" style="margin-bottom:.5rem;">Tổng ${d.total} nhân viên · ${npps.length} NPP</div>` +
        npps.map((g) => `<div class="npp-card npp-mt-2">
            <div class="npp-flex npp-justify-between npp-items-center"><h3 class="npp-font-bold">${escapeHtml(g.customer_name)}</h3><span class="npp-badge npp-badge-muted">${g.staff.length} NV</span></div>
            <div style="overflow-x:auto;"><table class="npp-table npp-mt-2"><thead><tr><th>Nhân viên</th><th class="npp-text-center">TT</th><th class="npp-text-end">Lượt</th><th class="npp-text-end">Đã duyệt</th></tr></thead>
                <tbody>${g.staff.map((s) => `<tr>
                    <td data-label="Nhân viên"><strong>${escapeHtml(s.full_name)}</strong>${s.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(s.phone)}</div>` : ''}</td>
                    <td data-label="TT" class="npp-text-center">${s.active ? '🟢' : '⚪'}</td>
                    <td data-label="Lượt" class="npp-text-end">${formatNumber(s.total)}</td>
                    <td data-label="Đã duyệt" class="npp-text-end"><strong style="color:var(--npp-success);">${formatNumber(s.approved)}</strong></td>
                </tr>`).join('')}</tbody></table></div>
        </div>`).join('');
}
