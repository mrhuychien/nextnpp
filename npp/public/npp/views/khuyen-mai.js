import { html } from '../lib/dom.js';
import { formatDate, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';
import { showModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { renderPointsMap, refreshMap } from '../components/map.js';
import { renderQR } from '../components/qr.js';
import '../components/lightbox.js';   // bấm ảnh → xem to (delegated)

// Khuyến mại — NPP quản lý & theo dõi chương trình trưng bày TRÊN ĐỊA BÀN của mình.
// Dữ liệu từ app `salep` (cùng site), scope server-side theo require_customer.

const STATUS_BADGE = { 'Nháp': 'muted', 'Đang chạy': 'success', 'Kết thúc': 'primary' };
const WF_BADGE = { 'Nháp': 'muted', 'Chờ duyệt': 'warning', 'Đã duyệt': 'success', 'Từ chối': 'danger' };
let _staff = [];
let _points = [];

function bar(pct, color) {
    pct = Math.max(0, Math.min(100, pct || 0));
    return `<div style="height:6px;background:var(--npp-surface-2);border-radius:4px;overflow:hidden;margin-top:4px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Khuyến mại', subtitle: 'Quản lý chương trình trưng bày trên địa bàn của bạn' })}
        <div id="npp-km-body"><div class="npp-skeleton" style="height:320px;"></div></div>
    `;
    await refresh();
}

async function refresh() {
    const body = document.getElementById('npp-km-body');
    if (body) body.innerHTML = '<div class="npp-skeleton" style="height:320px;"></div>';
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
        if (body) body.innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">🎁</div><div class="npp-empty-title">Chưa tải được dữ liệu khuyến mại</div><div class="npp-text-sm npp-text-muted">${hint}</div></div>`;
    }
}

function renderBody(d) {
    const t = d.totals || {};
    const programs = d.programs || [];
    const points = d.points || [];
    const staff = d.staff || [];
    const selfStaff = !!d.self_is_staff;
    _staff = staff;
    _points = points;

    const apprRate = t.participations ? (t.approved / t.participations * 100) : 0;
    const coverage = t.active_points ? (t.participated_points / t.active_points * 100) : 0;

    document.getElementById('npp-km-body').innerHTML = html`
        <div class="npp-ql-nav" id="npp-km-tabs">
            <a href="javascript:void(0)" data-t="nv" class="npp-active">👥 Nhân viên</a>
            <a href="javascript:void(0)" data-t="db">🏪 Điểm bán</a>
            <a href="javascript:void(0)" data-t="ct">🎯 Chương trình</a>
            <a href="javascript:void(0)" data-t="bc">📊 Báo cáo</a>
        </div>

        <!-- TAB Nhân viên -->
        <div id="npp-km-nv" class="npp-km-tab">
            <div class="npp-card">
                <div class="npp-flex npp-justify-between npp-items-center">
                    <h3 class="npp-font-bold">Nhân viên & tiến độ</h3>
                    <button id="npp-km-addstaff" type="button" class="npp-btn-primary" style="padding:7px 12px;font-size:.85rem;">➕ Thêm nhân viên</button>
                </div>
                ${selfStaff
                    ? html`<div class="npp-note-block npp-note-npp npp-mt-2" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span>✅ Bạn đã có hồ sơ nhân viên bán hàng — tự đi trưng bày được.</span>
                        <a href="/dp" class="npp-link">Mở portal nhân viên /dp →</a></div>`
                    : html`<div class="npp-note-block npp-note-internal npp-mt-2" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span>NPP cũng đi bán? Tạo hồ sơ nhân viên cho <strong>chính tài khoản này</strong> để tự trưng bày.</span>
                        <button id="npp-km-selfstaff" type="button" class="npp-btn-primary" style="padding:7px 12px;font-size:.85rem;width:auto;flex:none;">➕ Thêm mình làm nhân viên</button></div>`}
                ${staff.length ? html`<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                    <thead><tr><th>Nhân viên</th><th class="npp-text-center">Trạng thái</th><th class="npp-text-end">Lượt</th><th class="npp-text-end">Đã duyệt</th><th style="min-width:100px;">Tỷ lệ</th></tr></thead>
                    <tbody>${staff.map((s) => {
                        const rate = s.total ? s.approved / s.total * 100 : 0;
                        return `<tr class="${s.name ? 'npp-km-staffrow' : ''}" data-n="${escapeHtml(s.name || '')}" style="${s.name ? 'cursor:pointer;' : ''}">
                            <td data-label="Nhân viên"><strong>${escapeHtml(s.full_name)}</strong>${s.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(s.phone)}</div>` : ''}</td>
                            <td data-label="Trạng thái" class="npp-text-center">${s.active ? '<span class="npp-badge npp-badge-success">Hoạt động</span>' : '<span class="npp-badge npp-badge-muted">Tạm dừng</span>'}</td>
                            <td data-label="Lượt" class="npp-text-end">${formatNumber(s.total)}</td>
                            <td data-label="Đã duyệt" class="npp-text-end"><strong style="color:var(--npp-success);">${formatNumber(s.approved)}</strong></td>
                            <td data-label="Tỷ lệ">${rate.toFixed(0)}%${bar(rate, 'var(--npp-success)')}</td>
                        </tr>`;
                    }).join('')}</tbody></table></div>
                    <p class="npp-text-sm npp-text-muted npp-mt-2">Bấm vào nhân viên để xem / sửa / đổi MK / xoá.</p>`
                    : `<div class="npp-mt-2">${emptyState({ icon: '👥', title: 'Chưa có nhân viên', message: 'Bấm "Thêm nhân viên" để bắt đầu.' })}</div>`}
            </div>
        </div>

        <!-- TAB Điểm bán -->
        <div id="npp-km-db" class="npp-km-tab" hidden>
            <div class="npp-card">
                <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                    <h3 class="npp-font-bold">Bản đồ điểm bán</h3>
                    <span class="npp-text-sm npp-text-muted">${points.filter((p) => p.latitude && p.longitude).length}/${points.length} điểm có toạ độ</span>
                </div>
                <div id="npp-km-map" class="npp-map-wrap"></div>
                <div class="npp-map-legend"><span><i style="background:#10b981;"></i>Hoạt động</span><span><i style="background:#94a3b8;"></i>Ngừng</span></div>
            </div>
            <div class="npp-card npp-mt-2">
                <div class="npp-flex npp-justify-between npp-items-center">
                    <h3 class="npp-font-bold">Danh sách điểm bán (${points.length})</h3>
                    <button id="npp-km-addpoint" type="button" class="npp-btn-primary" style="padding:7px 12px;font-size:.85rem;">➕ Thêm điểm bán</button>
                </div>
                ${points.length ? html`<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                    <thead><tr><th>Điểm bán</th><th>Địa chỉ</th><th class="npp-text-center">Trạng thái</th><th class="npp-text-center">Tham gia</th></tr></thead>
                    <tbody>${points.map((p) => `<tr class="npp-km-pointrow" data-n="${escapeHtml(p.name)}" style="cursor:pointer;">
                        <td data-label="Điểm bán"><strong>${escapeHtml(p.point_name || p.name)}</strong>${p.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(p.phone)}</div>` : ''}</td>
                        <td data-label="Địa chỉ" class="npp-text-sm">${escapeHtml(p.address_line || '—')}</td>
                        <td data-label="Trạng thái" class="npp-text-center">${p.is_active ? '<span class="npp-badge npp-badge-success">Hoạt động</span>' : '<span class="npp-badge npp-badge-muted">Ngừng</span>'}</td>
                        <td data-label="Tham gia" class="npp-text-center">${p.participated ? '✅' : '—'}</td>
                    </tr>`).join('')}</tbody></table></div>
                    <p class="npp-text-sm npp-text-muted npp-mt-2">Bấm vào điểm bán để xem / sửa / xoá.</p>`
                    : `<div class="npp-mt-2">${emptyState({ icon: '🏪', title: 'Chưa có điểm bán' })}</div>`}
            </div>
        </div>

        <!-- TAB Chương trình -->
        <div id="npp-km-ct" class="npp-km-tab" hidden>
            <div class="npp-card"><h3 class="npp-font-bold">Chương trình & tiến độ triển khai</h3>
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
                            <div class="npp-flex npp-justify-between npp-text-sm npp-mt-2"><span>Độ phủ điểm bán (đã duyệt)</span><strong>${p.approved_points}/${t.active_points || 0} (${cov.toFixed(0)}%)</strong></div>
                            ${bar(cov, cColor)}
                            <div class="npp-flex npp-justify-between npp-text-sm npp-mt-2 npp-text-muted">
                                <span>Tham gia: <strong>${p.participations}</strong> · Đã duyệt: <strong style="color:var(--npp-success);">${p.approved}</strong></span>
                                <a href="javascript:void(0)" class="npp-link npp-km-progfilter" data-p="${escapeHtml(p.program)}">Xem điểm tham gia →</a>
                            </div>
                        </div>`;
                    }).join('')}
                </div>` : `<div class="npp-mt-2">${emptyState({ icon: '📭', title: 'Chưa có chương trình' })}</div>`}
            </div>
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
        </div>

        <!-- TAB Báo cáo -->
        <div id="npp-km-bc" class="npp-km-tab" hidden>
            <div class="npp-kpi-grid">
                <div class="npp-kpi-card"><div class="npp-kpi-label">Chương trình đang chạy</div><div class="npp-kpi-value">${t.running || 0}<span style="font-size:.8rem;font-weight:600;">/${t.programs || 0}</span></div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Điểm bán</div><div class="npp-kpi-value">${t.active_points || 0}<span style="font-size:.8rem;font-weight:600;">/${t.points || 0}</span></div><div class="npp-kpi-sub">${t.participated_points || 0} điểm đã tham gia</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Lượt được duyệt</div><div class="npp-kpi-value">${formatNumber(t.approved || 0)}</div><div class="npp-kpi-sub">/${formatNumber(t.participations || 0)} lượt</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Nhân viên</div><div class="npp-kpi-value">${t.staff || 0}</div></div>
            </div>
            <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Tổng quan</h3>
                <div class="npp-flex npp-justify-between npp-text-sm npp-mt-2"><span>Tỷ lệ duyệt</span><strong>${apprRate.toFixed(0)}%</strong></div>${bar(apprRate, 'var(--npp-success)')}
                <div class="npp-flex npp-justify-between npp-text-sm npp-mt-3"><span>Độ phủ điểm bán (đã tham gia)</span><strong>${coverage.toFixed(0)}%</strong></div>${bar(coverage, 'var(--npp-primary, #3b82f6)')}
            </div>
        </div>
    `;

    document.querySelectorAll('#npp-km-tabs a').forEach((a) => a.addEventListener('click', () => switchKmTab(a.dataset.t)));

    const sel = document.getElementById('npp-km-progsel');
    sel.addEventListener('change', () => loadParticipations(sel.value));
    document.querySelectorAll('.npp-km-progfilter').forEach((a) => a.addEventListener('click', () => {
        sel.value = a.dataset.p; loadParticipations(a.dataset.p);
        document.getElementById('npp-km-parts').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    document.getElementById('npp-km-addstaff')?.addEventListener('click', openCreateStaff);
    document.getElementById('npp-km-selfstaff')?.addEventListener('click', addSelfAsStaff);
    document.getElementById('npp-km-addpoint')?.addEventListener('click', () => { window.location.href = '/dp#/points/new'; });
    document.querySelectorAll('.npp-km-staffrow').forEach((r) =>
        r.addEventListener('click', () => staffModal(r.dataset.n)));
    document.querySelectorAll('.npp-km-pointrow').forEach((r) =>
        r.addEventListener('click', () => pointModal(r.dataset.n)));
}

function addSelfAsStaff() {
    showModal({
        title: '➕ Thêm mình làm nhân viên',
        body: html`
            <p class="npp-text-sm npp-text-muted">Tạo hồ sơ nhân viên bán hàng cho <strong>chính tài khoản này</strong> để tự đi trưng bày.</p>
            <div class="npp-mt-2"><label class="npp-cn-flabel">Số điện thoại của bạn *</label>
                <input id="self-phone" class="npp-cn-input" style="width:100%;" inputmode="tel" placeholder="VD: 0901234567"></div>
            <button id="self-save" type="button" class="npp-btn-primary" style="padding:10px;margin-top:12px;">Tạo hồ sơ nhân viên</button>`,
    });
    document.getElementById('self-save').addEventListener('click', doAddSelf);
    document.getElementById('self-phone').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAddSelf(); });
    setTimeout(() => document.getElementById('self-phone')?.focus(), 50);
}

