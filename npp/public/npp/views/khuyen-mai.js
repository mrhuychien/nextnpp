import { html } from '../lib/dom.js';
import { formatDate, formatDateTime, formatNumber, escapeHtml, debounce } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';
import { showModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { paged } from '../components/data-table.js';
import { renderPointsMap, refreshMap } from '../components/map.js';
import { renderQR } from '../components/qr.js';
import { galleryHtml } from '../components/lightbox.js';   // bấm ảnh → xem to (delegated) + lưới nhiều ảnh
import {
    payoutSectionHtml, bindPayoutSection, payoutKpiHtml, progressTableHtml, payoutListTable,
    payStatusOptions, payOwnerOptions, payOwnerValid, filterPayRows, PAY_STATUS,
} from '../components/payout.js';   // trả thưởng 2 lần (salep doc/09)
import { downloadXlsx, fileStamp } from '../components/xlsx.js';   // xuất Excel (salep doc/10)

// Khuyến mại — NPP quản lý & theo dõi chương trình trưng bày TRÊN ĐỊA BÀN của mình.
// Dữ liệu từ app `salep` (cùng site), scope server-side theo require_customer.
// NV phụ trách điểm bán = Display Point.owner; gán/chuyển điểm, nghỉ việc, lịch sử NV
// gọi npp.api.promo.* → hàm lõi salep.api.npp_manage (salep doc/08).
// Trả thưởng điểm bán 2 lần (tab 💰 Trả thưởng + mục trong chi tiết lượt đã duyệt) gọi
// npp.api.promo.payout_progress / participation_payouts / record_payout / delete_payout → salep.api.payout (doc/09).
// Xuất Excel (salep doc/10): nút "⬇️ Xuất Excel" ở Nhân viên / Điểm bán / Chương trình / Trả thưởng + lịch sử NV
// → components/xlsx.js dựng .xlsx NGAY trên trình duyệt từ dữ liệu đã tải, theo đúng bộ lọc hiện tại.

const STATUS_BADGE = { 'Nháp': 'muted', 'Đang chạy': 'success', 'Kết thúc': 'primary' };
const WF_BADGE = { 'Nháp': 'muted', 'Chờ duyệt': 'warning', 'Đã duyệt': 'success', 'Từ chối': 'danger' };
const WF_STATES = ['Nháp', 'Chờ duyệt', 'Đã duyệt', 'Từ chối'];
const TABS = ['nv', 'db', 'ct', 'tt', 'bc'];
const PAGE = 20;                  // dòng/trang cho danh sách dài
const BULK_MAX = 1000;            // khớp salep npp_manage.BULK_MAX (điểm/lần gán)
const PARTS_LIMIT = 2000;         // npp_participations trả tối đa 2000 lượt mới nhất (khớp promo.PARTS_LIMIT)
const TARGET_NPP = '__npp__';     // đích "NPP giữ lại (chưa giao)" — khớp salep TARGET_NPP
const OWNER_OTHER = '__other__';  // lọc Phụ trách = "Khác" (owner_kind other)
const SALEP_OLD = 'Cần cập nhật app salep';
const APPROVED = 'Đã duyệt';
const PAY_ROWS_LIMIT = 5000;      // payout_progress trả tối đa 5000 lượt (khớp salep payout.progress)
const PAY_EP = {                  // endpoint trả thưởng phía chủ NPP (components/payout.js nhận làm tham số)
    get: 'npp.api.promo.participation_payouts',
    record: 'npp.api.promo.record_payout',
    remove: 'npp.api.promo.delete_payout',
};

let _staff = [];
let _points = [];
let _tab = 'nv';                  // tab đang mở — refresh() sau thao tác vẽ lại ĐÚNG tab này
let _ovSeq = 0;                   // chống response cũ ghi đè (npp_overview)
let _parts = [];                  // lượt tham gia của chương trình đang chọn
let _partsProg = '';
let _partsSeq = 0;
let _partsReady = false;          // _parts đã khớp _partsProg (false khi đang tải) — chặn xuất Excel dữ liệu cũ
let _programs = [];               // npp_overview.programs (sheet "Chương trình" + thưởng/điểm khi xuất)
let _customer = '';               // npp_overview.customer (dự phòng nhãn phạm vi tên file Excel)
let _partsMapDirty = false;       // map tham gia cần vẽ lại khi tab Chương trình hiện
let _ptRows = [];                 // điểm bán sau lọc (toàn bộ, không chỉ trang đang xem)
let _paRows = [];                 // lượt tham gia sau lọc
let _sf = {};                     // bộ lọc Nhân viên  {status, q}
let _pf = {};                     // bộ lọc Điểm bán   {q, owner, status, joined}
let _cf = {};                     // bộ lọc Tham gia   {q, owner, state}
const _selPts = new Set();        // điểm đã chọn — sống qua phân trang, tỉa theo bộ lọc
const _selParts = new Set();      // lượt đã chọn (tab Chương trình)
let _bulkBusy = false;
let _hist = null;                 // {staff, data, pill, sel} lịch sử NV đang xem (giữ khi "← Quay lại")
let _modalSeq = 0;                // modal tải dữ liệu: bỏ kết quả nếu người dùng đã mở/đóng modal khác
let _pay = null;                  // payout_progress đang xem {totals, programs, rows}
let _payFor = null;               // chương trình của _pay ('' = tất cả) — cache chỉ dùng khi khớp _payProg
let _payProg = '';                // tab Trả thưởng: chương trình đang lọc ('' = tất cả)
let _payPrograms = [];            // danh sách chương trình cho select (lấy từ lần tải KHÔNG lọc chương trình)
let _paySeq = 0;                  // chống response cũ ghi đè (payout_progress)
let _payLoaded = false;           // tab Trả thưởng đã tải sau lần renderBody gần nhất
let _payf = {};                   // bộ lọc Trả thưởng {status, owner, q}

function resetFilters() {
    _sf = { status: 'working', q: '' };
    _pf = { q: '', owner: '', status: '', joined: '' };
    _cf = { q: '', owner: '', state: '' };
    _payf = { status: '', owner: '', q: '' };
}
resetFilters();

function bar(pct, color) {
    pct = Math.max(0, Math.min(100, pct || 0));
    return `<div style="height:6px;background:var(--npp-surface-2);border-radius:4px;overflow:hidden;margin-top:4px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

// escapeHtml không thoát dấu " → dùng attr() cho giá trị nằm trong thuộc tính HTML.
function attr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

// Tìm không dấu: NFD + bỏ dấu + đ→d, chữ thường; mọi từ phải khớp (thứ tự bất kỳ).
function norm(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
}
function searchKey(vals, phone) {
    return norm(vals.filter(Boolean).join(' ')) + ' ' + String(phone || '').replace(/\D/g, '');
}
function matches(q, key) {
    const words = norm(q).split(' ').filter(Boolean);
    return words.every((w) => key.includes(w));
}
function byName(a, b) { return String(a.full_name || '').localeCompare(String(b.full_name || ''), 'vi'); }
function opts(list, sel) {
    return list.map(([val, label]) => `<option value="${attr(val)}"${val === sel ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

// Thông điệp lỗi từ api.call (exc có thể là traceback / mảng JSON) → câu tiếng Việt cuối.
function errText(err) {
    let s = String((err && err.message) || '');
    if (s.startsWith('[')) { try { s = JSON.parse(s).join('\n'); } catch (e) { /* bị cắt 500 ký tự → giữ nguyên */ } }
    const i = s.indexOf(SALEP_OLD);
    if (i >= 0) return s.slice(i).split(/["\n]/)[0];
    const m = s.match(/\w+Error: ([^\n]+)\s*$/);
    return m ? m[1] : s;
}
function errToast(err) {
    const t = errText(err);
    // App npp mới + salep cũ → báo nguyên văn "Cần cập nhật app salep…" (cảnh báo, không phải lỗi)
    if (t.includes(SALEP_OLD)) showToast(t, 'warning', 6000);
    else showToast('Lỗi: ' + t, 'error');
}

// Điều hướng giữa các modal lồng nhau (quy ước /ql-km): mỗi hàm mở modal nhận thêm
// `back` — hàm mở LẠI màn trước. Có back → "← Quay lại"; không có (mở từ trang) →
// "← Quay lại danh sách" = đóng modal, trả về đúng danh sách/tab đang đứng.
function backBar(back) {
    return `<div style="margin:-4px 0 8px;"><a href="javascript:void(0)" id="km-mback" class="npp-link">← ${back ? 'Quay lại' : 'Quay lại danh sách'}</a></div>`;
}
function bindBack(back) {
    const b = document.getElementById('km-mback');
    if (b) b.addEventListener('click', () => (back ? back() : closeModal()));
}
// Modal tải dữ liệu gắn data-mseq lên khung "Đang tải…"; mở modal khác / đóng → showModal/closeModal
// thay innerHTML → mất dấu → kết quả về muộn bị bỏ (kể cả khi modal khác không tăng _modalSeq).
function loadingModal(seq) {
    showModal({ title: 'Đang tải…', body: `<div data-mseq="${seq}" class="npp-skeleton" style="height:240px;"></div>` });
}
function modalAlive(seq) {
    return seq === _modalSeq
        && !!document.querySelector(`#npp-modal-mount.npp-show [data-mseq="${seq}"]`);
}

function isSelf(s) { return !!(s && (s.is_self || (s.user && s.user === window.NPP_CONTEXT?.user))); }
// Nhãn trạng thái NV — 1 nguồn cho badge trên màn hình và cột "Trạng thái" khi xuất Excel
function staffStatus(s) { return s.resigned ? 'Đã nghỉ' : (s.active ? 'Hoạt động' : 'Tạm dừng'); }
function staffBadge(s) {
    const tone = s.resigned ? 'danger' : (s.active ? 'success' : 'muted');
    return `<span class="npp-badge npp-badge-${tone}">${staffStatus(s)}</span>`;
}
function ownerCell(r) {
    if (r.owner_kind === 'npp') return '<span class="npp-badge npp-badge-muted">NPP giữ</span>';
    if (!r.staff_name) return '<span class="npp-text-muted">—</span>';
    if (r.owner_kind !== 'staff') return `<span class="npp-text-muted">${escapeHtml(r.staff_name)}</span>`;
    return escapeHtml(r.staff_name) + (r.staff_left ? ' <span class="npp-text-sm npp-text-muted">(đã nghỉ)</span>' : '');
}
function ownerOk(r, f) {
    if (!f) return true;
    if (f === TARGET_NPP) return r.owner_kind === 'npp';
    if (f === OWNER_OTHER) return r.owner_kind !== 'npp' && r.owner_kind !== 'staff';
    return r.staff === f;
}
// Select "Phụ trách": Tất cả / NPP giữ / NV đang làm / NV đã nghỉ / Khác (kèm số dòng của danh sách)
function ownerOptions(rows, sel) {
    const cnt = { npp: 0, other: 0 }, by = {};
    rows.forEach((r) => {
        if (r.owner_kind === 'npp') cnt.npp += 1;
        else if (r.owner_kind === 'staff' && r.staff) by[r.staff] = (by[r.staff] || 0) + 1;
        else cnt.other += 1;
    });
    const profs = _staff.filter((s) => s.name);
    const working = profs.filter((s) => !s.resigned).sort(byName);
    const left = profs.filter((s) => s.resigned).sort(byName);
    const o = (val, label) => `<option value="${attr(val)}"${val === sel ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    return o('', 'Phụ trách: Tất cả') + o(TARGET_NPP, `NPP giữ (chưa giao) · ${cnt.npp}`)
        + (working.length ? `<optgroup label="Nhân viên đang làm">${working.map((s) => o(s.name, `${s.full_name} · ${by[s.name] || 0}`)).join('')}</optgroup>` : '')
        + (left.length ? `<optgroup label="Đã nghỉ việc">${left.map((s) => o(s.name, `${s.full_name} (đã nghỉ) · ${by[s.name] || 0}`)).join('')}</optgroup>` : '')
        + o(OWNER_OTHER, `Khác · ${cnt.other}`);
}
function ownerValid(f) {
    return !f || f === TARGET_NPP || f === OWNER_OTHER || _staff.some((s) => s.name === f);
}
// Đích gán hợp lệ: NV của NPP, ĐANG LÀM và tài khoản ĐANG HOẠT ĐỘNG (server kiểm lại)
function validTargets(exclude) {
    return _staff.filter((s) => s.name && !s.resigned && s.active && s.name !== exclude).sort(byName);
}

// Giữ tab trên URL (F5 / gửi link mở đúng tab) — replaceState: không re-render.
function syncHash() {
    if (!location.hash.startsWith('#/khuyen-mai')) return;   // đã rời view
    try { history.replaceState(null, '', '#/khuyen-mai' + (_tab !== 'nv' ? '?t=' + _tab : '')); } catch (e) { /* bỏ qua */ }
}

export async function render({ container, query }) {
    _tab = TABS.includes(query?.t) ? query.t : 'nv';
    resetFilters();
    _partsProg = '';
    _payProg = ''; _pay = null; _payFor = null; _payPrograms = [];
    _parts = []; _ptRows = []; _paRows = []; _partsReady = false; _programs = []; _customer = '';
    _selPts.clear(); _selParts.clear();
    _hist = null; _bulkBusy = false;
    container.innerHTML = html`
        ${banner({ title: 'Khuyến mại', subtitle: 'Quản lý chương trình trưng bày trên địa bàn của bạn' })}
        <div id="npp-km-body"><div class="npp-skeleton" style="height:320px;"></div></div>
        <div id="npp-km-bulk" class="npp-bulkbar" role="toolbar" aria-label="Thao tác hàng loạt" hidden></div>
    `;
    // Thanh thao tác nằm TRONG view → rời view là mất theo; onclick gán 1 lần (sống qua refresh)
    document.getElementById('npp-km-bulk').onclick = onBulkClick;
    await refresh();
}

async function refresh() {
    const body = document.getElementById('npp-km-body');
    if (!body) return;
    // Lần đầu / sau lỗi → skeleton; các lần sau giữ nội dung cũ tới khi có dữ liệu mới (không nháy, giữ vị trí cuộn)
    if (!document.getElementById('npp-km-tabs')) body.innerHTML = '<div class="npp-skeleton" style="height:320px;"></div>';
    _hist = null;
    const seq = ++_ovSeq;
    try {
        const d = await api.call('npp.api.promo.npp_overview');
        if (seq !== _ovSeq || !document.getElementById('npp-km-body')) return;
        renderBody(d);
        loadParticipations(_partsProg);
    } catch (err) {
        if (seq !== _ovSeq) return;
        const msg = errText(err);
        const hint = msg.includes(SALEP_OLD) ? escapeHtml(msg)
            : (/salep|module Khuyến/i.test(msg)
                ? 'Site chưa cài module Khuyến mại (salep).'
                : (/custom_customer|chưa.*gán|not.*customer/i.test(msg)
                    ? 'Tài khoản chưa gán Nhà phân phối (Customer).'
                    : escapeHtml(msg)));
        const el = document.getElementById('npp-km-body');
        if (el) el.innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">🎁</div><div class="npp-empty-title">Chưa tải được dữ liệu khuyến mại</div><div class="npp-text-sm npp-text-muted">${hint}</div></div>`;
        updateBulkBar();
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
    _programs = programs;
    _customer = d.customer || '';
    if (!ownerValid(_pf.owner)) _pf.owner = '';
    if (!ownerValid(_cf.owner)) _cf.owner = '';
    if (_partsProg && !programs.some((p) => p.program === _partsProg)) _partsProg = '';
    _payLoaded = false;   // khung tab Trả thưởng vẽ lại → tải lại khi tab hiện (switchKmTab)
    const nLeft = staff.filter((s) => s.resigned).length;
    const hid = (k) => (_tab !== k ? ' hidden' : '');
    const tab = (k, label) => `<a href="javascript:void(0)" data-t="${k}"${_tab === k ? ' class="npp-active"' : ''}>${label}</a>`;

    const apprRate = t.participations ? (t.approved / t.participations * 100) : 0;
    const coverage = t.active_points ? (t.participated_points / t.active_points * 100) : 0;

    document.getElementById('npp-km-body').innerHTML = html`
        <div class="npp-ql-nav" id="npp-km-tabs">
            ${tab('nv', '👥 Nhân viên')}${tab('db', '🏪 Điểm bán')}${tab('ct', '🎯 Chương trình')}${tab('tt', '💰 Trả thưởng')}${tab('bc', '📊 Báo cáo')}
        </div>

        <!-- TAB Nhân viên -->
        <div id="npp-km-nv" class="npp-km-tab"${hid('nv')}>
            <div class="npp-card">
                <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                    <h3 class="npp-font-bold">Nhân viên & tiến độ</h3>
                    <div class="npp-flex npp-flex-wrap" style="gap:6px;">
                        ${staff.length ? xlBtn('npp-km-stxl', 'danh sách nhân viên') : ''}
                        <button id="npp-km-addstaff" type="button" class="npp-btn-primary" style="padding:7px 12px;font-size:.85rem;width:auto;flex:none;">➕ Thêm nhân viên</button>
                    </div>
                </div>
                ${selfStaff
                    ? html`<div class="npp-note-block npp-note-npp npp-mt-2" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span>✅ Bạn đã có hồ sơ nhân viên bán hàng — tự đi trưng bày được.</span>
                        <a href="/dp" class="npp-link">Mở portal nhân viên /dp →</a></div>`
                    : html`<div class="npp-note-block npp-note-internal npp-mt-2" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span>NPP cũng đi bán? Tạo hồ sơ nhân viên cho <strong>chính tài khoản này</strong> để tự trưng bày.</span>
                        <button id="npp-km-selfstaff" type="button" class="npp-btn-primary" style="padding:7px 12px;font-size:.85rem;width:auto;flex:none;">➕ Thêm mình làm nhân viên</button></div>`}
                ${staff.length ? html`
                    <div class="npp-ql-filters npp-km-filters npp-mt-3">
                        <select id="npp-km-stfilter" aria-label="Lọc theo trạng thái làm việc">${opts([['working', `Đang làm (${staff.length - nLeft})`], ['left', `Đã nghỉ (${nLeft})`], ['all', `Tất cả (${staff.length})`]], _sf.status)}</select>
                        <input id="npp-km-stq" type="search" class="npp-dh-search npp-km-search" placeholder="Tìm tên, SĐT…" value="${attr(_sf.q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
                    </div>
                    <div class="npp-km-result"><span id="npp-km-stinfo"></span><a href="javascript:void(0)" id="npp-km-stclear" class="npp-link" hidden>✕ Xoá lọc</a></div>
                    <div id="npp-km-stlist"></div>
                    <p class="npp-text-sm npp-text-muted npp-mt-2">Bấm vào nhân viên để xem lịch sử / sửa / đổi MK / chuyển điểm / nghỉ việc.</p>`
                    : `<div class="npp-mt-2">${emptyState({ icon: '👥', title: 'Chưa có nhân viên', message: 'Bấm "Thêm nhân viên" để bắt đầu.' })}</div>`}
            </div>
        </div>

        <!-- TAB Điểm bán -->
        <div id="npp-km-db" class="npp-km-tab"${hid('db')}>
            ${t.unassigned_points ? `<button type="button" id="npp-km-callout" class="npp-km-callout">
                <span>📌 <strong>${formatNumber(t.unassigned_points)}</strong> điểm NPP đang giữ — chia cho NV</span><span aria-hidden="true">›</span></button>` : ''}
            <div class="npp-card">
                <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                    <h3 class="npp-font-bold">Bản đồ điểm bán</h3>
                    <span class="npp-text-sm npp-text-muted">${points.filter((p) => p.latitude && p.longitude).length}/${points.length} điểm có toạ độ</span>
                </div>
                <div id="npp-km-map" class="npp-map-wrap"></div>
                <div class="npp-map-legend"><span><i style="background:#10b981;"></i>Hoạt động</span><span><i style="background:#94a3b8;"></i>Ngừng</span></div>
            </div>
            <div class="npp-card npp-mt-2" id="npp-km-ptcard">
                <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                    <h3 class="npp-font-bold">Danh sách điểm bán (${points.length})</h3>
                    <div class="npp-flex npp-flex-wrap" style="gap:6px;">
                        ${points.length ? xlBtn('npp-km-ptxl', 'danh sách điểm bán') : ''}
                        <button id="npp-km-addpoint" type="button" class="npp-btn-primary" style="padding:7px 12px;font-size:.85rem;width:auto;flex:none;">➕ Thêm điểm bán</button>
                    </div>
                </div>
                ${points.length ? html`
                    <div class="npp-ql-filters npp-km-filters npp-mt-3">
                        <input id="npp-km-ptq" type="search" class="npp-dh-search npp-km-search" placeholder="Tìm tên, SĐT, địa chỉ, NV…" value="${attr(_pf.q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
                        <select id="npp-km-ptowner" aria-label="Lọc theo nhân viên phụ trách">${ownerOptions(points, _pf.owner)}</select>
                        <select id="npp-km-ptstatus" aria-label="Lọc theo trạng thái">${opts([['', 'Trạng thái: Tất cả'], ['active', 'Hoạt động'], ['inactive', 'Ngừng']], _pf.status)}</select>
                        <select id="npp-km-ptjoin" aria-label="Lọc theo tham gia">${opts([['', 'Tham gia: Tất cả'], ['yes', 'Đã tham gia'], ['no', 'Chưa tham gia']], _pf.joined)}</select>
                    </div>
                    <div class="npp-km-result">
                        <label><input type="checkbox" class="npp-km-chk npp-km-ptall"> Chọn tất cả theo bộ lọc</label>
                        <span><span id="npp-km-ptinfo"></span> <a href="javascript:void(0)" id="npp-km-ptclear" class="npp-link" hidden>✕ Xoá lọc</a></span>
                    </div>
                    <div id="npp-km-ptlist"></div>
                    <p class="npp-text-sm npp-text-muted npp-mt-2">Bấm vào điểm bán để xem / sửa / gán NV · tích ô để thao tác hàng loạt.</p>`
                    : `<div class="npp-mt-2">${emptyState({ icon: '🏪', title: 'Chưa có điểm bán' })}</div>`}
            </div>
        </div>

        <!-- TAB Chương trình -->
        <div id="npp-km-ct" class="npp-km-tab"${hid('ct')}>
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
                                <a href="javascript:void(0)" class="npp-link npp-km-progfilter" data-p="${attr(p.program)}">Xem điểm tham gia →</a>
                            </div>
                        </div>`;
                    }).join('')}
                </div>` : `<div class="npp-mt-2">${emptyState({ icon: '📭', title: 'Chưa có chương trình' })}</div>`}
            </div>
            <div class="npp-card npp-mt-3">
                <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                    <h3 class="npp-font-bold">Điểm bán tham gia chương trình</h3>
                    ${xlBtn('npp-km-paxl', 'danh sách tham gia trưng bày')}
                </div>
                <div class="npp-ql-filters npp-km-filters npp-mt-3">
                    <select id="npp-km-progsel" aria-label="Lọc theo chương trình">
                        <option value="">Tất cả chương trình</option>
                        ${programs.map((p) => `<option value="${attr(p.program)}"${p.program === _partsProg ? ' selected' : ''}>${escapeHtml(p.program_name)}</option>`).join('')}
                    </select>
                    <select id="npp-km-paowner" aria-label="Lọc theo nhân viên phụ trách">${ownerOptions([], _cf.owner)}</select>
                    <select id="npp-km-pastate" aria-label="Lọc theo trạng thái duyệt">${opts([['', 'Trạng thái: Tất cả'], ...WF_STATES.map((s) => [s, s])], _cf.state)}</select>
                    <input id="npp-km-paq" type="search" class="npp-dh-search npp-km-search" placeholder="Tìm điểm bán, SĐT, NV…" value="${attr(_cf.q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
                </div>
                <div class="npp-km-result">
                    <label><input type="checkbox" class="npp-km-chk npp-km-paall"> Chọn tất cả theo bộ lọc</label>
                    <span><span id="npp-km-painfo"></span> <a href="javascript:void(0)" id="npp-km-paclear" class="npp-link" hidden>✕ Xoá lọc</a></span>
                </div>
                <div id="npp-km-parts" class="npp-mt-2"><div class="npp-skeleton" style="height:160px;"></div></div>
            </div>
        </div>

        <!-- TAB Trả thưởng (2 lần / lượt đã duyệt — salep doc/09) -->
        <div id="npp-km-tt" class="npp-km-tab"${hid('tt')}>
            <div class="npp-card">
                <h3 class="npp-font-bold">Tiến độ trả thưởng</h3>
                <div class="npp-ql-filters npp-km-filters npp-mt-3">
                    <select id="npp-km-ttprog" aria-label="Lọc theo chương trình"><option value="">Tất cả chương trình</option></select>
                </div>
                <div id="npp-km-ttprogress" class="npp-mt-3"><div class="npp-skeleton" style="height:160px;"></div></div>
            </div>
            <div class="npp-card npp-mt-3" id="npp-km-ttcard">
                <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:6px;">
                    <h3 class="npp-font-bold">Điểm bán đủ điều kiện (lượt đã duyệt)</h3>
                    ${xlBtn('npp-km-ttxl', 'danh sách trả thưởng')}
                </div>
                <div class="npp-ql-filters npp-km-filters npp-mt-3">
                    <select id="npp-km-ttst" aria-label="Lọc theo trạng thái trả thưởng">${payStatusOptions([], _payf.status)}</select>
                    <select id="npp-km-ttowner" aria-label="Lọc theo nhân viên phụ trách">${payOwnerOptions([], _payf.owner)}</select>
                    <input id="npp-km-ttq" type="search" class="npp-dh-search npp-km-search" placeholder="Tìm điểm bán, SĐT, NV…" value="${attr(_payf.q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
                </div>
                <div class="npp-km-result"><span id="npp-km-ttinfo"></span><a href="javascript:void(0)" id="npp-km-ttclear" class="npp-link" hidden>✕ Xoá lọc</a></div>
                <div id="npp-km-ttlist" class="npp-mt-2"><div class="npp-skeleton" style="height:160px;"></div></div>
                <p class="npp-text-sm npp-text-muted npp-mt-2">Bấm 1 dòng để ghi / sửa / xoá trả thưởng (2 lần, kèm ảnh trả thưởng).</p>
            </div>
        </div>

        <!-- TAB Báo cáo -->
        <div id="npp-km-bc" class="npp-km-tab"${hid('bc')}>
            <div class="npp-kpi-grid">
                <div class="npp-kpi-card"><div class="npp-kpi-label">Chương trình đang chạy</div><div class="npp-kpi-value">${t.running || 0}<span style="font-size:.8rem;font-weight:600;">/${t.programs || 0}</span></div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Điểm bán</div><div class="npp-kpi-value">${t.active_points || 0}<span style="font-size:.8rem;font-weight:600;">/${t.points || 0}</span></div><div class="npp-kpi-sub">${t.participated_points || 0} điểm đã tham gia${t.unassigned_points ? ` · ${t.unassigned_points} NPP giữ` : ''}</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Lượt được duyệt</div><div class="npp-kpi-value">${formatNumber(t.approved || 0)}</div><div class="npp-kpi-sub">/${formatNumber(t.participations || 0)} lượt</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Nhân viên</div><div class="npp-kpi-value">${t.staff || 0}</div>${t.staff_left ? `<div class="npp-kpi-sub">${t.staff_left} đã nghỉ việc</div>` : ''}</div>
            </div>
            <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Tổng quan</h3>
                <div class="npp-flex npp-justify-between npp-text-sm npp-mt-2"><span>Tỷ lệ duyệt</span><strong>${apprRate.toFixed(0)}%</strong></div>${bar(apprRate, 'var(--npp-success)')}
                <div class="npp-flex npp-justify-between npp-text-sm npp-mt-3"><span>Độ phủ điểm bán (đã tham gia)</span><strong>${coverage.toFixed(0)}%</strong></div>${bar(coverage, 'var(--npp-primary, #3b82f6)')}
            </div>
        </div>
    `;

    document.querySelectorAll('#npp-km-tabs a').forEach((a) => a.addEventListener('click', () => switchKmTab(a.dataset.t)));
    document.getElementById('npp-km-addstaff')?.addEventListener('click', () => openCreateStaff());
    document.getElementById('npp-km-selfstaff')?.addEventListener('click', addSelfAsStaff);
    document.getElementById('npp-km-addpoint')?.addEventListener('click', () => { window.location.href = '/dp#/points/new'; });
    [['npp-km-stxl', exportStaff], ['npp-km-ptxl', exportPoints], ['npp-km-paxl', exportParts], ['npp-km-ttxl', exportPayouts]]
        .forEach(([id, fn]) => document.getElementById(id)?.addEventListener('click', (e) => fn(e.currentTarget)));
    bindStaffFilters();
    bindPointFilters();
    bindPartFilters();
    bindPayFilters();
    renderStaffList();
    renderPointList();
    switchKmTab(_tab);
}

function switchKmTab(t) {
    _tab = TABS.includes(t) ? t : 'nv';
    document.querySelectorAll('#npp-km-tabs a').forEach((a) => a.classList.toggle('npp-active', a.dataset.t === _tab));
    TABS.forEach((k) => {
        const el = document.getElementById('npp-km-' + k);
        if (el) el.hidden = (k !== _tab);
    });
    if (_tab === 'db') initPointsMap();   // map phải khởi tạo/refresh khi tab đã hiện (Leaflet)
    if (_tab === 'ct') {                   // map tham gia: vẽ khi tab hiện (lọc lúc ẩn → đánh dấu vẽ lại)
        if (_partsMapDirty) drawPartsMap();
        else refreshMap(document.getElementById('npp-km-partsmap'));
    }
    if (_tab === 'tt' && !_payLoaded) loadPayouts();   // tải khi mở tab (không tải sẵn cùng npp_overview)
    syncHash();
    updateBulkBar();   // thanh hàng loạt chỉ thuộc tab đang mở
}

// ─── Chọn nhiều (Set ở module — sống qua phân trang) ───────────────────
function pruneSel(set, rows) {
    if (!set.size) return;
    const keep = new Set(rows.map((r) => r.name));
    [...set].forEach((n) => { if (!keep.has(n)) set.delete(n); });
}
function setAll(set, rows, on) { rows.forEach((r) => (on ? set.add(r.name) : set.delete(r.name))); }
function syncAllBoxes(cls, rows, set) {
    const n = rows.reduce((k, r) => k + (set.has(r.name) ? 1 : 0), 0);
    document.querySelectorAll('input.' + cls).forEach((cb) => {
        cb.checked = rows.length > 0 && n === rows.length;
        cb.indeterminate = n > 0 && n < rows.length;
    });
}
function syncRowChecks(root, set) {
    if (!root) return;
    root.querySelectorAll('tbody input.npp-km-chk[data-n]').forEach((cb) => {
        cb.checked = set.has(cb.dataset.n);
        cb.closest('tr')?.classList.toggle('npp-km-sel', cb.checked);
    });
}
// onDraw của paged(): GÁN el.onclick (wrapper sống qua các trang → addEventListener sẽ chồng)
function bindSelectable(el, { set, rows, allCls, rowSel, open }) {
    el.onclick = (e) => {
        const cell = e.target.closest('.npp-km-chkcell');
        if (cell) {
            const cb = cell.querySelector('input.npp-km-chk');
            if (!cb) return;
            if (e.target !== cb) cb.checked = !cb.checked;   // bấm vùng ô (mobile: cả dòng "Chọn")
            if (cb.dataset.all) {
                setAll(set, rows(), cb.checked);
                syncRowChecks(el, set);
            } else {
                if (cb.checked) set.add(cb.dataset.n); else set.delete(cb.dataset.n);
                cb.closest('tr')?.classList.toggle('npp-km-sel', cb.checked);
            }
            syncAllBoxes(allCls, rows(), set);
            updateBulkBar();
            return;
        }
        const tr = e.target.closest(rowSel);
        if (tr) open(tr.dataset.n);
    };
    syncAllBoxes(allCls, rows(), set);
}
function setResult(prefix, text, filtered) {
    const info = document.getElementById(`npp-km-${prefix}info`);
    if (info) info.textContent = text;
    const clear = document.getElementById(`npp-km-${prefix}clear`);
    if (clear) clear.hidden = !filtered;
}
function capOk(n) {
    if (!n) { showToast('Chưa chọn điểm bán nào', 'warning'); return false; }
    if (n > BULK_MAX) {
        showToast(`Tối đa ${formatNumber(BULK_MAX)} điểm mỗi lần — đang chọn ${formatNumber(n)}. Thu hẹp bộ lọc rồi làm nhiều lượt.`, 'warning', 5000);
        return false;
    }
    return true;
}

// ─── Thanh thao tác hàng loạt (cố định đáy, trên bottom nav) ──────────
function selectedPartPoints() {
    const pts = new Set();
    _parts.forEach((r) => { if (_selParts.has(r.name) && r.display_point) pts.add(r.display_point); });
    return [...pts];
}
function updateBulkBar() {
    const barEl = document.getElementById('npp-km-bulk');
    if (!barEl) return;
    const wrap = document.getElementById('npp-km-body');
    const set = _tab === 'db' ? _selPts : (_tab === 'ct' ? _selParts : null);
    if (!set || !set.size || !document.getElementById('npp-km-tabs')) {
        barEl.hidden = true;
        barEl.innerHTML = '';
        if (wrap) wrap.style.paddingBottom = '';
        return;
    }
    const dis = _bulkBusy ? ' disabled' : '';
    barEl.innerHTML = _tab === 'db'
        ? `<span class="npp-bulkbar-count">Đã chọn <strong>${formatNumber(set.size)}</strong> điểm</span>
            <button type="button" class="npp-btn-primary" data-bulk="assign"${dis}>👤 Gán NV phụ trách</button>
            <button type="button" class="npp-cn-btn" data-bulk="off"${dis}>⏸ Ngừng HĐ</button>
            <button type="button" class="npp-cn-btn" data-bulk="on"${dis}>▶ Kích hoạt</button>
            <button type="button" class="npp-cn-btn" data-bulk="clear"${dis}>✕ Bỏ chọn</button>`
        : `<span class="npp-bulkbar-count">Đã chọn <strong>${formatNumber(set.size)}</strong> lượt · ${formatNumber(selectedPartPoints().length)} điểm</span>
            <button type="button" class="npp-btn-primary" data-bulk="assign"${dis}>👤 Gán NV phụ trách điểm bán</button>
            <button type="button" class="npp-cn-btn" data-bulk="clear"${dis}>✕ Bỏ chọn</button>`;
    barEl.hidden = false;
    // Chừa chỗ cuối danh sách để thanh cố định không che dòng cuối
    if (wrap) wrap.style.paddingBottom = (barEl.offsetHeight + 12) + 'px';
}
// Bỏ chọn: chỉ gỡ tích trên trang đang xem (không vẽ lại danh sách → không nhảy về trang 1)
function clearSel(set, listId, allCls, rows) {
    set.clear();
    syncRowChecks(document.getElementById(listId), set);
    syncAllBoxes(allCls, rows, set);
    updateBulkBar();
}
function onBulkClick(e) {
    const b = e.target.closest('[data-bulk]');
    if (!b || b.disabled) return;
    const act = b.dataset.bulk;
    if (_tab === 'db') {
        if (act === 'clear') return clearSel(_selPts, 'npp-km-ptlist', 'npp-km-ptall', _ptRows);
        const points = [..._selPts];
        if (act === 'assign') openAssignModal(points, { onDone: () => _selPts.clear() });
        else bulkSetActive(points, act === 'on' ? 1 : 0, b);
    } else if (_tab === 'ct') {
        if (act === 'clear') return clearSel(_selParts, 'npp-km-palist', 'npp-km-paall', _paRows);
        if (act === 'assign') openAssignModal(selectedPartPoints(), { fromParts: _selParts.size, onDone: () => _selParts.clear() });
    }
}
async function bulkSetActive(points, active, btn) {
    if (!capOk(points.length)) return;
    if (!window.confirm(`${active ? 'Kích hoạt' : 'Ngừng hoạt động'} ${points.length} điểm bán đã chọn?`)) return;
    _bulkBusy = true;
    btn.textContent = '⏳ Đang lưu…';
    document.querySelectorAll('#npp-km-bulk button').forEach((x) => { x.disabled = true; });
    try {
        const r = await api.call('npp.api.promo.set_points_active', { points, active });
        _bulkBusy = false;
        showToast(`${active ? 'Đã kích hoạt' : 'Đã ngừng hoạt động'} ${formatNumber((r && r.updated) ?? points.length)} điểm bán`, 'success');
        _selPts.clear();
        updateBulkBar();
        refresh();
    } catch (err) {
        _bulkBusy = false;
        errToast(err);
        updateBulkBar();   // khôi phục nút
    }
}

// ─── Xuất Excel (salep doc/10) ─────────────────────────────────────────
// File .xlsx dựng trên trình duyệt từ dữ liệu ĐÃ TẢI, theo đúng bộ lọc / tìm kiếm hiện tại: lấy từ
// filtered*() / filterPayRows() trên TOÀN BỘ dòng (mọi trang của paged(), không chỉ trang đang xem).
// Server đã scope theo NPP (require_customer) → file không chứa gì ngoài phạm vi người dùng được xem.
// Key bổ sung phía server (doc/10 §4: tax_code, bank_*, creation, point_bank_*, reward_per_point, staff[].cccd,
// staff_history.participations[].point_phone/reject_reason/latitude/longitude) — server cũ thiếu → ô trống, không vỡ.
function xlScope() {
    const c = window.NPP_CONTEXT || {};
    return c.customerName || c.customer || _customer || '';
}
function xlBtn(id, what) {
    return `<button id="${id}" type="button" class="npp-cn-btn" style="padding:7px 12px;font-size:.85rem;width:auto;flex:none;" aria-label="Xuất Excel ${attr(what)}">⬇️ Xuất Excel</button>`;
}
// Nút xuất khoá TỐI THIỂU chừng này ms: file nhỏ dựng xong trong ~20–150ms, ngắn hơn khoảng cách 2 lần bấm
// của 1 double-click / chạm 2 lần thật (50–500ms) → chỉ khoá "khi đang dựng" vẫn ra 2 file.
const XL_LOCK_MS = 800;
/**
 * Bấm "⬇️ Xuất Excel": chống bấm 2 lần (disable khi đang dựng + tối thiểu XL_LOCK_MS) → build() trả
 * [sheet chính, ...sheet phụ] (null = build đã tự báo, không xuất). Sheet chính 0 dòng → cảnh báo, không tải.
 * Toast "Đã xuất N dòng" với N = số dòng sheet chính (countAll → tổng mọi sheet, cho lịch sử NV 3 sheet
 * ngang hàng); note() trả chuỗi (vd. danh sách đã chạm trần server) → nối vào toast dạng cảnh báo.
 */
async function runExport(btn, base, build, { countAll = false, note = null } = {}) {
    if (!btn || btn.disabled) return;
    const label = btn.textContent;
    const t0 = Date.now();
    btn.disabled = true;
    btn.textContent = '⏳ Đang xuất…';
    try {
        const sheets = build();
        if (!sheets) return;
        const n = countAll ? sheets.reduce((k, sh) => k + sh.rows.length, 0) : sheets[0].rows.length;
        if (!n) { showToast('Không có dòng nào để xuất', 'warning'); return; }
        await downloadXlsx(fileStamp(xlScope(), base), sheets);
        const extra = note ? note() : '';
        if (extra) showToast(`Đã xuất ${formatNumber(n)} dòng — ${extra}`, 'warning', 6000);
        else showToast(`Đã xuất ${formatNumber(n)} dòng`, 'success');
    } catch (err) {
        console.error('[npp] xuất Excel', err);
        showToast('Lỗi xuất Excel: ' + ((err && err.message) || err), 'error', 5000);
    } finally {
        btn.textContent = label;
        setTimeout(() => { btn.disabled = false; }, Math.max(0, XL_LOCK_MS - (Date.now() - t0)));
    }
}
function xc(header, value, type = 'text') { return { header, value, type }; }
const XC_STT = xc('STT', (r, i) => i + 1, 'int');
// Phụ trách = staff_name server dựng (doc/10 §2): "NPP (chưa giao)" / tên NV (+ "(đã nghỉ)") / tài khoản khác
// — cùng nhãn file Excel của /dp và /ql-km (badge "NPP giữ" chỉ là cách hiển thị gọn trên màn hình).
const NPP_HOLD_LABEL = 'NPP (chưa giao)';   // khớp promo.NPP_HOLD_LABEL
function ownerLabel(r) {
    if (r.owner_kind === 'npp') return r.staff_name || NPP_HOLD_LABEL;
    if (!r.staff_name) return '';
    return r.staff_name + (r.owner_kind === 'staff' && r.staff_left ? ' (đã nghỉ)' : '');
}
const pointStatus = (p) => (p.is_active ? 'Hoạt động' : 'Ngừng');
const pctOf = (n, total) => (total ? (Number(n) || 0) / total * 100 : '');
const coord = (v) => (Number(v) ? v : '');   // Float chưa nhập = 0 → "chưa có toạ độ" (như bản đồ) → ô trống

function staffColumns() {
    return [
        XC_STT,
        xc('Mã NV', (s) => s.name),
        xc('Họ tên', (s) => s.full_name),
        xc('SĐT (đăng nhập)', (s) => s.phone),
        xc('CCCD', (s) => s.cccd),
        xc('Trạng thái', staffStatus),
        xc('Ngày nghỉ', (s) => (s.resigned ? s.left_on : ''), 'date'),
        xc('Số điểm phụ trách', (s) => s.points || 0, 'int'),
        xc('Lượt tham gia', (s) => s.total || 0, 'int'),
        xc('Đã duyệt', (s) => s.approved || 0, 'int'),
        xc('Tỷ lệ duyệt %', (s) => pctOf(s.approved, s.total), 'percent'),   // chưa có lượt → ô trống (không phải 0%)
    ];
}
function pointColumns() {
    return [
        XC_STT,
        xc('Mã điểm', (p) => p.name),
        xc('Tên điểm bán', (p) => p.point_name),
        xc('SĐT', (p) => p.phone),
        xc('Địa chỉ', (p) => p.address_line),
        xc('Mã số thuế', (p) => p.tax_code),
        xc('NV phụ trách', ownerLabel),
        xc('Trạng thái', pointStatus),
        xc('Số lượt tham gia', (p) => p.participations || 0, 'int'),
        xc('Lượt đã duyệt', (p) => p.approved || 0, 'int'),
        xc('Chủ TK nhận thưởng', (p) => p.bank_account_name),
        xc('Số TK', (p) => p.bank_account_no),
        xc('Ngân hàng', (p) => p.bank_name),
        xc('Vĩ độ', (p) => coord(p.latitude), 'number'),
        xc('Kinh độ', (p) => coord(p.longitude), 'number'),
        xc('Ngày tạo', (p) => p.creation, 'date'),
    ];
}
function partColumns() {
    return [
        XC_STT,
        xc('Mã lượt', (r) => r.name),
        xc('Mã điểm', (r) => r.display_point),
        xc('Điểm bán', (r) => r.point_name || r.display_point),
        xc('SĐT điểm', (r) => r.point_phone),
        xc('Chương trình', (r) => r.program_name || r.promotion_program),
        xc('NV phụ trách', ownerLabel),
        xc('Trạng thái duyệt', (r) => r.workflow_state),
        xc('Lý do từ chối', (r) => (r.workflow_state === 'Từ chối' ? r.reject_reason : '')),   // như màn hình: chỉ lượt Từ chối
        xc('Cập nhật', (r) => r.modified, 'datetime'),
        xc('Vĩ độ', (r) => coord(r.latitude), 'number'),
        xc('Kinh độ', (r) => coord(r.longitude), 'number'),
    ];
}
function programColumns() {
    return [
        xc('Chương trình', (p) => p.program_name || p.program),
        xc('Trạng thái', (p) => p.status),
        xc('Bắt đầu', (p) => p.start_date, 'date'),
        xc('Kết thúc', (p) => p.end_date, 'date'),
        xc('Thưởng/điểm', (p) => p.reward_per_point || '', 'int'),   // 0 = chưa đặt mức → trống (như màn hình)
        xc('Lượt tham gia', (p) => p.participations || 0, 'int'),
        xc('Đã duyệt', (p) => p.approved || 0, 'int'),
        xc('Điểm đã duyệt', (p) => p.approved_points || 0, 'int'),
        xc('Độ phủ %', (p) => p.coverage_pct || 0, 'percent'),
    ];
}
function payColumns(rewardOf) {
    const rd = (x, k) => (x ? (k === 'photos' ? x.photos || 0 : x.payout_date) : '');   // lần chưa trả → trống
    return [
        XC_STT,
        xc('Chương trình', (r) => r.program_name || r.promotion_program),
        xc('Mã lượt', (r) => r.participation),
        xc('Mã điểm', (r) => r.display_point),
        xc('Điểm bán', (r) => r.point_name || r.display_point),
        xc('SĐT', (r) => r.point_phone),
        xc('NV phụ trách', (r) => r.staff_name || r.owner),
        xc('Lần 1 – ngày', (r) => rd(r.round_1, 'date'), 'date'),
        xc('Lần 1 – số ảnh', (r) => rd(r.round_1, 'photos'), 'int'),
        xc('Lần 2 – ngày', (r) => rd(r.round_2, 'date'), 'date'),
        xc('Lần 2 – số ảnh', (r) => rd(r.round_2, 'photos'), 'int'),
        xc('Trạng thái', (r) => PAY_STATUS[r.status] || r.status),
        xc('Thưởng/điểm', rewardOf, 'int'),
        xc('Chủ TK nhận thưởng', (r) => r.point_bank_account_name),
        xc('Số TK', (r) => r.point_bank_account_no),
        xc('Ngân hàng', (r) => r.point_bank_name),
    ];
}
function paySummaryColumns() {
    return [
        xc('Chương trình', (p) => p.program_name || p.program),
        xc('Trạng thái CT', (p) => p.status),
        xc('Đủ điều kiện', (p) => p.eligible || 0, 'int'),
        xc('Đã trả lần 1', (p) => p.paid_1 || 0, 'int'),
        xc('% lần 1', (p) => pctOf(p.paid_1, p.eligible), 'percent'),
        xc('Đã trả lần 2', (p) => p.paid_2 || 0, 'int'),
        xc('% lần 2', (p) => pctOf(p.paid_2, p.eligible), 'percent'),
    ];
}
function transferColumns() {
    return [
        XC_STT,
        xc('Thời gian', (r) => r.creation, 'datetime'),
        xc('Mã điểm', (r) => r.display_point),
        xc('Điểm bán', (r) => r.point_name || r.display_point),
        xc('Nhận / Giao', (r) => (r.direction === 'in' ? 'Nhận' : 'Giao')),
        xc('Từ / Cho', (r) => r.counterpart_label),
        xc('Số lượt chuyển', (r) => r.participations_moved || 0, 'int'),
        xc('Lý do', (r) => r.reason),
        xc('Ghi chú', (r) => r.note),
        xc('Người thực hiện', (r) => r.by_label),
    ];
}

function exportStaff(btn) {
    runExport(btn, 'NhanVien', () => [{ name: 'Nhân viên', columns: staffColumns(), rows: filteredStaff() }]);
}
function exportPoints(btn) {
    runExport(btn, 'DiemBan', () => [{ name: 'Điểm bán', columns: pointColumns(), rows: filteredPoints() }]);
}
// Tab Chương trình: lượt tham gia theo bộ lọc (chương trình + phụ trách + trạng thái + tìm) + sheet
// "Chương trình" (npp_overview.programs; đang lọc 1 chương trình → chỉ chương trình đó).
function exportParts(btn) {
    runExport(btn, 'ThamGiaTrungBay', () => {
        if (!_partsReady) { showToast('Danh sách tham gia đang tải — thử lại sau giây lát', 'warning'); return null; }
        const progs = _partsProg ? _programs.filter((p) => p.program === _partsProg) : _programs;
        return [
            { name: 'Tham gia trưng bày', columns: partColumns(), rows: filteredParts() },
            { name: 'Chương trình', columns: programColumns(), rows: progs },
        ];
    }, {
        note: () => (_parts.length >= PARTS_LIMIT
            ? `chỉ gồm ${formatNumber(PARTS_LIMIT)} lượt cập nhật gần nhất${_partsProg ? '' : ', chọn 1 chương trình để xuất đủ'}` : ''),
    });
}
// Tab Trả thưởng: "Chi tiết" = lượt theo bộ lọc (chương trình + trạng thái trả + phụ trách + tìm);
// "Tổng hợp" = payout_progress.programs (đang lọc 1 chương trình → chỉ chương trình đó).
function exportPayouts(btn) {
    runExport(btn, 'TraThuong', () => {
        if (!_pay || !_payLoaded || _payFor !== _payProg) {
            showToast('Dữ liệu trả thưởng chưa tải xong', 'warning');
            return null;
        }
        const programs = _pay.programs || [];
        // Thưởng/điểm: key reward_per_point của dòng (server mới) → không có thì lấy theo chương trình
        const reward = new Map();
        [..._programs, ..._payPrograms, ...programs].forEach((p) => { if (p.reward_per_point) reward.set(p.program, p.reward_per_point); });
        const rewardOf = (r) => r.reward_per_point || reward.get(r.promotion_program) || '';
        return [
            { name: 'Chi tiết', columns: payColumns(rewardOf), rows: filterPayRows(_pay.rows || [], _payf) },
            { name: 'Tổng hợp', columns: paySummaryColumns(), rows: _payProg ? programs.filter((p) => p.program === _payProg) : programs },
        ];
    }, {
        note: () => (((_pay && _pay.rows) || []).length >= PAY_ROWS_LIMIT
            ? `chi tiết chỉ gồm ${formatNumber(PAY_ROWS_LIMIT)} lượt đầu${_payProg ? '' : ', chọn 1 chương trình để xuất đủ'}` : ''),
    });
}
// Modal lịch sử 1 NV (staff_history): 3 sheet Điểm bán · Tham gia · Bàn giao.
// - Tham gia: SĐT điểm / lý do từ chối / toạ độ lượt lấy THẲNG từ staff_history.participations (salep doc/10 §4 —
//   đủ cho MỌI lượt của NV, kể cả lượt ngoài chương trình đang lọc / khi danh sách tham gia chưa tải; null = không có,
//   vd. điểm ngoài NPP / đã xoá → giữ trống, không bù). Salep cũ chưa trả key → bù từ _parts (lượt) rồi _points (SĐT).
// - Điểm bán: MST, TK nhận thưởng, ngày tạo (staff_history không trả) bù từ _points đã tải.
const HIST_PART_KEYS = ['point_phone', 'reject_reason', 'latitude', 'longitude'];
function exportHistory(h, btn) {
    runExport(btn, 'LichSuNhanVien', () => {
        const d = h.data || {};
        const info = d.staff || {};
        const byPt = new Map(_points.map((p) => [p.name, p]));
        const byPart = new Map(_parts.map((r) => [r.name, r]));
        const me = { owner_kind: 'staff', staff_name: info.full_name || (_staff.find((s) => s.name === h.staff) || {}).full_name || '', staff_left: !!info.resigned };
        const pts = (d.points || []).map((p) => ({ ...me, ...(byPt.get(p.name) || {}), ...p }));
        const pas = (d.participations || []).map((r) => {
            const old = byPart.get(r.name) || {};
            const row = { ...me, ...old, ...r };
            HIST_PART_KEYS.forEach((k) => {
                if (k in r) return;   // server mới: giá trị của dòng (kể cả null)
                row[k] = k in old ? old[k] : (k === 'point_phone' ? (byPt.get(r.display_point) || {}).phone : undefined);
            });
            return row;
        });
        return [
            { name: 'Điểm bán', columns: pointColumns(), rows: pts },
            { name: 'Tham gia', columns: partColumns(), rows: pas },
            { name: 'Bàn giao', columns: transferColumns(), rows: d.transfers || [] },
        ];
    }, { countAll: true });
}

// ─── TAB Nhân viên ─────────────────────────────────────────────────────
function staffKey(s) { return s._k || (s._k = searchKey([s.full_name, s.phone, s.user], s.phone)); }
function filteredStaff() {
    return _staff.filter((s) => (_sf.status === 'all' || (_sf.status === 'left' ? !!s.resigned : !s.resigned))
        && (!_sf.q || matches(_sf.q, staffKey(s))));
}
function bindStaffFilters() {
    const st = document.getElementById('npp-km-stfilter');
    const q = document.getElementById('npp-km-stq');
    if (!st || !q) return;
    st.addEventListener('change', () => { _sf.status = st.value; renderStaffList(); });
    q.addEventListener('input', debounce(() => { _sf.q = q.value || ''; renderStaffList(); }, 200));
    document.getElementById('npp-km-stclear')?.addEventListener('click', () => {
        _sf = { status: 'working', q: '' };
        st.value = 'working'; q.value = '';
        renderStaffList();
    });
}
function renderStaffList() {
    const root = document.getElementById('npp-km-stlist');
    if (!root) return;
    const rows = filteredStaff();
    setResult('st', `${rows.length}/${_staff.length} nhân viên`, _sf.status !== 'working' || !!_sf.q);
    if (!rows.length) {
        root.innerHTML = emptyState({ icon: '🔍', title: 'Không có nhân viên phù hợp', message: 'Đổi bộ lọc hoặc bấm "Xoá lọc".' });
        return;
    }
    root.innerHTML = paged({
        rows, pageSize: PAGE, render: staffTable,
        onDraw: (el) => {
            el.onclick = (e) => {
                const tr = e.target.closest('.npp-km-staffrow');
                if (tr) staffModal(tr.dataset.n);
            };
        },
    });
}
function staffTable(slice) {
    return `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
        <thead><tr><th>Nhân viên</th><th class="npp-text-center">Trạng thái</th><th class="npp-text-end">Điểm bán</th><th class="npp-text-end">Lượt</th><th class="npp-text-end">Đã duyệt</th><th style="min-width:100px;">Tỷ lệ</th></tr></thead>
        <tbody>${slice.map((s) => {
            const rate = s.total ? s.approved / s.total * 100 : 0;
            return `<tr class="${s.name ? 'npp-km-staffrow' : ''}" data-n="${attr(s.name || '')}" style="${s.name ? 'cursor:pointer;' : ''}">
                <td data-label="Nhân viên"><div><strong>${escapeHtml(s.full_name)}</strong>${s.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(s.phone)}</div>` : ''}</div></td>
                <td data-label="Trạng thái" class="npp-text-center"><div>${staffBadge(s)}${s.resigned && s.left_on ? `<div class="npp-text-sm npp-text-muted">từ ${formatDate(s.left_on)}</div>` : ''}</div></td>
                <td data-label="Điểm bán" class="npp-text-end">${formatNumber(s.points || 0)}</td>
                <td data-label="Lượt" class="npp-text-end">${formatNumber(s.total)}</td>
                <td data-label="Đã duyệt" class="npp-text-end"><strong style="color:var(--npp-success);">${formatNumber(s.approved)}</strong></td>
                <td data-label="Tỷ lệ"><div style="min-width:90px;">${rate.toFixed(0)}%${bar(rate, 'var(--npp-success)')}</div></td>
            </tr>`;
        }).join('')}</tbody></table></div>`;
}

// ─── TAB Điểm bán ──────────────────────────────────────────────────────
function pointKey(p) { return p._k || (p._k = searchKey([p.point_name, p.phone, p.address_line, p.staff_name], p.phone)); }
function filteredPoints() {
    const f = _pf;
    return _points.filter((p) => ownerOk(p, f.owner)
        && (!f.status || (f.status === 'active' ? !!p.is_active : !p.is_active))
        && (!f.joined || (f.joined === 'yes' ? !!p.participated : !p.participated))
        && (!f.q || matches(f.q, pointKey(p))));
}
function pointsFiltered() { return !!(_pf.q || _pf.owner || _pf.status || _pf.joined); }
function setPointFilters(f) {
    _pf = { q: '', owner: '', status: '', joined: '', ...f };
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('npp-km-ptq', _pf.q); set('npp-km-ptowner', _pf.owner); set('npp-km-ptstatus', _pf.status); set('npp-km-ptjoin', _pf.joined);
    renderPointList();
}
function bindPointFilters() {
    document.getElementById('npp-km-callout')?.addEventListener('click', () => {
        setPointFilters({ owner: TARGET_NPP });
        document.getElementById('npp-km-ptcard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const q = document.getElementById('npp-km-ptq');
    if (!q) return;
    q.addEventListener('input', debounce(() => { _pf.q = q.value || ''; renderPointList(); }, 200));
    [['npp-km-ptowner', 'owner'], ['npp-km-ptstatus', 'status'], ['npp-km-ptjoin', 'joined']].forEach(([id, k]) => {
        const el = document.getElementById(id);
        el?.addEventListener('change', () => { _pf[k] = el.value; renderPointList(); });
    });
    document.getElementById('npp-km-ptclear')?.addEventListener('click', () => setPointFilters({}));
    const all = document.querySelector('#npp-km-ptcard .npp-km-result input.npp-km-ptall');
    all?.addEventListener('change', () => {
        setAll(_selPts, _ptRows, all.checked);
        syncRowChecks(document.getElementById('npp-km-ptlist'), _selPts);
        syncAllBoxes('npp-km-ptall', _ptRows, _selPts);
        updateBulkBar();
    });
}
function renderPointList() {
    const root = document.getElementById('npp-km-ptlist');
    const rows = filteredPoints();
    _ptRows = rows;
    pruneSel(_selPts, rows);   // đổi bộ lọc → bỏ chọn các điểm không còn trong kết quả
    setResult('pt', `${formatNumber(rows.length)}/${formatNumber(_points.length)} điểm`, pointsFiltered());
    syncAllBoxes('npp-km-ptall', rows, _selPts);
    if (root) {
        root.innerHTML = rows.length
            ? paged({
                rows, pageSize: PAGE, render: pointTable,
                onDraw: (el) => bindSelectable(el, {
                    set: _selPts, rows: () => _ptRows, allCls: 'npp-km-ptall',
                    rowSel: '.npp-km-pointrow', open: (n) => pointModal(n),
                }),
            })
            : emptyState({ icon: '🔍', title: 'Không có điểm bán phù hợp', message: 'Đổi bộ lọc hoặc bấm "Xoá lọc".' });
    }
    updateBulkBar();
}
function pointTable(slice) {
    return `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
        <thead><tr><th class="npp-km-chkcell"><input type="checkbox" class="npp-km-chk npp-km-ptall" data-all="1" aria-label="Chọn tất cả theo bộ lọc"></th><th>Điểm bán</th><th>Địa chỉ</th><th>Phụ trách</th><th class="npp-text-center">Trạng thái</th><th class="npp-text-center">Tham gia</th></tr></thead>
        <tbody>${slice.map((p) => {
            const on = _selPts.has(p.name);
            return `<tr class="npp-km-pointrow${on ? ' npp-km-sel' : ''}" data-n="${attr(p.name)}" style="cursor:pointer;">
                <td data-label="Chọn" class="npp-km-chkcell"><input type="checkbox" class="npp-km-chk" data-n="${attr(p.name)}" aria-label="Chọn điểm bán"${on ? ' checked' : ''}></td>
                <td data-label="Điểm bán"><div><strong>${escapeHtml(p.point_name || p.name)}</strong>${p.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(p.phone)}</div>` : ''}</div></td>
                <td data-label="Địa chỉ" class="npp-text-sm">${escapeHtml(p.address_line || '—')}</td>
                <td data-label="Phụ trách">${ownerCell(p)}</td>
                <td data-label="Trạng thái" class="npp-text-center">${p.is_active ? '<span class="npp-badge npp-badge-success">Hoạt động</span>' : '<span class="npp-badge npp-badge-muted">Ngừng</span>'}</td>
                <td data-label="Tham gia" class="npp-text-center">${p.participated ? `✅${p.participations ? ` <span class="npp-text-sm npp-text-muted">${formatNumber(p.participations)} lượt</span>` : ''}` : '—'}</td>
            </tr>`;
        }).join('')}</tbody></table></div>`;
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
            + `${p.staff_name ? `<br>👤 ${escapeHtml(p.owner_kind === 'npp' ? 'NPP giữ' : p.staff_name)}` : ''}`
            + `<br><a href="javascript:void(0)" data-detail class="npp-link">Xem chi tiết →</a>`,
    }));
    renderPointsMap(el, mapPts, { onDetail: (p) => pointModal(p._name) }).finally(() => { el._nppPending = false; });
}