async function doAddSelf() {
    const phone = (document.getElementById('self-phone')?.value || '').trim();
    if (!phone) return showToast('Vui lòng nhập số điện thoại', 'warning');
    const btn = document.getElementById('self-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang tạo...'; }
    try {
        await api.call('npp.api.promo.add_self_as_staff', { phone });
        showModal({
            title: '✅ Bạn đã là nhân viên bán hàng',
            body: html`
                <p>Tài khoản của bạn giờ có <strong>hồ sơ nhân viên bán hàng</strong> — vào app nhân viên để tự tạo điểm bán & trưng bày.</p>
                <a href="/dp" class="npp-btn-primary" style="text-decoration:none;margin-top:12px;">Mở portal nhân viên /dp →</a>
                <p class="npp-text-sm npp-text-muted npp-mt-2">Lần đăng nhập sau có thể vào thẳng /dp; bạn vẫn mở /npp bất cứ lúc nào.</p>`,
        });
        refresh();
    } catch (err) {
        showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Tạo hồ sơ nhân viên'; }
    }
}

function switchKmTab(t) {
    document.querySelectorAll('#npp-km-tabs a').forEach((a) => a.classList.toggle('npp-active', a.dataset.t === t));
    ['nv', 'db', 'ct', 'bc'].forEach((k) => {
        const el = document.getElementById('npp-km-' + k);
        if (el) el.hidden = (k !== t);
    });
    if (t === 'db') initPointsMap();   // map phải khởi tạo/refresh khi tab đã hiện (Leaflet)
    if (t === 'ct') refreshMap(document.getElementById('npp-km-partsmap'));  // map tham gia nạp sẵn lúc tab ẩn
}