// ─── TAB Chương trình: lượt tham gia ───────────────────────────────────
function partKey(r) { return r._k || (r._k = searchKey([r.point_name, r.point_phone, r.program_name, r.staff_name], r.point_phone)); }
function filteredParts() {
    const f = _cf;
    return _parts.filter((r) => ownerOk(r, f.owner)
        && (!f.state || (r.workflow_state || 'Nháp') === f.state)
        && (!f.q || matches(f.q, partKey(r))));
}
function partsFiltered() { return !!(_cf.q || _cf.owner || _cf.state || _partsProg); }
function bindPartFilters() {
    const sel = document.getElementById('npp-km-progsel');
    if (!sel) return;
    sel.addEventListener('change', () => loadParticipations(sel.value));
    document.querySelectorAll('.npp-km-progfilter').forEach((a) => a.addEventListener('click', () => {
        sel.value = a.dataset.p; loadParticipations(a.dataset.p);
        document.getElementById('npp-km-parts').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    const owner = document.getElementById('npp-km-paowner');
    const state = document.getElementById('npp-km-pastate');
    const q = document.getElementById('npp-km-paq');
    owner.addEventListener('change', () => { _cf.owner = owner.value; renderPartList(); });
    state.addEventListener('change', () => { _cf.state = state.value; renderPartList(); });
    q.addEventListener('input', debounce(() => { _cf.q = q.value || ''; renderPartList(); }, 200));
    document.getElementById('npp-km-paclear').addEventListener('click', () => {
        _cf = { q: '', owner: '', state: '' };
        owner.value = ''; state.value = ''; q.value = '';
        if (_partsProg) { sel.value = ''; loadParticipations(''); } else renderPartList();
    });
    const all = document.querySelector('#npp-km-ct .npp-km-result input.npp-km-paall');
    all.addEventListener('change', () => {
        setAll(_selParts, _paRows, all.checked);
        syncRowChecks(document.getElementById('npp-km-palist'), _selParts);
        syncAllBoxes('npp-km-paall', _paRows, _selParts);
        updateBulkBar();
    });
}

async function loadParticipations(program) {
    const root = document.getElementById('npp-km-parts');
    if (!root) return;
    _partsProg = program || '';
    _partsReady = false;
    const seq = ++_partsSeq;
    root.innerHTML = '<div class="npp-skeleton" style="height:160px;"></div>';
    try {
        const rows = await api.call('npp.api.promo.npp_participations', { program: program || undefined });
        if (seq !== _partsSeq || !document.getElementById('npp-km-parts')) return;
        _parts = rows || [];
        _partsReady = true;
        if (!ownerValid(_cf.owner)) _cf.owner = '';
        const ownerSel = document.getElementById('npp-km-paowner');
        if (ownerSel) ownerSel.innerHTML = ownerOptions(_parts, _cf.owner);
        // Chạm trần → danh sách/bộ lọc/chọn tất cả chỉ trên phần mới nhất: nói rõ, gợi ý chọn 1 chương trình
        const capped = _parts.length >= PARTS_LIMIT
            ? `<div class="npp-note-block npp-note-internal" id="npp-km-pacap" style="margin:0 0 8px;">ℹ️ Đang hiện ${formatNumber(PARTS_LIMIT)} lượt cập nhật gần nhất${_partsProg ? ' của chương trình này' : ' — chọn 1 chương trình để xem đủ'}.</div>`
            : '';
        root.innerHTML = _parts.length ? `${capped}
            <div id="npp-km-pagps" class="npp-text-sm npp-text-muted" style="margin-bottom:6px;"></div>
            <div id="npp-km-partsmap" class="npp-map-wrap" style="margin-top:0;"></div>
            <div class="npp-map-legend"><span><i style="background:#10b981;"></i>Đã duyệt</span><span><i style="background:#f59e0b;"></i>Chờ duyệt</span><span><i style="background:#94a3b8;"></i>Từ chối</span></div>
            <div id="npp-km-palist" class="npp-mt-3"></div>
            <div class="npp-text-sm npp-text-muted npp-mt-2">Bấm 1 dòng để xem chi tiết + hình ảnh · tích ô để gán NV phụ trách điểm bán.</div>`
            : emptyState({ icon: '📭', title: 'Chưa có điểm bán tham gia' });
        renderPartList();
    } catch (err) {
        if (seq !== _partsSeq) return;
        _parts = [];
        _partsReady = true;   // lỗi → danh sách rỗng (xuất báo "Không có dòng nào"), không treo "đang tải"
        root.innerHTML = `<div class="npp-text-muted">${escapeHtml(errText(err) || 'Lỗi')}</div>`;
        renderPartList();
    }
}

function renderPartList() {
    const rows = filteredParts();
    _paRows = rows;
    pruneSel(_selParts, rows);
    setResult('pa', `${formatNumber(rows.length)}/${formatNumber(_parts.length)} lượt`, partsFiltered());
    syncAllBoxes('npp-km-paall', rows, _selParts);
    drawPartsMap();
    const root = document.getElementById('npp-km-palist');
    if (root) {
        root.innerHTML = rows.length
            ? paged({
                rows, pageSize: PAGE, render: partTable,
                onDraw: (el) => bindSelectable(el, {
                    set: _selParts, rows: () => _paRows, allCls: 'npp-km-paall',
                    rowSel: '.npp-km-partrow', open: (n) => participationDetailModal(n),
                }),
            })
            : emptyState({ icon: '🔍', title: 'Không có lượt tham gia phù hợp', message: 'Đổi bộ lọc hoặc bấm "Xoá lọc".' });
    }
    updateBulkBar();
}

// Bản đồ tham gia hiển thị ĐÚNG các dòng sau lọc; tab đang ẩn → để dành vẽ khi hiện
function drawPartsMap() {
    const el = document.getElementById('npp-km-partsmap');
    if (!el) return;
    const mapPts = _paRows.map((r) => ({
        lat: r.latitude, lng: r.longitude, _name: r.name,
        color: r.workflow_state === 'Đã duyệt' ? '#10b981' : (r.workflow_state === 'Từ chối' ? '#94a3b8' : '#f59e0b'),
        html: `<strong>${escapeHtml(r.point_name)}</strong><br><span style="color:#64748b;">${escapeHtml(r.program_name)}</span><br>${escapeHtml(r.workflow_state || '—')}`
            + `${r.staff_name ? `<br>👤 ${escapeHtml(r.owner_kind === 'npp' ? 'NPP giữ' : r.staff_name)}` : ''}`
            + `<br><a href="javascript:void(0)" data-detail class="npp-link">Xem chi tiết →</a>`,
    }));
    const gps = document.getElementById('npp-km-pagps');
    if (gps) gps.textContent = `🗺️ ${mapPts.filter((p) => p.lat && p.lng).length}/${_paRows.length} điểm có toạ độ`;
    if (document.getElementById('npp-km-ct')?.hidden) { _partsMapDirty = true; return; }
    _partsMapDirty = false;
    renderPointsMap(el, mapPts, { onDetail: (p) => participationDetailModal(p._name) });
}

function partTable(slice) {
    return `<div style="overflow-x:auto;"><table class="npp-table">
        <thead><tr><th class="npp-km-chkcell"><input type="checkbox" class="npp-km-chk npp-km-paall" data-all="1" aria-label="Chọn tất cả theo bộ lọc"></th><th>Điểm bán</th><th>Chương trình</th><th>Phụ trách</th><th class="npp-text-center">Trạng thái</th><th>Cập nhật</th></tr></thead>
        <tbody>${slice.map((r) => {
            const on = _selParts.has(r.name);
            return `<tr class="npp-km-partrow${on ? ' npp-km-sel' : ''}" data-n="${attr(r.name)}" style="cursor:pointer;">
                <td data-label="Chọn" class="npp-km-chkcell"><input type="checkbox" class="npp-km-chk" data-n="${attr(r.name)}" aria-label="Chọn lượt tham gia"${on ? ' checked' : ''}></td>
                <td data-label="Điểm bán"><strong>${escapeHtml(r.point_name)}</strong></td>
                <td data-label="Chương trình" class="npp-text-sm">${escapeHtml(r.program_name)}${r.program_active === false ? ' <span class="npp-text-muted">(đã kết thúc)</span>' : ''}</td>
                <td data-label="Phụ trách">${ownerCell(r)}</td>
                <td data-label="Trạng thái" class="npp-text-center"><span class="npp-badge npp-badge-${WF_BADGE[r.workflow_state] || 'muted'}">${escapeHtml(r.workflow_state || '—')}</span>${r.workflow_state === 'Từ chối' && r.reject_reason ? `<div class="npp-text-sm npp-text-muted" title="${attr(r.reject_reason)}">lý do…</div>` : ''}</td>
                <td data-label="Cập nhật" class="npp-text-sm">${r.modified ? formatDate(r.modified) : ''}</td>
            </tr>`;
        }).join('')}</tbody></table></div>`;
}

// ─── TAB Trả thưởng: tiến độ + danh sách lượt đã duyệt ────────────────
function payFiltered() { return !!(_payf.status || _payf.owner || _payf.q); }
function bindPayFilters() {
    const prog = document.getElementById('npp-km-ttprog');
    if (!prog) return;
    prog.addEventListener('change', () => setPayProgram(prog.value));
    const st = document.getElementById('npp-km-ttst');
    const owner = document.getElementById('npp-km-ttowner');
    const q = document.getElementById('npp-km-ttq');
    st.addEventListener('change', () => { _payf.status = st.value; renderPayList(); });
    owner.addEventListener('change', () => { _payf.owner = owner.value; renderPayList(); });
    q.addEventListener('input', debounce(() => { _payf.q = q.value || ''; renderPayList(); }, 200));
    document.getElementById('npp-km-ttclear').addEventListener('click', () => {
        _payf = { status: '', owner: '', q: '' };
        st.value = ''; owner.value = ''; q.value = '';
        renderPayList();
    });
    // Bấm 1 dòng chương trình ở bảng tiến độ → lọc theo chương trình đó (gán 1 lần, khung sống qua các lần vẽ)
    document.getElementById('npp-km-ttprogress').onclick = (e) => {
        const tr = e.target.closest('.npp-pay-progrow');
        if (tr && tr.dataset.p && tr.dataset.p !== _payProg) setPayProgram(tr.dataset.p);
    };
}

function setPayProgram(program) {
    _payProg = program || '';
    const sel = document.getElementById('npp-km-ttprog');
    if (sel && sel.value !== _payProg) sel.value = _payProg;
    loadPayouts();
}

async function loadPayouts() {
    const box = document.getElementById('npp-km-ttprogress');
    if (!box) return;
    _payLoaded = true;
    const prog = _payProg;
    const seq = ++_paySeq;
    if (_pay && _payFor === prog) renderPayouts();   // có dữ liệu cũ đúng chương trình → hiện ngay, tải lại ngầm
    else {
        box.innerHTML = '<div class="npp-skeleton" style="height:160px;"></div>';
        const list = document.getElementById('npp-km-ttlist');
        if (list) list.innerHTML = '<div class="npp-skeleton" style="height:160px;"></div>';
    }
    try {
        const d = await api.call('npp.api.promo.payout_progress', { program: prog || undefined }) || {};
        if (seq !== _paySeq || !document.getElementById('npp-km-ttprogress')) return;
        if (!prog || !_payPrograms.length) _payPrograms = d.programs || [];
        _pay = d; _payFor = prog;
        renderPayouts();
    } catch (err) {
        if (seq !== _paySeq) return;
        _payLoaded = false;   // mở lại tab → thử lại
        const t = errText(err);
        const el = document.getElementById('npp-km-ttprogress');
        if (el) el.innerHTML = t.includes(SALEP_OLD)
            ? `<div class="npp-note-block npp-note-npp">⚠️ ${escapeHtml(t)}</div>`
            : `<div class="npp-text-muted">Chưa tải được tiến độ trả thưởng: ${escapeHtml(t)}</div>`;
        const list = document.getElementById('npp-km-ttlist');
        if (list) list.innerHTML = '';
        setResult('tt', '', false);
    }
}

// Vẽ select chương trình + KPI + bảng tiến độ + ô lọc (từ _pay), rồi danh sách
function renderPayouts() {
    const box = document.getElementById('npp-km-ttprogress');
    if (!box || !_pay) return;
    const programs = _pay.programs || [];
    const rows = _pay.rows || [];
    const sel = document.getElementById('npp-km-ttprog');
    if (sel) {
        const list = _payPrograms.length ? _payPrograms : programs;
        sel.innerHTML = '<option value="">Tất cả chương trình</option>'
            + list.map((p) => `<option value="${attr(p.program)}"${p.program === _payProg ? ' selected' : ''}>${escapeHtml(p.program_name || p.program)}</option>`).join('');
    }
    box.innerHTML = programs.length
        ? `${payoutKpiHtml(_pay.totals)}<div class="npp-mt-3">${progressTableHtml(programs, _pay.totals, { selected: _payProg })}</div>
            ${programs.length > 1 ? '<div class="npp-text-sm npp-text-muted npp-mt-2">Bấm 1 chương trình để xem riêng danh sách điểm bán của chương trình đó.</div>' : ''}`
        : emptyState({ icon: '💰', title: 'Chưa có lượt đã duyệt', message: 'Lượt tham gia được duyệt sẽ hiện ở đây để theo dõi trả thưởng lần 1, lần 2.' });
    if (!payOwnerValid(rows, _payf.owner)) _payf.owner = '';
    const st = document.getElementById('npp-km-ttst');
    if (st) st.innerHTML = payStatusOptions(rows, _payf.status);
    const owner = document.getElementById('npp-km-ttowner');
    if (owner) owner.innerHTML = payOwnerOptions(rows, _payf.owner);
    renderPayList();
}

function renderPayList() {
    const root = document.getElementById('npp-km-ttlist');
    if (!root || !_pay) return;
    const all = _pay.rows || [];
    const rows = filterPayRows(all, _payf);
    setResult('tt', `${formatNumber(rows.length)}/${formatNumber(all.length)} lượt`, payFiltered());
    // Chạm trần → nói rõ, gợi ý chọn 1 chương trình (số liệu bảng tiến độ vẫn đủ — đếm ở server)
    const capped = all.length >= PAY_ROWS_LIMIT
        ? `<div class="npp-note-block npp-note-internal" style="margin:0 0 8px;">ℹ️ Đang hiện ${formatNumber(PAY_ROWS_LIMIT)} lượt đầu${_payProg ? '' : ' — chọn 1 chương trình để xem đủ'}.</div>`
        : '';
    root.innerHTML = rows.length
        ? capped + paged({
            rows, pageSize: PAGE,
            render: (slice) => payoutListTable(slice, { showProgram: !_payProg }),
            onDraw: (el) => {
                el.onclick = (e) => {
                    const tr = e.target.closest('.npp-pay-lrow');
                    if (tr) payoutModal(tr.dataset.n);
                };
            },
        })
        : (all.length
            ? emptyState({ icon: '🔍', title: 'Không có lượt phù hợp', message: 'Đổi bộ lọc hoặc bấm "Xoá lọc".' })
            : emptyState({ icon: '📭', title: 'Chưa có lượt đã duyệt' }));
}

// Sau khi ghi/xoá trả thưởng: dữ liệu tab cũ → tải lại ngầm nếu đang mở tab, không thì để lần mở sau
function payChanged() {
    _payLoaded = false;
    if (_tab === 'tt' && document.getElementById('npp-km-ttprogress')) loadPayouts();
}

// Modal trả thưởng của 1 lượt: thông tin + 2 lần (ghi / sửa / xoá — chủ NPP xoá được)
async function payoutModal(name, back) {
    if (!name) return;
    const seq = ++_modalSeq;
    loadingModal(seq);
    let d;
    try {
        d = await api.call(PAY_EP.get, { name });
    } catch (err) {
        if (!modalAlive(seq)) return;
        showModal({ title: '⚠️ Lỗi', body: `${back ? backBar(back) : ''}<div class="npp-text-muted">${escapeHtml(errText(err))}</div>` });
        bindBack(back);
        return;
    }
    if (!modalAlive(seq)) return;   // đã đóng / mở modal khác trong lúc tải
    const row = ((_pay && _pay.rows) || []).find((r) => r.participation === name) || {};
    const pointName = row.point_name || row.display_point || name;
    const self = () => payoutModal(name, back);
    showModal({
        title: '💰 ' + escapeHtml(pointName),
        body: html`${backBar(back)}
            <div class="npp-card" style="margin-top:0;">
                <div class="npp-flex npp-justify-between" style="gap:10px;"><span class="npp-text-muted">Chương trình</span><strong style="text-align:right;">${escapeHtml(row.program_name || row.promotion_program || '—')}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2" style="gap:10px;"><span class="npp-text-muted">Phụ trách</span><strong style="text-align:right;">${escapeHtml(row.staff_name || row.owner || '—')}</strong></div>
                ${row.point_phone ? `<div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Điện thoại</span><strong>${escapeHtml(row.point_phone)}</strong></div>` : ''}
            </div>
            <div id="km-paysec" class="npp-mt-3">${payoutSectionHtml(d, { canRecord: true, canDelete: true })}</div>
            <div class="npp-mt-2"><a href="javascript:void(0)" id="km-paydetail" class="npp-link">🏪 Xem chi tiết lượt tham gia →</a></div>`,
    });
    bindBack(back);
    bindPayoutSection(document.getElementById('km-paysec'), {
        data: d, participation: name, pointName, endpoint: PAY_EP, back: self,
        onDone: (r, alive) => { payChanged(); if (alive) self(); },
    });
    document.getElementById('km-paydetail').addEventListener('click', () => participationDetailModal(name, self));
}

// Mục Trả thưởng trong chi tiết lượt (tab Chương trình) — chỉ lượt Đã duyệt, tải lười
async function loadPayBox(name, seq, pointName, self) {
    const box = () => {
        const b = document.getElementById('km-paybox');
        return seq === _modalSeq && b && b.dataset.part === name ? b : null;
    };
    try {
        const d = await api.call(PAY_EP.get, { name });
        const b = box();
        if (!b) return;   // đã đóng / sang modal khác
        b.innerHTML = payoutSectionHtml(d, { canRecord: true, canDelete: true });
        bindPayoutSection(b, {
            data: d, participation: name, pointName, endpoint: PAY_EP, back: self,
            onDone: (r, alive) => { payChanged(); if (alive) self(); },
        });
    } catch (err) {
        const b = box();
        if (!b) return;
        const t = errText(err);
        b.innerHTML = t.includes(SALEP_OLD)
            ? `<div class="npp-note-block npp-note-npp">⚠️ ${escapeHtml(t)}</div>`
            : `<div class="npp-text-sm npp-text-muted">Chưa tải được trả thưởng: ${escapeHtml(t)}</div>`;
    }
}

// ─── Modal Gán NV phụ trách / Nghỉ việc ────────────────────────────────
// Danh sách chọn người nhận (radio): NPP trước, rồi NV đang làm; ≥5 NV → có ô tìm (không dấu).
function pickerHtml(id, cands, { npp, checked = '', label = 'Chuyển cho *' }) {
    const options = [npp, ...cands.map((s) => ({ v: s.name, label: s.full_name || s.name, sub: `${formatNumber(s.points || 0)} điểm` }))];
    const search = cands.length >= 5
        ? `<input id="${id}-q" type="search" class="npp-cn-input npp-km-search" style="width:100%;margin-bottom:6px;" placeholder="Tìm nhân viên…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">`
        : '';
    return `<div class="npp-mt-3"><label class="npp-cn-flabel">${label}</label>${search}
        <div class="npp-km-opts" id="${id}-opts">${options.map((o) => `<label class="npp-km-opt" data-k="${attr(norm(o.label))}"><input type="radio" name="${id}-target" value="${attr(o.v)}"${o.v === checked ? ' checked' : ''}><span>${escapeHtml(o.label)}</span>${o.sub ? `<small>${escapeHtml(o.sub)}</small>` : ''}</label>`).join('')}</div>
        <div class="npp-text-sm npp-text-muted npp-mt-1">${cands.length ? 'Chỉ hiện nhân viên đang làm & đang hoạt động.' : 'Chưa có nhân viên đang làm & đang hoạt động — chỉ chọn được NPP.'}</div></div>`;
}
function bindPicker(id) {
    const q = document.getElementById(`${id}-q`);
    if (!q) return;
    q.addEventListener('input', () => {
        document.querySelectorAll(`#${id}-opts .npp-km-opt`).forEach((o) => { o.hidden = !matches(q.value, o.dataset.k || ''); });
    });
}
function pickedTarget(id) { return document.querySelector(`input[name="${id}-target"]:checked`)?.value || ''; }

/**
 * Gán NV phụ trách cho nhiều điểm (luật salep doc/08 §2).
 * opts: back (mở lại màn trước), exclude (NV nguồn — không làm đích), fromParts (số lượt
 * đã chọn ở tab Chương trình), onDone (sau khi thành công, trước refresh), after (sau refresh).
 */
function openAssignModal(points, opts = {}) {
    const { back = null, exclude = null, fromParts = 0, onDone = null, after = null } = opts;
    points = [...new Set((points || []).filter(Boolean))];
    if (!capOk(points.length)) return;
    const byPt = new Map(_points.map((p) => [p.name, p]));
    const sel = points.map((n) => byPt.get(n) || { name: n, point_name: n });
    const cur = {};
    sel.forEach((p) => {
        const k = p.owner_kind === 'npp' ? 'NPP giữ' : (p.staff_name || '—');
        cur[k] = (cur[k] || 0) + 1;
    });
    const curList = Object.entries(cur).sort((a, b) => b[1] - a[1]);
    const curTxt = curList.slice(0, 4).map(([k, n]) => `${escapeHtml(k)} (${formatNumber(n)})`).join(', ') + (curList.length > 4 ? ', …' : '');
    showModal({
        title: '👤 Gán nhân viên phụ trách',
        body: html`${backBar(back)}
            <div class="npp-card" style="margin-top:0;">
                <div class="npp-font-bold">${formatNumber(points.length)} điểm bán đã chọn${fromParts ? ` <span class="npp-text-sm npp-text-muted" style="font-weight:400;">(từ ${formatNumber(fromParts)} lượt, đã gộp điểm trùng)</span>` : ''}</div>
                <ul class="npp-text-sm npp-mt-1" style="padding-left:1.1rem;">${sel.slice(0, 5).map((p) => `<li>${escapeHtml(p.point_name || p.name)}</li>`).join('')}${sel.length > 5 ? `<li class="npp-text-muted">… và ${formatNumber(sel.length - 5)} điểm khác</li>` : ''}</ul>
                <div class="npp-text-sm npp-text-muted npp-mt-1">Đang phụ trách: ${curTxt}</div>
            </div>
            ${pickerHtml('as', validTargets(exclude), { npp: { v: TARGET_NPP, label: '🏢 NPP giữ lại (chưa giao)' } })}
            <div class="npp-mt-3"><label class="npp-cn-flabel" for="as-note">Ghi chú (tuỳ chọn)</label><textarea id="as-note" class="npp-textarea" rows="2" placeholder="VD: chia lại tuyến, NV mới nhận địa bàn…"></textarea></div>
            <div class="npp-note-block npp-note-internal npp-mt-2">ℹ️ Điểm bán chuyển sang người nhận. Lượt tham gia của chương trình <strong>còn hiệu lực</strong> trên các điểm này cũng chuyển theo (người nhận chụp ảnh báo cáo, sửa, gửi duyệt). Lượt của chương trình <strong>đã kết thúc</strong> giữ nguyên người thực hiện — KPI cũ không đổi.</div>
            <div class="npp-flex npp-flex-wrap" style="gap:8px;margin-top:12px;">
                <button id="as-go" type="button" class="npp-btn-primary" style="flex:2;min-width:150px;padding:10px;">✅ Xác nhận chuyển</button>
                <button id="as-cancel" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:10px;">Huỷ</button>
            </div>`,
    });
    bindBack(back);
    bindPicker('as');
    document.getElementById('as-cancel').addEventListener('click', () => (back ? back() : closeModal()));
    document.getElementById('as-go').addEventListener('click', async () => {
        const target = pickedTarget('as');
        if (!target) return showToast('Chọn người nhận điểm bán', 'warning');
        const note = v('as-note');
        const btn = document.getElementById('as-go');
        btn.disabled = true; btn.textContent = '⏳ Đang chuyển…';
        try {
            const r = await api.call('npp.api.promo.assign_points', { points, target, note: note || undefined }) || {};
            closeModal();
            showToast(`Đã chuyển ${formatNumber(r.moved || 0)} điểm · ${formatNumber(r.participations || 0)} lượt tham gia`
                + (r.skipped ? ` · ${formatNumber(r.skipped)} điểm không đổi` : ''), 'success');
            if (onDone) onDone();
            updateBulkBar();
            await refresh();
            if (after) after();
        } catch (err) {
            errToast(err);
            btn.disabled = false; btn.textContent = '✅ Xác nhận chuyển';
        }
    });
}

function openOffboard(name, back) {
    const s = _staff.find((x) => x.name === name);
    if (!s) return;
    if (isSelf(s)) return showToast('Không thể tự cho mình nghỉ việc', 'warning');
    const st = _hist && _hist.staff === name ? (_hist.data.stats || {}) : null;
    const nParts = st && st.active_participations != null ? st.active_participations : null;
    showModal({
        title: '🚪 Nghỉ việc — ' + escapeHtml(s.full_name || ''),
        body: html`${backBar(back)}
            <div class="npp-card" style="margin-top:0;">
                <div>Sẽ bàn giao: <strong>${formatNumber(s.points || 0)} điểm bán</strong>${nParts != null
                    ? ` · <strong>${formatNumber(nParts)} lượt tham gia</strong> còn hiệu lực`
                    : ' cùng các lượt tham gia còn hiệu lực'}</div>
            </div>
            ${pickerHtml('ob', validTargets(name), { npp: { v: TARGET_NPP, label: '🏢 Về NPP (giữ lại, chia sau)', sub: 'mặc định' }, checked: TARGET_NPP, label: 'Bàn giao cho *' })}
            <div class="npp-mt-3"><label class="npp-cn-flabel" for="ob-note">Ghi chú (tuỳ chọn)</label><textarea id="ob-note" class="npp-textarea" rows="2" placeholder="VD: nghỉ từ đầu tháng, đã thu hồi đồng phục…"></textarea></div>
            <div class="npp-risk-bar npp-mt-3"><span>⚠️ Hồ sơ chuyển sang <strong>Đã nghỉ</strong> và <strong>khoá tài khoản đăng nhập</strong> của nhân viên (trừ tài khoản NPP). Lượt của chương trình đã kết thúc giữ nguyên người thực hiện.</span></div>
            <div class="npp-flex npp-flex-wrap" style="gap:8px;">
                <button id="ob-go" type="button" class="npp-btn-danger" style="flex:2;min-width:150px;padding:10px;">🚪 Xác nhận nghỉ việc</button>
                <button id="ob-cancel" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:10px;">Huỷ</button>
            </div>`,
    });
    bindBack(back);
    bindPicker('ob');
    document.getElementById('ob-cancel').addEventListener('click', () => (back ? back() : closeModal()));
    document.getElementById('ob-go').addEventListener('click', async () => {
        const target = pickedTarget('ob') || TARGET_NPP;
        const note = v('ob-note');
        const btn = document.getElementById('ob-go');
        btn.disabled = true; btn.textContent = '⏳ Đang bàn giao…';
        try {
            const r = await api.call('npp.api.promo.offboard_staff', { staff: name, target, note: note || undefined }) || {};
            closeModal();
            showToast(`Đã cho nghỉ việc — đã chuyển ${formatNumber(r.points || 0)} điểm · ${formatNumber(r.participations || 0)} lượt tham gia`
                + (r.disabled ? ' · đã khoá tài khoản' : ''), 'success', 5000);
            const toNpp = target === TARGET_NPP;
            if (toNpp) {   // về NPP → sang tab Điểm bán lọc "NPP giữ" để chia lại
                // Lọc theo đúng đích server trả về (r.target: kind "npp" → "NPP giữ", kind "staff" → NV đó)
                // kẻo danh sách không có các điểm vừa bàn giao
                const tg = r.target || {};
                _tab = 'db';
                _pf = { q: '', owner: tg.kind === 'staff' && tg.staff ? tg.staff : TARGET_NPP, status: '', joined: '' };
                _selPts.clear();
                syncHash();
            }
            await refresh();
            // Đang cuộn ở danh sách NV → đưa danh sách điểm (đã lọc) lên màn hình, không đứng giữa bản đồ
            if (toNpp && _tab === 'db') document.getElementById('npp-km-ptcard')?.scrollIntoView({ block: 'start' });
        } catch (err) {
            errToast(err);
            btn.disabled = false; btn.textContent = '🚪 Xác nhận nghỉ việc';
        }
    });
}

// ─── Nhân viên: modal + lịch sử ────────────────────────────────────────
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
        errToast(err);
        if (btn) { btn.disabled = false; btn.textContent = 'Tạo hồ sơ nhân viên'; }
    }
}

function v(id) { return (document.getElementById(id)?.value || '').trim(); }

function openCreateStaff(back) {
    showModal({
        title: '➕ Thêm nhân viên',
        body: html`${back ? backBar(back) : ''}<div style="display:flex;flex-direction:column;gap:10px;">
            <div><label class="npp-cn-flabel">Họ tên *</label><input id="nv-name" class="npp-cn-input" style="width:100%;"></div>
            <div><label class="npp-cn-flabel">Số điện thoại * (dùng để đăng nhập)</label><input id="nv-phone" class="npp-cn-input" style="width:100%;" inputmode="tel"></div>
            <div><label class="npp-cn-flabel">Mật khẩu (để trống = tự tạo)</label><input id="nv-pass" class="npp-cn-input" style="width:100%;"></div>
            <div><label class="npp-cn-flabel">Email (tuỳ chọn)</label><input id="nv-email" type="email" class="npp-cn-input" style="width:100%;"></div>
            <div><label class="npp-cn-flabel">CCCD (tuỳ chọn)</label><input id="nv-cccd" class="npp-cn-input" style="width:100%;" inputmode="numeric"></div>
            <button id="nv-save" type="button" class="npp-btn-primary" style="padding:10px;">Tạo nhân viên</button>
            <p class="npp-text-sm npp-text-muted">NV đăng nhập bằng <strong>số điện thoại + mật khẩu</strong>. Tài khoản gắn role Sales Staff thuộc địa bàn của bạn.</p>
        </div>`,
    });
    bindBack(back);
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
        errToast(err);
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

async function toggleStaff(s, btn) {
    // NV đã nghỉ → "Kích hoạt lại" = về Đang làm (server xoá ngày nghỉ/bàn giao); điểm KHÔNG tự quay về
    const active = s.resigned ? 1 : (s.active ? 0 : 1);
    if (s.resigned && !window.confirm(`Kích hoạt lại "${s.full_name || ''}"?\nHồ sơ về "Đang làm"; điểm bán đã bàn giao KHÔNG tự quay về — gán lại nếu cần.`)) return;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lưu…'; }
    try {
        await api.call('npp.api.promo.set_staff_active', { staff: s.name, active });
        closeModal();
        showToast(s.resigned ? 'Đã kích hoạt lại nhân viên' : (active ? 'Đã kích hoạt nhân viên' : 'Đã tạm dừng nhân viên'), 'success');
        refresh();
    } catch (err) {
        errToast(err);
        if (btn) { btn.disabled = false; btn.textContent = label; }
    }
}

function staffModal(name, back) {
    if (!name) return;
    const s = _staff.find((x) => x.name === name);
    if (!s) return;
    const self = () => staffModal(name, back);   // quay lại đúng màn này (giữ pill + điểm đã chọn)
    const rate = s.total ? (s.approved / s.total * 100) : 0;
    const canOff = !s.resigned && !isSelf(s);
    const canToggle = !(isSelf(s) && s.active && !s.resigned);   // server chặn tự tạm dừng chính mình
    showModal({
        title: '👤 ' + escapeHtml(s.full_name || ''),
        body: html`${backBar(back)}
            <div class="npp-card" style="margin-top:0;">
                <div class="npp-flex npp-justify-between"><span class="npp-text-muted">Đăng nhập (SĐT)</span><strong>${escapeHtml(s.phone || '—')}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Trạng thái</span>${staffBadge(s)}</div>
                ${s.resigned ? `<div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Nghỉ việc từ</span><strong>${s.left_on ? formatDate(s.left_on) : '—'}</strong></div>` : ''}
                <div id="sm-more"></div>
            </div>
            <div class="npp-kpi-grid npp-mt-3">
                <div class="npp-kpi-card"><div class="npp-kpi-label">Điểm bán phụ trách</div><div class="npp-kpi-value">${formatNumber(s.points || 0)}</div><div class="npp-kpi-sub" id="sm-kpi-pts">&nbsp;</div></div>
                <div class="npp-kpi-card"><div class="npp-kpi-label">Lượt tham gia</div><div class="npp-kpi-value">${formatNumber(s.total)}</div><div class="npp-kpi-sub">Đã duyệt <strong style="color:var(--npp-success);">${formatNumber(s.approved)}</strong> (${rate.toFixed(0)}%)<span id="sm-kpi-pend"></span></div></div>
            </div>
            <div class="npp-flex npp-flex-wrap" style="gap:8px;margin-top:10px;">
                <button id="sm-edit" type="button" class="npp-btn-primary" style="flex:1;min-width:90px;padding:9px;">✏️ Sửa</button>
                <button id="sm-pass" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:9px;">🔑 Đổi MK</button>
                ${canToggle ? `<button id="sm-toggle" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:9px;">${s.resigned ? '▶ Kích hoạt lại' : (s.active ? '⏸ Tạm dừng' : '▶ Kích hoạt')}</button>` : ''}
                <button id="sm-move" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:9px;">🔁 Chuyển điểm</button>
                ${canOff ? '<button id="sm-off" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:9px;color:var(--npp-danger);">🚪 Nghỉ việc</button>' : ''}
                <button id="sm-del" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:9px;color:var(--npp-danger);">🗑 Xoá</button>
            </div>
            <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap npp-mt-3" style="gap:6px;">
                <h4 class="npp-font-bold">Lịch sử hoạt động</h4>
                ${xlBtn('sm-xl', 'lịch sử nhân viên')}
            </div>
            <div id="sm-hist" class="npp-km-hist npp-mt-2" data-staff="${attr(name)}"><div class="npp-skeleton" style="height:160px;"></div></div>`,
    });
    bindBack(back);
    document.getElementById('sm-edit').addEventListener('click', () => openEditStaff(name, self));
    document.getElementById('sm-pass').addEventListener('click', () => resetPass(name, self));
    document.getElementById('sm-toggle')?.addEventListener('click', (e) => toggleStaff(s, e.currentTarget));
    document.getElementById('sm-move').addEventListener('click', () => {
        // Theo owner = user (cùng cách đếm s.points / staff_history): hồ sơ của TÀI KHOẢN NPP có
        // owner_kind "npp", staff = null → lọc theo p.staff sẽ ra rỗng dù KPI báo N điểm.
        const pts = s.user ? _points.filter((p) => p.owner === s.user).map((p) => p.name) : [];
        if (!pts.length) return showToast('Nhân viên chưa phụ trách điểm bán nào', 'info');
        openAssignModal(pts, { back: self, exclude: name, after: self });
    });
    document.getElementById('sm-off')?.addEventListener('click', () => openOffboard(name, self));
    document.getElementById('sm-del').addEventListener('click', () => deleteStaff(s));
    document.getElementById('sm-xl').addEventListener('click', (e) => {
        const h = _hist && _hist.staff === name ? _hist : null;   // chỉ có khi lịch sử đã tải xong (và đúng NV này)
        if (!h) return showToast('Lịch sử nhân viên chưa tải xong', 'warning');
        exportHistory(h, e.currentTarget);
    });
    loadStaffHistory(name, self);
}

function histBox(name) {
    const b = document.getElementById('sm-hist');
    return b && b.dataset.staff === name ? b : null;
}

async function loadStaffHistory(name, self) {
    let h = _hist && _hist.staff === name ? _hist : null;
    if (!h) {
        try {
            const data = await api.call('npp.api.promo.staff_history', { staff: name });
            h = { staff: name, data: data || {}, pill: 'pt', sel: new Set() };
            if (histBox(name)) _hist = h;
        } catch (err) {
            const box = histBox(name);
            if (!box) return;
            const t = errText(err);
            box.innerHTML = t.includes(SALEP_OLD)
                ? `<div class="npp-note-block npp-note-npp">⚠️ ${escapeHtml(t)}</div>`
                : `<div class="npp-text-sm npp-text-muted">Chưa tải được lịch sử: ${escapeHtml(t)}</div>`;
            return;
        }
    }
    if (!histBox(name)) return;   // người dùng đã sang modal khác
    const st = h.data.stats || {}, info = h.data.staff || {};
    const pts = document.getElementById('sm-kpi-pts');
    if (pts && st.active_points != null) pts.textContent = `${formatNumber(st.active_points)} đang hoạt động`;
    const pend = document.getElementById('sm-kpi-pend');
    if (pend && st.pending) pend.textContent = ` · chờ duyệt ${formatNumber(st.pending)}`;
    const more = document.getElementById('sm-more');
    if (more) {
        more.innerHTML = (info.resigned && info.handover_label
            ? `<div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Bàn giao cho</span><strong>${escapeHtml(info.handover_label)}</strong></div>` : '')
            + (info.last_login
                ? `<div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Đăng nhập gần nhất</span><strong>${formatDateTime(info.last_login)}</strong></div>` : '');
    }
    renderHistory(h, self);
}

function renderHistory(h, self) {
    const box = histBox(h.staff);
    if (!box) return;
    const d = h.data;
    const pts = d.points || [], pas = d.participations || [], trs = d.transfers || [];
    const pill = (k, label, n) => `<button type="button" data-h="${k}"${h.pill === k ? ' class="npp-active"' : ''}>${label} (${formatNumber(n)})</button>`;
    const inner = h.pill === 'pa' ? histParts(pas) : (h.pill === 'tr' ? histTransfers(trs) : histPoints(h, pts));
    box.innerHTML = `<div class="npp-seg">${pill('pt', 'Điểm bán', pts.length)}${pill('pa', 'Tham gia', pas.length)}${pill('tr', 'Bàn giao', trs.length)}</div>
        <div class="npp-mt-2">${inner}</div>`;
    // GÁN onclick: box sống qua các trang của paged() (chỉ ruột wrapper được vẽ lại)
    box.onclick = (e) => {
        const p = e.target.closest('[data-h]');
        if (p) { h.pill = p.dataset.h; renderHistory(h, self); return; }
        if (e.target.closest('#sm-hmove')) {
            openAssignModal([...h.sel], { back: self, exclude: h.staff, after: self, onDone: () => h.sel.clear() });
            return;
        }
        const all = e.target.closest('input[data-hall]');
        if (all) { setAll(h.sel, pts, all.checked); syncRowChecks(box, h.sel); updateHistSel(h); return; }
        const cell = e.target.closest('.npp-km-chkcell');
        if (cell) {
            const cb = cell.querySelector('input.npp-km-chk[data-n]');
            if (!cb) return;
            if (e.target !== cb) cb.checked = !cb.checked;
            if (cb.checked) h.sel.add(cb.dataset.n); else h.sel.delete(cb.dataset.n);
            cb.closest('tr')?.classList.toggle('npp-km-sel', cb.checked);
            updateHistSel(h);
            return;
        }
        const tr = e.target.closest('tr[data-n]');
        if (!tr) return;
        if (tr.dataset.kind === 'pa') participationDetailModal(tr.dataset.n, self);
        else pointModal(tr.dataset.n, self);   // điểm bán + dòng bàn giao → chi tiết điểm
    };
    updateHistSel(h);
}

function updateHistSel(h) {
    const n = h.sel.size, total = ((h.data && h.data.points) || []).length;
    const btn = document.getElementById('sm-hmove');
    if (btn) { btn.disabled = !n; btn.textContent = `🔁 Chuyển ${formatNumber(n)} điểm đã chọn`; }
    const all = document.querySelector('#sm-hist input[data-hall]');
    if (all) { all.checked = n > 0 && n === total; all.indeterminate = n > 0 && n < total; }
}

function histPoints(h, rows) {
    if (!rows.length) return '<div class="npp-text-sm npp-text-muted">Chưa phụ trách điểm bán nào.</div>';
    return `<div class="npp-km-result" style="margin-top:0;">
            <label><input type="checkbox" class="npp-km-chk" data-hall="1"> Chọn tất cả (${formatNumber(rows.length)})</label>
            <button type="button" id="sm-hmove" class="npp-btn-primary" style="width:auto;flex:none;padding:7px 12px;font-size:.82rem;" disabled>🔁 Chuyển 0 điểm đã chọn</button>
        </div>
        ${paged({
            rows, pageSize: PAGE,
            render: (slice) => `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th class="npp-km-chkcell"></th><th>Điểm bán</th><th class="npp-text-center">Trạng thái</th><th class="npp-text-end">Lượt (duyệt)</th></tr></thead>
                <tbody>${slice.map((p) => {
                    const on = h.sel.has(p.name);
                    return `<tr data-n="${attr(p.name)}" data-kind="pt" class="${on ? 'npp-km-sel' : ''}" style="cursor:pointer;">
                        <td data-label="Chọn" class="npp-km-chkcell"><input type="checkbox" class="npp-km-chk" data-n="${attr(p.name)}" aria-label="Chọn điểm bán"${on ? ' checked' : ''}></td>
                        <td data-label="Điểm bán"><div><strong>${escapeHtml(p.point_name || p.name)}</strong>${p.phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(p.phone)}</div>` : ''}</div></td>
                        <td data-label="Trạng thái" class="npp-text-center">${p.is_active ? '<span class="npp-badge npp-badge-success">Hoạt động</span>' : '<span class="npp-badge npp-badge-muted">Ngừng</span>'}</td>
                        <td data-label="Lượt (duyệt)" class="npp-text-end">${formatNumber(p.participations || 0)} <span class="npp-text-sm" style="color:var(--npp-success);">(${formatNumber(p.approved || 0)})</span></td>
                    </tr>`;
                }).join('')}</tbody></table></div>`,
        })}`;
}

function histParts(rows) {
    if (!rows.length) return '<div class="npp-text-sm npp-text-muted">Chưa có lượt tham gia nào.</div>';
    return paged({
        rows, pageSize: PAGE,
        render: (slice) => `<div style="overflow-x:auto;"><table class="npp-table">
            <thead><tr><th>Điểm bán</th><th>Chương trình</th><th class="npp-text-center">Trạng thái</th><th>Cập nhật</th></tr></thead>
            <tbody>${slice.map((r) => `<tr data-n="${attr(r.name)}" data-kind="pa" style="cursor:pointer;">
                <td data-label="Điểm bán"><strong>${escapeHtml(r.point_name || r.display_point || '')}</strong></td>
                <td data-label="Chương trình" class="npp-text-sm">${escapeHtml(r.program_name || r.promotion_program || '')}${r.program_active === false ? ' <span class="npp-text-muted">(đã kết thúc)</span>' : ''}</td>
                <td data-label="Trạng thái" class="npp-text-center"><span class="npp-badge npp-badge-${WF_BADGE[r.workflow_state] || 'muted'}">${escapeHtml(r.workflow_state || '—')}</span></td>
                <td data-label="Cập nhật" class="npp-text-sm">${r.modified ? formatDate(r.modified) : ''}</td>
            </tr>`).join('')}</tbody></table></div>`,
    });
}

function histTransfers(rows) {
    if (!rows.length) return '<div class="npp-text-sm npp-text-muted">Chưa có lần bàn giao nào.</div>';
    return paged({
        rows, pageSize: PAGE,
        render: (slice) => `<div style="overflow-x:auto;"><table class="npp-table">
            <thead><tr><th>Thời gian</th><th>Điểm bán</th><th>Bàn giao</th><th>Lý do</th><th>Thực hiện</th></tr></thead>
            <tbody>${slice.map((r) => {
                const dir = r.direction === 'in'
                    ? `<span class="npp-badge npp-badge-success">Nhận</span> từ <strong>${escapeHtml(r.counterpart_label || '—')}</strong>`
                    : `<span class="npp-badge npp-badge-warning">Giao</span> cho <strong>${escapeHtml(r.counterpart_label || '—')}</strong>`;
                return `<tr data-n="${attr(r.display_point || '')}" data-kind="tr" style="cursor:pointer;">
                    <td data-label="Thời gian" class="npp-text-sm">${r.creation ? formatDateTime(r.creation) : '—'}</td>
                    <td data-label="Điểm bán"><strong>${escapeHtml(r.point_name || r.display_point || '')}</strong></td>
                    <td data-label="Bàn giao">${dir}${r.participations_moved ? ` <span class="npp-text-sm npp-text-muted">· ${formatNumber(r.participations_moved)} lượt</span>` : ''}</td>
                    <td data-label="Lý do"><span class="npp-badge npp-badge-${r.reason === 'Nghỉ việc' ? 'danger' : 'muted'}">${escapeHtml(r.reason || '—')}</span>${r.note ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(r.note)}</div>` : ''}</td>
                    <td data-label="Thực hiện" class="npp-text-sm">${escapeHtml(r.by_label || '—')}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`,
    });
}

// Hồ sơ NV gắn TÀI KHOẢN NPP (chủ NPP tự thêm mình / Portal User của NPP): điểm của tài khoản đó
// luôn là "NPP giữ" (owner_kind npp) → xoá hồ sơ không làm điểm mồ côi, server không chặn/không khoá.
function isNppAccount(s) {
    return isSelf(s) || (!!s.user && _points.some((p) => p.owner === s.user && p.owner_kind === 'npp'));
}
async function deleteStaff(s) {
    const nppAcc = isNppAccount(s);
    // Còn phụ trách điểm → server chặn; báo trước (cùng thông điệp) để NPP dùng Nghỉ việc
    if (s.points && !nppAcc) return showToast(`Nhân viên còn ${formatNumber(s.points)} điểm bán — dùng Nghỉ việc để bàn giao trước khi xoá.`, 'warning', 5000);
    // Hồ sơ tài khoản NPP → server KHÔNG khoá tài khoản (chỉ xoá hồ sơ NV); điểm vẫn "NPP giữ"
    const lockMsg = nppAcc
        ? (isSelf(s) ? 'Tài khoản NPP của bạn vẫn đăng nhập bình thường.' : 'Tài khoản NPP này vẫn đăng nhập bình thường.')
            + (s.points ? `\n${formatNumber(s.points)} điểm bán vẫn là "NPP giữ".` : '')
        : 'Tài khoản đăng nhập sẽ bị vô hiệu hoá.';
    if (!window.confirm(`Xoá nhân viên "${s.full_name || ''}"?\n${lockMsg}`)) return;
    try {
        await api.call('npp.api.promo.delete_staff', { staff: s.name });
        closeModal();
        showToast('Đã xoá nhân viên', 'success');
        refresh();
    } catch (err) {
        errToast(err);
    }
}

// ─── Điểm bán: modal chi tiết ──────────────────────────────────────────
async function pointModal(name, back) {
    if (!name) return;
    const seq = ++_modalSeq;
    loadingModal(seq);
    let d;
    try {
        d = await api.call('npp.api.promo.npp_point_detail', { point: name });
    } catch (err) {
        if (!modalAlive(seq)) return;
        showModal({ title: '⚠️ Lỗi', body: `${back ? backBar(back) : ''}<div class="npp-text-muted">${escapeHtml(errText(err))}</div>` });
        bindBack(back);
        return;
    }
    if (!modalAlive(seq)) return;   // đã đóng / mở modal khác trong lúc tải
    const p = d.point || {}, st = d.stats || {}, acts = d.activity || [];
    const row = _points.find((x) => x.name === name);
    const self = () => pointModal(name, back);
    const imgGrid = galleryHtml(d.image_groups);
    showModal({
        title: '🏪 ' + escapeHtml(p.point_name || name),
        body: html`${backBar(back)}
            <div class="npp-card" style="margin-top:0;">
                <div class="npp-flex npp-justify-between" style="gap:10px;"><span class="npp-text-muted">Địa chỉ</span><strong style="text-align:right;">${escapeHtml(p.address_line || '—')}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Điện thoại</span><strong>${escapeHtml(p.phone || '—')}</strong></div>
                <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Trạng thái</span>${p.is_active ? '<span class="npp-badge npp-badge-success">Hoạt động</span>' : '<span class="npp-badge npp-badge-muted">Ngừng</span>'}</div>
                ${row ? `<div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Phụ trách</span><strong>${ownerCell(row)}</strong></div>` : ''}
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
                <button id="pm-assign" type="button" class="npp-cn-btn" style="flex:1;padding:9px;">👤 Gán NV</button>
                <button id="pm-del" type="button" class="npp-cn-btn" style="flex:1;padding:9px;color:var(--npp-danger);">🗑 Xoá</button>
            </div>`,
    });
    bindBack(back);
    document.getElementById('pm-edit').addEventListener('click', () => openEditPoint(name, self));
    document.getElementById('pm-assign').addEventListener('click', () =>
        openAssignModal([name], { back: self, exclude: row && row.owner_kind === 'staff' ? row.staff : null }));
    document.getElementById('pm-del').addEventListener('click', () => deletePoint(name, p.point_name || name));
}

function openEditPoint(name, back) {
    const p = _points.find((x) => x.name === name);
    if (!p) return;
    showModal({
        title: '✏️ Sửa điểm bán',
        body: html`${backBar(back)}<div style="display:flex;flex-direction:column;gap:10px;">
            <div><label class="npp-cn-flabel">Tên điểm bán *</label><input id="pe-name" class="npp-cn-input" style="width:100%;" value="${attr(p.point_name || '')}"></div>
            <div><label class="npp-cn-flabel">Địa chỉ</label><input id="pe-addr" class="npp-cn-input" style="width:100%;" value="${attr(p.address_line || '')}"></div>
            <div><label class="npp-cn-flabel">Điện thoại</label><input id="pe-phone" class="npp-cn-input" style="width:100%;" inputmode="tel" value="${attr(p.phone || '')}"></div>
            <label class="npp-flex npp-items-center" style="gap:8px;"><input id="pe-active" type="checkbox" class="npp-km-chk" ${p.is_active ? 'checked' : ''}> Đang hoạt động</label>
            <button id="pe-save" type="button" class="npp-btn-primary" style="padding:10px;">Lưu</button>
        </div>`,
    });
    bindBack(back);
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
        errToast(err);
        if (btn) { btn.disabled = false; btn.textContent = 'Lưu'; }
    }
}

async function deletePoint(name, label) {
    if (!window.confirm(`Xoá điểm bán "${label || ''}"?\nKhông xoá được nếu đã có lượt tham gia.`)) return;
    try {
        await api.call('npp.api.promo.delete_point', { point: name });
        _selPts.delete(name);
        closeModal(); showToast('Đã xoá điểm bán', 'success'); refresh();
    } catch (err) {
        errToast(err);
    }
}


function openEditStaff(name, back) {
    const s = _staff.find((x) => x.name === name);
    if (!s) return;
    showModal({
        title: '✏️ Sửa nhân viên',
        body: html`${backBar(back)}<div style="display:flex;flex-direction:column;gap:10px;">
            <div><label class="npp-cn-flabel">Họ tên *</label><input id="ev-name" class="npp-cn-input" style="width:100%;" value="${attr(s.full_name || '')}"></div>
            <div><label class="npp-cn-flabel">Số điện thoại * (tên đăng nhập)</label><input id="ev-phone" class="npp-cn-input" style="width:100%;" inputmode="tel" value="${attr(s.phone || '')}"></div>
            <div><label class="npp-cn-flabel">CCCD</label><input id="ev-cccd" class="npp-cn-input" style="width:100%;" inputmode="numeric" value="${attr(s.cccd || '')}"></div>
            <button id="ev-save" type="button" class="npp-btn-primary" style="padding:10px;">Lưu</button>
            <p class="npp-text-sm npp-text-muted">Đổi SĐT sẽ đổi luôn tên đăng nhập của nhân viên.</p>
        </div>`,
    });
    bindBack(back);
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
        errToast(err);
        if (btn) { btn.disabled = false; btn.textContent = 'Lưu'; }
    }
}

function resetPass(name, back) {
    showModal({
        title: '🔑 Đổi mật khẩu',
        body: html`${backBar(back)}<div style="display:flex;flex-direction:column;gap:10px;">
            <div><label class="npp-cn-flabel">Mật khẩu mới (để trống = tự tạo)</label><input id="rp-pass" class="npp-cn-input" style="width:100%;"></div>
            <button id="rp-save" type="button" class="npp-btn-primary" style="padding:10px;">Cấp lại mật khẩu</button>
        </div>`,
    });
    bindBack(back);
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
        errToast(err);
        if (btn) { btn.disabled = false; btn.textContent = 'Cấp lại mật khẩu'; }
    }
}

async function participationDetailModal(name, back) {
    if (!name) return;
    const seq = ++_modalSeq;
    loadingModal(seq);
    try {
        const d = await api.call('npp.api.promo.npp_participation_detail', { name });
        if (!modalAlive(seq)) return;
        const p = d.participation || {}, pt = d.point || {}, pg = d.program || {};
        const row = _parts.find((x) => x.name === name);
        const imgGrid = galleryHtml(d.image_groups);
        const approved = p.workflow_state === APPROVED;   // chỉ lượt đã duyệt mới có mục Trả thưởng
        showModal({
            title: '🏪 ' + escapeHtml(pt.point_name || p.display_point || ''),
            body: html`${backBar(back)}
                <div class="npp-card" style="margin-top:0;">
                    <div class="npp-flex npp-justify-between"><span class="npp-text-muted">Chương trình</span><strong style="text-align:right;">${escapeHtml(pg.program_name || '')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Trạng thái</span><span class="npp-badge npp-badge-${WF_BADGE[p.workflow_state] || 'muted'}">${escapeHtml(p.workflow_state || '—')}</span></div>
                    ${row ? `<div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Phụ trách</span><strong>${ownerCell(row)}</strong></div>` : ''}
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Địa chỉ</span><strong style="text-align:right;">${escapeHtml(pt.address_line || '—')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Điện thoại</span><strong>${escapeHtml(pt.phone || '—')}</strong></div>
                    <div class="npp-flex npp-justify-between npp-mt-2"><span class="npp-text-muted">Cập nhật</span><strong>${p.modified ? formatDate(p.modified) : '—'}</strong></div>
                    ${p.reject_reason ? `<div class="npp-mt-2 npp-text-sm" style="color:var(--npp-danger);">Lý do từ chối: ${escapeHtml(p.reject_reason)}</div>` : ''}
                    ${(p.latitude && p.longitude) ? `<div class="npp-mt-2"><a href="https://www.google.com/maps?q=${p.latitude},${p.longitude}" target="_blank" rel="noopener" class="npp-link">📍 Mở bản đồ</a></div>` : ''}
                </div>
                <h4 class="npp-font-bold npp-mt-3">Hình ảnh tham gia</h4>
                <div class="npp-mt-2">${imgGrid}</div>
                ${approved ? `<div id="km-paybox" class="npp-mt-3" data-part="${attr(name)}"><div class="npp-skeleton" style="height:120px;"></div></div>` : ''}`,
        });
        bindBack(back);
        if (approved) loadPayBox(name, seq, pt.point_name || p.display_point || name, () => participationDetailModal(name, back));
    } catch (err) {
        if (!modalAlive(seq)) return;
        showModal({ title: '⚠️ Lỗi', body: `${back ? backBar(back) : ''}<div class="npp-text-muted">${escapeHtml(errText(err))}</div>` });
        bindBack(back);
    }
}