function initPointsMap() {
    const el = document.getElementById('npp-km-map');
    if (!el) return;
    // State gắn vào CHÍNH element (không phải module) — render() tạo element mới mỗi
    // lần vào view, nên cờ module sẽ kẹt; el mới luôn chưa có _nppMap → vẽ lại đúng.
    if (el._nppMap) { refreshMap(el); return; }
    if (el._nppPending) return;
    el._nppPending = true;
    const mapPts = (_points || []).map((p) => ({
        lat: p.latitude, lng: p.longitude, active: !!p.is_active, _name: p.name,
        html: `<strong>${escapeHtml(p.point_name || p.name)}</strong>`
            + `${p.address_line ? `<br>${escapeHtml(p.address_line)}` : ''}${p.phone ? `<br>📞 ${escapeHtml(p.phone)}` : ''}`
            + `<br>${p.is_active ? '🟢 Hoạt động' : '⚪ Ngừng'}${p.participated ? ' · ✅ Đã tham gia' : ''}`
            + `<br><a href="javascript:void(0)" data-detail class="npp-link">Xem chi tiết →</a>`,
    }));
    renderPointsMap(el, mapPts, { onDetail: (p) => pointModal(p._name) }).finally(() => { el._nppPending = false; });
}

function v(id) { return (document.getElementById(id)?.value || '').trim(); }

function openCreateStaff() {
    showModal({
        title: '➕ Thêm nhân viên',
        body: html`<div style="display:flex;flex-direction:column;gap:10px;">
            <div><label class="npp-cn-flabel">Họ tên *</label><input id="nv-name" class="npp-cn-input" style="width:100%;"></div>
            <div><label class="npp-cn-flabel">Số điện thoại * (dùng để đăng nhập)</label><input id="nv-phone" class="npp-cn-input" style="width:100%;" inputmode="tel"></div>
            <div><label class="npp-cn-flabel">Mật khẩu (để trống = tự tạo)</label><input id="nv-pass" class="npp-cn-input" style="width:100%;"></div>
            <div><label class="npp-cn-flabel">Email (tuỳ chọn)</label><input id="nv-email" type="email" class="npp-cn-input" style="width:100%;"></div>
            <div><label class="npp-cn-flabel">CCCD (tuỳ chọn)</label><input id="nv-cccd" class="npp-cn-input" style="width:100%;" inputmode="numeric"></div>
            <button id="nv-save" type="button" class="npp-btn-primary" style="padding:10px;">Tạo nhân viên</button>
            <p class="npp-text-sm npp-text-muted">NV đăng nhập bằng <strong>số điện thoại + mật khẩu</strong>. Tài khoản gắn role Sales Staff thuộc địa bàn của bạn.</p>
        </div>`,
    });
    document.getElementById('nv-save').addEventListener('click', saveStaff);
}

async function saveStaff() {
    const full_name = v('nv-name'), phone = v('nv-phone'), password = v('nv-pass'), email = v('nv-email'), cccd = v('nv-cccd');
    if (!full_name) return showToast('Nhập họ tên nhân viên', 'warning');
    if (!phone) return showToast('Nhập số điện thoại (tên đăng nhập)', 'warning');
    const btn = document.getElementById('nv-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang tạo...'; }
    try {
        const r = await api.call('npp.api.promo.create_staff', { full_name, phone, email, cccd, password });
        showToast('Đã tạo nhân viên', 'success');
        showCredentials(r);
        refresh();
    } catch (err) {
        showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Tạo nhân viên'; }
    }
}

function showCredentials(r) {
    const uname = r.username || '';
    const pw = r.password || '';
    const baseUrl = (window.NPP_CONTEXT?.baseUrl || '').replace(/\/+$/, '');
    const appUrl = baseUrl + '/dp';
    // QR trỏ tới trang tự đăng nhập (đọc tài khoản/mật khẩu từ #hash → không vào log
    // server). Quét bằng camera điện thoại sẽ mở trình duyệt NGOÀI, không kẹt webview Zalo.
    const qrUrl = `${baseUrl}/staff-login#u=${encodeURIComponent(uname)}&p=${encodeURIComponent(pw)}`;
    // Mỗi dòng tách bạch; URL đứng RIÊNG 1 dòng, KHÔNG bọc ngoặc → dán vào Zalo link
    // không bị dính ký tự ")" làm hỏng liên kết.
    const msg = `Tài khoản đăng nhập app nhân viên:
Tên đăng nhập (SĐT): ${uname}
Mật khẩu: ${pw}
Mở app:
${appUrl}`;
    showModal({
        title: '✅ Đã tạo nhân viên',
        body: html`
            <p>Thông tin đăng nhập của nhân viên:</p>
            <div class="npp-card" style="margin-top:8px;">
                <div class="npp-flex npp-justify-between"><span class="npp-text-muted">Tên đăng nhập (SĐT)</span><strong style="user-select:all;">${escapeHtml(uname)}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Mật khẩu</span><strong style="user-select:all;">${escapeHtml(pw)}</strong></div>
            </div>
            <div class="npp-card npp-text-center" style="margin-top:10px;">
                <div class="npp-text-sm npp-font-bold">📷 Mã QR đăng nhập nhanh</div>
                <div id="nv-qr" class="npp-flex npp-items-center" style="justify-content:center;min-height:180px;margin:8px 0;"><span class="npp-text-muted npp-text-sm">Đang tạo QR…</span></div>
                <div class="npp-text-sm npp-text-muted">Nhân viên dùng <strong>camera điện thoại</strong> quét → mở trình duyệt → tự đăng nhập (không cần mở link trong Zalo).</div>
            </div>
            <p class="npp-text-sm npp-text-muted npp-mt-2">⚠️ Lưu lại & gửi cho nhân viên. Mật khẩu chỉ hiển thị 1 lần ở đây.</p>
            <div class="npp-flex npp-flex-wrap" style="gap:8px;margin-top:8px;">
                <button id="nv-copy" type="button" class="npp-btn-primary" style="flex:2;min-width:150px;padding:10px;">📋 Sao chép để gửi NV</button>
                <button id="nv-qrdl" type="button" class="npp-cn-btn" style="flex:1;min-width:110px;padding:10px;">💾 Tải ảnh QR</button>
                <button id="nv-done" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:10px;">Xong</button>
            </div>`,
    });
    document.getElementById('nv-done').addEventListener('click', closeModal);
    document.getElementById('nv-copy').addEventListener('click', () => copyText(msg, 'nv-copy'));
    document.getElementById('nv-qrdl').addEventListener('click', () => {
        const img = document.querySelector('#nv-qr img');
        if (!img || !img.src) return showToast('QR chưa sẵn sàng', 'warning');
        const a = document.createElement('a');
        a.href = img.src;
        a.download = 'dang-nhap-' + (uname || 'nv') + '.gif';
        document.body.appendChild(a); a.click(); a.remove();
    });
    renderQR(document.getElementById('nv-qr'), qrUrl, 190);
}

async function copyText(text, btnId) {
    let ok = false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            ok = true;
        }
    } catch (e) { ok = false; }
    if (!ok) {  // fallback cho ngữ cảnh không bảo mật / trình duyệt cũ
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            ok = document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) { ok = false; }
    }
    if (ok) {
        showToast('Đã sao chép thông tin đăng nhập', 'success');
        const b = btnId && document.getElementById(btnId);
        if (b) { const t = b.textContent; b.textContent = '✓ Đã sao chép'; setTimeout(() => { if (b) b.textContent = t; }, 1500); }
    } else {
        showToast('Không sao chép được — hãy chọn & copy thủ công', 'warning');
    }
}

async function toggleStaff(name, active) {
    try {
        await api.call('npp.api.promo.set_staff_active', { staff: name, active });
        closeModal();
        showToast(Number(active) ? 'Đã kích hoạt nhân viên' : 'Đã tạm dừng nhân viên', 'success');
        refresh();
    } catch (err) {
        showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
    }
}

function staffModal(name) {
    if (!name) return;
    const s = _staff.find((x) => x.name === name);
    if (!s) return;
    const rate = s.total ? (s.approved / s.total * 100) : 0;
    showModal({
        title: '👤 ' + (s.full_name || ''),
        body: html`
            <div class="npp-card" style="margin-top:0;">
                <div class="npp-flex npp-justify-between"><span class="npp-text-muted">Đăng nhập (SĐT)</span><strong>${escapeHtml(s.phone || '—')}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Trạng thái</span>${s.active ? '<span class="npp-badge npp-badge-success">Hoạt động</span>' : '<span class="npp-badge npp-badge-muted">Tạm dừng</span>'}</div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Lượt tham gia</span><strong>${formatNumber(s.total)}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Đã duyệt</span><strong style="color:var(--npp-success);">${formatNumber(s.approved)} (${rate.toFixed(0)}%)</strong></div>
            </div>
            <div class="npp-flex npp-flex-wrap" style="gap:8px;margin-top:10px;">
                <button id="sm-edit" type="button" class="npp-btn-primary" style="flex:1;min-width:90px;padding:9px;">✏️ Sửa</button>
                <button id="sm-pass" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:9px;">🔑 Đổi MK</button>
                <button id="sm-toggle" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:9px;">${s.active ? '⏸ Tạm dừng' : '▶ Kích hoạt'}</button>
                <button id="sm-del" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:9px;color:var(--npp-danger);">🗑 Xoá</button>
            </div>`,
    });
    document.getElementById('sm-edit').addEventListener('click', () => openEditStaff(name));
    document.getElementById('sm-pass').addEventListener('click', () => resetPass(name));
    document.getElementById('sm-toggle').addEventListener('click', () => toggleStaff(name, s.active ? 0 : 1));
    document.getElementById('sm-del').addEventListener('click', () => deleteStaff(name, s.full_name));
}

async function deleteStaff(name, label) {
    if (!window.confirm(`Xoá nhân viên "${label || ''}"?\nTài khoản đăng nhập sẽ bị vô hiệu hoá.`)) return;
    try {
        await api.call('npp.api.promo.delete_staff', { staff: name });
        closeModal();
        showToast('Đã xoá nhân viên', 'success');
        refresh();
    } catch (err) {
        showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
    }
}

async function pointModal(name) {
    showModal({ title: 'Đang tải…', body: '<div class="npp-skeleton" style="height:240px;"></div>' });
    let d;
    try {
        d = await api.call('npp.api.promo.npp_point_detail', { point: name });
    } catch (err) {
        showModal({ title: '⚠️ Lỗi', body: `<div class="npp-text-muted">${escapeHtml((err && err.message) || '')}</div>` });
        return;
    }
    const p = d.point || {}, st = d.stats || {}, acts = d.activity || [], imgs = d.images || [];
    const imgGrid = imgs.length
        ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${imgs.map((im) => `<figure style="margin:0;"><img class="npp-zoomable" src="${escapeHtml(im.url)}" alt="${escapeHtml(im.label)}" loading="lazy" style="width:100%;height:140px;object-fit:cover;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface-2);"><figcaption class="npp-text-sm npp-text-muted" style="margin-top:4px;">${escapeHtml(im.label)}</figcaption></figure>`).join('')}</div>`
        : '<div class="npp-text-muted npp-text-sm">Chưa có hình ảnh</div>';
    showModal({
        title: '🏪 ' + escapeHtml(p.point_name || name),
        body: html`
            <div class="npp-card" style="margin-top:0;">
                <div class="npp-flex npp-justify-between" style="gap:10px;"><span class="npp-text-muted">Địa chỉ</span><strong style="text-align:right;">${escapeHtml(p.address_line || '—')}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Điện thoại</span><strong>${escapeHtml(p.phone || '—')}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Trạng thái</span>${p.is_active ? '<span class="npp-badge npp-badge-success">Hoạt động</span>' : '<span class="npp-badge npp-badge-muted">Ngừng</span>'}</div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Ngày tạo</span><strong>${p.creation ? formatDate(p.creation) : '—'}</strong></div>
                ${(p.latitude && p.longitude) ? `<div class="npp-mt-2"><a href="https://www.google.com/maps?q=${p.latitude},${p.longitude}" target="_blank" rel="noopener" class="npp-link">📍 Mở bản đồ</a></div>` : ''}
            </div>
            <div class="npp-kpi-grid npp-mt-3">
                <div class="npp-kpi-card"><div class="npp-kpi-label">Lượt tham gia</div><div class="npp-kpi-value">${formatNumber(st.participations || 0)}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Đã duyệt</div><div class="npp-kpi-value">${formatNumber(st.approved || 0)}</div><div class="npp-kpi-sub">${formatNumber(st.programs || 0)} chương trình</div></div>
            </div>
            <h4 class="npp-font-bold npp-mt-3">Hình ảnh</h4>
            <div class="npp-mt-2">${imgGrid}</div>
            <h4 class="npp-font-bold npp-mt-3">Chương trình đã tham gia (${acts.length})</h4>
            ${acts.length ? `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2"><thead><tr><th>Chương trình</th><th class="npp-text-center">Trạng thái</th><th>Ngày</th></tr></thead>
                <tbody>${acts.map((a) => `<tr><td data-label="Chương trình">${escapeHtml(a.program || '—')}</td><td data-label="Trạng thái" class="npp-text-center"><span class="npp-badge npp-badge-${WF_BADGE[a.workflow_state] || 'muted'}">${escapeHtml(a.workflow_state || '—')}</span></td><td data-label="Ngày" class="npp-text-sm">${a.date ? formatDate(a.date) : ''}</td></tr>`).join('')}</tbody></table></div>`
                : '<div class="npp-text-muted npp-mt-2">Chưa tham gia chương trình nào</div>'}
            <div class="npp-flex npp-flex-wrap" style="gap:8px;margin-top:12px;">
                <button id="pm-edit" type="button" class="npp-btn-primary" style="flex:1;padding:9px;">✏️ Sửa</button>
                <button id="pm-del" type="button" class="npp-cn-btn" style="flex:1;padding:9px;color:var(--npp-danger);">🗑 Xoá</button>
            </div>`,
    });
    document.getElementById('pm-edit').addEventListener('click', () => openEditPoint(name));
    document.getElementById('pm-del').addEventListener('click', () => deletePoint(name, p.point_name || name));
}

function openEditPoint(name) {
    const p = _points.find((x) => x.name === name);
    if (!p) return;
    showModal({
        title: '✏️ Sửa điểm bán',
        body: html`<div style="display:flex;flex-direction:column;gap:10px;">
            <div><label class="npp-cn-flabel">Tên điểm bán *</label><input id="pe-name" class="npp-cn-input" style="width:100%;" value="${escapeHtml(p.point_name || '')}"></div>
            <div><label class="npp-cn-flabel">Địa chỉ</label><input id="pe-addr" class="npp-cn-input" style="width:100%;" value="${escapeHtml(p.address_line || '')}"></div>
            <div><label class="npp-cn-flabel">Điện thoại</label><input id="pe-phone" class="npp-cn-input" style="width:100%;" inputmode="tel" value="${escapeHtml(p.phone || '')}"></div>
            <label class="npp-flex npp-items-center" style="gap:8px;"><input id="pe-active" type="checkbox" ${p.is_active ? 'checked' : ''}> Đang hoạt động</label>
            <button id="pe-save" type="button" class="npp-btn-primary" style="padding:10px;">Lưu</button>
        </div>`,
    });
    document.getElementById('pe-save').addEventListener('click', () => savePoint(name));
}

async function savePoint(name) {
    const point_name = v('pe-name'), address_line = v('pe-addr'), phone = v('pe-phone');
    const is_active = document.getElementById('pe-active')?.checked ? 1 : 0;
    if (!point_name) return showToast('Nhập tên điểm bán', 'warning');
    const btn = document.getElementById('pe-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }
    try {
        await api.call('npp.api.promo.update_point', { point: name, point_name, address_line, phone, is_active });
        closeModal(); showToast('Đã cập nhật điểm bán', 'success'); refresh();
    } catch (err) {
        showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Lưu'; }
    }
}

async function deletePoint(name, label) {
    if (!window.confirm(`Xoá điểm bán "${label || ''}"?\nKhông xoá được nếu đã có lượt tham gia.`)) return;
    try {
        await api.call('npp.api.promo.delete_point', { point: name });
        closeModal(); showToast('Đã xoá điểm bán', 'success'); refresh();
    } catch (err) {
        showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
    }
}


function openEditStaff(name) {
    const s = _staff.find((x) => x.name === name);
    if (!s) return;
    showModal({
        title: '✏️ Sửa nhân viên',
        body: html`<div style="display:flex;flex-direction:column;gap:10px;">
            <div><label class="npp-cn-flabel">Họ tên *</label><input id="ev-name" class="npp-cn-input" style="width:100%;" value="${escapeHtml(s.full_name || '')}"></div>
            <div><label class="npp-cn-flabel">Số điện thoại * (tên đăng nhập)</label><input id="ev-phone" class="npp-cn-input" style="width:100%;" inputmode="tel" value="${escapeHtml(s.phone || '')}"></div>
            <div><label class="npp-cn-flabel">CCCD</label><input id="ev-cccd" class="npp-cn-input" style="width:100%;" inputmode="numeric" value="${escapeHtml(s.cccd || '')}"></div>
            <button id="ev-save" type="button" class="npp-btn-primary" style="padding:10px;">Lưu</button>
            <p class="npp-text-sm npp-text-muted">Đổi SĐT sẽ đổi luôn tên đăng nhập của nhân viên.</p>
        </div>`,
    });
    document.getElementById('ev-save').addEventListener('click', () => saveEdit(name));
}

async function saveEdit(name) {
    const full_name = v('ev-name'), phone = v('ev-phone'), cccd = v('ev-cccd');
    if (!full_name) return showToast('Nhập họ tên', 'warning');
    if (!phone) return showToast('Nhập số điện thoại', 'warning');
    const btn = document.getElementById('ev-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }
    try {
        await api.call('npp.api.promo.update_staff', { staff: name, full_name, phone, cccd });
        closeModal(); showToast('Đã cập nhật nhân viên', 'success'); refresh();
    } catch (err) {
        showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Lưu'; }
    }
}

function resetPass(name) {
    showModal({
        title: '🔑 Đổi mật khẩu',
        body: html`<div style="display:flex;flex-direction:column;gap:10px;">
            <div><label class="npp-cn-flabel">Mật khẩu mới (để trống = tự tạo)</label><input id="rp-pass" class="npp-cn-input" style="width:100%;"></div>
            <button id="rp-save" type="button" class="npp-btn-primary" style="padding:10px;">Cấp lại mật khẩu</button>
        </div>`,
    });
    document.getElementById('rp-save').addEventListener('click', () => doReset(name));
}

async function doReset(name) {
    const password = v('rp-pass');
    const btn = document.getElementById('rp-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang xử lý...'; }
    try {
        const r = await api.call('npp.api.promo.reset_staff_password', { staff: name, password });
        showToast('Đã đổi mật khẩu', 'success');
        showCredentials(r);
    } catch (err) {
        showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Cấp lại mật khẩu'; }
    }
}

async function loadParticipations(program) {
    const root = document.getElementById('npp-km-parts');
    if (!root) return;
    root.innerHTML = '<div class="npp-skeleton" style="height:160px;"></div>';
    try {
        const rows = await api.call('npp.api.promo.npp_participations', { program: program || undefined });
        if (!rows.length) { root.innerHTML = emptyState({ icon: '📭', title: 'Chưa có điểm bán tham gia' }); return; }
        const mapPts = rows.map((r) => ({
            lat: r.latitude, lng: r.longitude,
            color: r.workflow_state === 'Đã duyệt' ? '#10b981' : (r.workflow_state === 'Từ chối' ? '#94a3b8' : '#f59e0b'),
            html: `<strong>${escapeHtml(r.point_name)}</strong><br><span style="color:#64748b;">${escapeHtml(r.program_name)}</span><br>${escapeHtml(r.workflow_state || '—')}`,
        }));
        const withGps = mapPts.filter((p) => p.lat && p.lng).length;
        root.innerHTML = `
            <div class="npp-text-sm npp-text-muted" style="margin-bottom:6px;">🗺️ ${withGps}/${rows.length} điểm có toạ độ</div>
            <div id="npp-km-partsmap" class="npp-map-wrap" style="margin-top:0;"></div>
            <div class="npp-map-legend"><span><i style="background:#10b981;"></i>Đã duyệt</span><span><i style="background:#f59e0b;"></i>Chờ duyệt</span><span><i style="background:#94a3b8;"></i>Từ chối</span></div>
            <div style="overflow-x:auto;" class="npp-mt-3"><table class="npp-table">
            <thead><tr><th>Điểm bán</th><th>Chương trình</th><th class="npp-text-center">Trạng thái</th><th>Cập nhật</th></tr></thead>
            <tbody>${rows.map((r) => `<tr class="npp-km-partrow" data-n="${escapeHtml(r.name)}" style="cursor:pointer;">
                <td data-label="Điểm bán"><strong>${escapeHtml(r.point_name)}</strong></td>
                <td data-label="Chương trình" class="npp-text-sm">${escapeHtml(r.program_name)}</td>
                <td data-label="Trạng thái" class="npp-text-center"><span class="npp-badge npp-badge-${WF_BADGE[r.workflow_state] || 'muted'}">${escapeHtml(r.workflow_state || '—')}</span>${r.workflow_state === 'Từ chối' && r.reject_reason ? `<div class="npp-text-sm npp-text-muted" title="${escapeHtml(r.reject_reason)}">lý do…</div>` : ''}</td>
                <td data-label="Cập nhật" class="npp-text-sm">${r.modified ? formatDate(r.modified) : ''}</td>
            </tr>`).join('')}</tbody></table></div>
            <div class="npp-text-sm npp-text-muted npp-mt-2">${rows.length} lượt tham gia · bấm 1 dòng để xem chi tiết + hình ảnh</div>`;
        renderPointsMap(document.getElementById('npp-km-partsmap'), mapPts);
        root.querySelectorAll('.npp-km-partrow').forEach((tr) => tr.addEventListener('click', () => participationDetailModal(tr.dataset.n)));
    } catch (err) {
        root.innerHTML = `<div class="npp-text-muted">${escapeHtml((err && err.message) || 'Lỗi')}</div>`;
    }
}

async function participationDetailModal(name) {
    showModal({ title: 'Đang tải…', body: '<div class="npp-skeleton" style="height:240px;"></div>' });
    try {
        const d = await api.call('npp.api.promo.npp_participation_detail', { name });
        const p = d.participation || {}, pt = d.point || {}, pg = d.program || {}, imgs = d.images || [];
        const imgGrid = imgs.length
            ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${imgs.map((im) => `<figure style="margin:0;"><img class="npp-zoomable" src="${escapeHtml(im.url)}" alt="${escapeHtml(im.label)}" loading="lazy" style="width:100%;height:150px;object-fit:cover;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface-2);"><figcaption class="npp-text-sm npp-text-muted" style="margin-top:4px;">${escapeHtml(im.label)}</figcaption></figure>`).join('')}</div>`
            : '<div class="npp-text-muted npp-text-sm">Chưa có hình ảnh</div>';
        showModal({
            title: '🏪 ' + escapeHtml(pt.point_name || p.display_point || ''),
            body: html`
                <div class="npp-card" style="margin-top:0;">
                    <div class="npp-flex npp-justify-between"><span class="npp-text-muted">Chương trình</span><strong style="text-align:right;">${escapeHtml(pg.program_name || '')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Trạng thái</span><span class="npp-badge npp-badge-${WF_BADGE[p.workflow_state] || 'muted'}">${escapeHtml(p.workflow_state || '—')}</span></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Địa chỉ</span><strong style="text-align:right;">${escapeHtml(pt.address_line || '—')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Điện thoại</span><strong>${escapeHtml(pt.phone || '—')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Cập nhật</span><strong>${p.modified ? formatDate(p.modified) : '—'}</strong></div>
                    ${p.reject_reason ? `<div class="npp-mt-2 npp-text-sm" style="color:var(--npp-danger);">Lý do từ chối: ${escapeHtml(p.reject_reason)}</div>` : ''}
                    ${(p.latitude && p.longitude) ? `<div class="npp-mt-2"><a href="https://www.google.com/maps?q=${p.latitude},${p.longitude}" target="_blank" rel="noopener" class="npp-link">📍 Mở bản đồ</a></div>` : ''}
                </div>
                <h4 class="npp-font-bold npp-mt-3">Hình ảnh tham gia</h4>
                <div class="npp-mt-2">${imgGrid}</div>`,
        });
    } catch (err) {
        showModal({ title: '⚠️ Lỗi', body: `<div class="npp-text-muted">${escapeHtml((err && err.message) || '')}</div>` });
    }
}
