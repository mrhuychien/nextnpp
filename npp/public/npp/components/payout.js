// Trả thưởng điểm bán 2 lần (salep doc/09) — dùng chung cho tab Khuyến mại (/npp, npp.api.promo.*)
// và màn quản lý kênh /ql-km (npp.api.promo_admin.*). Endpoint là THAM SỐ để 2 view tái dùng:
//   endpoint = { get, record, remove }   (get nhận {name}; record/remove nhận {participation, payout_round, …})
// Luật (R1–R7) kiểm ở server (salep.api.payout); phía này chỉ chặn sớm cho dễ dùng.
// Ảnh: chọn từ THƯ VIỆN (<input type=file accept=image/* multiple>, KHÔNG capture), không xin GPS,
// thu nhỏ bằng canvas (≤1600px, JPEG 0.85) rồi upload từng ảnh qua /api/method/upload_file.

import { escapeHtml, formatDateTime, formatNumber, todayISO } from '../lib/format.js';
import * as api from '../lib/api.js';
import { showModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import './lightbox.js';   // side-effect: bấm img.npp-zoomable → xem to

export const MAX_PHOTOS = 10;          // khớp salep payout.MAX_PHOTOS
export const PAY_STATUS = { none: 'Chưa trả lần 1', r1: 'Đã trả lần 1', done: 'Đủ 2 lần' };
const MAX_DIM = 1600;                  // cạnh dài tối đa sau khi thu nhỏ (px)
const JPEG_Q = 0.85;
const OWNER_NONE = '__none__';         // lọc Phụ trách: lượt không rõ người phụ trách
const SALEP_OLD = 'Cần cập nhật app salep';
const PROG_BADGE = { 'Nháp': 'muted', 'Đang chạy': 'success', 'Kết thúc': 'primary' };

let _formSeq = 0;
let _previews = [];                    // object URL xem trước của form gần nhất (thu hồi khi mở form mới)

// ─── Tiện ích ──────────────────────────────────────────────────────────
// escapeHtml không thoát dấu " → dùng attr() cho giá trị nằm trong thuộc tính HTML.
function attr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
// Chỉ nhận URL nội bộ (/files/…, /private/files/…) hoặc http(s) — chặn javascript:/data: lọt vào src.
function safeUrl(u) { return /^(\/(?!\/)|https?:\/\/)/i.test(String(u || '')) ? String(u) : ''; }
function opt(val, label, sel) {
    return `<option value="${attr(val)}"${val === sel ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}
// Tìm không dấu: NFD + bỏ dấu + đ→d, chữ thường; mọi từ phải khớp (thứ tự bất kỳ).
function norm(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
}
function matches(q, key) { return norm(q).split(' ').filter(Boolean).every((w) => key.includes(w)); }
function rowKey(r) {
    return r._pk || (r._pk = norm([r.point_name, r.point_phone, r.staff_name, r.program_name, r.distributor_name]
        .filter(Boolean).join(' ')) + ' ' + String(r.point_phone || '').replace(/\D/g, ''));
}

/** 'YYYY-MM-DD' → 'dd/mm/yyyy' (không qua Date → không lệch múi giờ). */
export function dateVN(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (s ? escapeHtml(s) : '—');
}
// 'YYYY-MM-DD HH:MM[:SS[.ffffff]]' (giờ server) → 'HH:MM dd/mm/yyyy'. Không qua new Date(): Safari iOS trả
// Invalid Date với chuỗi có dấu cách + micro giây (str(datetime) của Frappe) → formatDateTime in nguyên chuỗi.
function dateTimeVN(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? `${m[4]}:${m[5]} ${m[3]}/${m[2]}/${m[1]}` : escapeHtml(formatDateTime(s));
}

/** Thông điệp lỗi từ api.call (có thể là traceback / mảng JSON) → câu tiếng Việt cuối. */
export function payErrText(err) {
    let s = String((err && err.message) || '');
    if (s.startsWith('[')) { try { s = JSON.parse(s).join('\n'); } catch (e) { /* bị cắt 500 ký tự → giữ nguyên */ } }
    const i = s.indexOf(SALEP_OLD);
    if (i >= 0) return s.slice(i).split(/["\n]/)[0];
    const m = s.match(/\w+Error: ([^\n]+)\s*$/);
    return m ? m[1] : s;
}
function errToast(err) {
    const t = payErrText(err);
    if (t.includes(SALEP_OLD)) showToast(t, 'warning', 6000);   // npp mới + salep cũ → cảnh báo nguyên văn
    else showToast('Lỗi: ' + (t || 'không rõ'), 'error', 5000);
}

// Luôn đủ 2 phần tử [Lần 1, Lần 2] dù server trả thiếu.
function normRounds(rounds) {
    const by = {};
    (rounds || []).forEach((r) => { if (r && (r.round === 1 || r.round === 2)) by[r.round] = r; });
    return [1, 2].map((k) => by[k] || { round: k, paid: false, photos: [] });
}

// ─── Tiến độ (bảng chương trình + KPI) ─────────────────────────────────
function pct(paid, total) { return total ? Math.max(0, Math.min(100, paid / total * 100)) : 0; }
export function payBar(p) {
    const v = Math.max(0, Math.min(100, Number(p) || 0));
    return `<div class="npp-pay-bar${v >= 100 ? ' npp-pay-full' : ''}"><i style="width:${v.toFixed(1)}%;"></i></div>`;
}
function progCell(paid, total, p) {
    const v = p != null ? Number(p) : pct(paid, total);
    return `<div class="npp-pay-pc"><div><strong>${formatNumber(paid || 0)}</strong>/${formatNumber(total || 0)} <span class="npp-text-sm npp-text-muted">(${v.toFixed(0)}%)</span></div>${payBar(v)}</div>`;
}

/** 2 thẻ KPI Lần 1 / Lần 2 (x/N + thanh %) từ totals {eligible, paid_1, paid_2}. */
export function payoutKpiHtml(totals) {
    const t = totals || {}, n = t.eligible || 0;
    const card = (k, paid) => `<div class="npp-kpi-card"><div class="npp-kpi-label">Đã trả lần ${k}</div>
        <div class="npp-kpi-value">${formatNumber(paid || 0)}<span style="font-size:.8rem;font-weight:600;">/${formatNumber(n)}</span></div>
        <div class="npp-kpi-sub">${pct(paid, n).toFixed(0)}% · còn ${formatNumber(Math.max(0, n - (paid || 0)))} lượt</div>${payBar(pct(paid, n))}</div>`;
    return `<div class="npp-kpi-grid" style="margin-top:0;">${card(1, t.paid_1)}${card(2, t.paid_2)}</div>`;
}

/**
 * Bảng tiến độ theo chương trình: Chương trình · Đủ ĐK · Lần 1 x/N + bar · Lần 2 y/N + bar.
 * Dòng có class npp-pay-progrow + data-p (mã chương trình) → view tự bắt click để lọc.
 * Dòng "Tổng N chương trình" CỘNG từ chính các dòng: server trả `programs` đủ mọi chương trình
 * (không lọc) nhưng `totals` chỉ tính chương trình đang chọn → không dùng `totals` cho dòng tổng.
 */
export function progressTableHtml(programs, totals, { selected = '' } = {}) {   // totals: giữ chữ ký cũ (2 view đang truyền), không dùng
    const list = programs || [];
    const t = list.reduce((a, p) => ({
        eligible: a.eligible + (Number(p.eligible) || 0),
        paid_1: a.paid_1 + (Number(p.paid_1) || 0),
        paid_2: a.paid_2 + (Number(p.paid_2) || 0),
    }), { eligible: 0, paid_1: 0, paid_2: 0 });
    const rows = list.map((p) => `<tr class="npp-pay-progrow${p.program === selected ? ' npp-active' : ''}" data-p="${attr(p.program)}" style="cursor:pointer;">
            <td data-label="Chương trình"><div><strong>${escapeHtml(p.program_name || p.program)}</strong>
                <div class="npp-text-sm npp-text-muted"><span class="npp-badge npp-badge-${PROG_BADGE[p.status] || 'muted'}">${escapeHtml(p.status || '—')}</span>
                ${p.start_date ? dateVN(p.start_date) : ''}${p.end_date ? ' → ' + dateVN(p.end_date) : ''}${p.reward_per_point ? ' · ' + formatNumber(p.reward_per_point) + 'đ/điểm' : ''}</div></div></td>
            <td data-label="Đủ ĐK" class="npp-text-end"><strong>${formatNumber(p.eligible || 0)}</strong></td>
            <td data-label="Lần 1">${progCell(p.paid_1, p.eligible, p.pct_1)}</td>
            <td data-label="Lần 2">${progCell(p.paid_2, p.eligible, p.pct_2)}</td>
        </tr>`).join('');
    const total = list.length > 1 ? `<tr class="npp-pay-total">
            <td data-label="Tổng"><strong>Tổng ${formatNumber(list.length)} chương trình</strong></td>
            <td data-label="Đủ ĐK" class="npp-text-end"><strong>${formatNumber(t.eligible || 0)}</strong></td>
            <td data-label="Lần 1">${progCell(t.paid_1, t.eligible)}</td>
            <td data-label="Lần 2">${progCell(t.paid_2, t.eligible)}</td>
        </tr>` : '';
    return `<div style="overflow-x:auto;"><table class="npp-table npp-pay-progtable">
        <thead><tr><th>Chương trình</th><th class="npp-text-end">Đủ ĐK</th><th style="min-width:130px;">Lần 1</th><th style="min-width:130px;">Lần 2</th></tr></thead>
        <tbody>${rows}${total}</tbody></table></div>`;
}

// ─── Danh sách lượt (lọc + bảng 1 trang) ───────────────────────────────
/** Select trạng thái trả: Tất cả / Chưa trả lần 1 / Đã trả lần 1 / Đủ 2 lần (kèm số lượt). */
export function payStatusOptions(rows, sel) {
    const all = rows || [];
    const cnt = { none: 0, r1: 0, done: 0 };
    all.forEach((r) => { if (cnt[r.status] !== undefined) cnt[r.status] += 1; });
    return opt('', `Trạng thái trả: Tất cả · ${formatNumber(all.length)}`, sel)
        + Object.keys(PAY_STATUS).map((k) => opt(k, `${PAY_STATUS[k]} · ${formatNumber(cnt[k])}`, sel)).join('');
}
/** Select Phụ trách dựng từ chính các dòng (owner → staff_name, kèm số lượt). */
export function payOwnerOptions(rows, sel) {
    const by = new Map();
    (rows || []).forEach((r) => {
        const k = r.owner || OWNER_NONE;
        const e = by.get(k) || { label: r.staff_name || r.owner || '— chưa rõ', n: 0 };
        e.n += 1;
        by.set(k, e);
    });
    const list = [...by.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'vi'));
    return opt('', 'Phụ trách: Tất cả', sel) + list.map(([k, e]) => opt(k, `${e.label} · ${formatNumber(e.n)}`, sel)).join('');
}
export function payOwnerValid(rows, sel) { return !sel || (rows || []).some((r) => (r.owner || OWNER_NONE) === sel); }
/** Lọc trên TOÀN BỘ dòng: f = {status, owner, q} — tìm không dấu theo điểm bán, SĐT, NV, chương trình, NPP. */
export function filterPayRows(rows, f) {
    const q = (f && f.q) || '';
    return (rows || []).filter((r) => (!f.status || r.status === f.status)
        && (!f.owner || (r.owner || OWNER_NONE) === f.owner)
        && (!q || matches(q, rowKey(r))));
}

function roundCell(x) {
    if (!x) return '<span class="npp-text-muted">—</span>';
    return `<span class="npp-pay-cell"><span class="npp-pay-ok">✓ ${dateVN(x.payout_date)}</span>${x.photos ? ` <span class="npp-text-sm npp-text-muted">📷${formatNumber(x.photos)}</span>` : ''}</span>`;
}
/**
 * Bảng 1 trang danh sách lượt: Điểm bán · [NPP] · Phụ trách · Lần 1 · Lần 2.
 * Dòng có class npp-pay-lrow + data-n (tên lượt) → view gán click (paged onDraw).
 */
export function payoutListTable(slice, { showNpp = false, showProgram = true } = {}) {
    return `<div style="overflow-x:auto;"><table class="npp-table">
        <thead><tr><th>Điểm bán</th>${showNpp ? '<th>NPP</th>' : ''}<th>Phụ trách</th><th>Lần 1</th><th>Lần 2</th></tr></thead>
        <tbody>${(slice || []).map((r) => `<tr class="npp-pay-lrow" data-n="${attr(r.participation)}" style="cursor:pointer;">
            <td data-label="Điểm bán"><div><strong>${escapeHtml(r.point_name || r.display_point || '')}</strong>${r.point_phone ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(r.point_phone)}</div>` : ''}${showProgram && r.program_name ? `<div class="npp-text-sm npp-text-muted">${escapeHtml(r.program_name)}</div>` : ''}</div></td>
            ${showNpp ? `<td data-label="NPP" class="npp-text-sm">${escapeHtml(r.distributor_name || r.distributor || '—')}</td>` : ''}
            <td data-label="Phụ trách" class="npp-text-sm">${escapeHtml(r.staff_name || r.owner || '—')}</td>
            <td data-label="Lần 1">${roundCell(r.round_1)}</td>
            <td data-label="Lần 2">${roundCell(r.round_2)}</td>
        </tr>`).join('')}</tbody></table></div>`;
}

// ─── Mục Trả thưởng của 1 lượt (2 dòng Lần 1 / Lần 2) ──────────────────
/**
 * HTML mục "💰 Trả thưởng" từ participation_payouts: mỗi lần ✓ ngày · người ghi · ảnh bấm phóng to,
 * hoặc "Chưa trả". opts.canRecord → nút Ghi/Sửa; opts.canDelete → nút Xoá (không xoá Lần 1 khi đã có
 * Lần 2 — R7). Lần 2 chỉ ghi được khi đã có Lần 1 (R3). Gắn sự kiện bằng bindPayoutSection().
 */
export function payoutSectionHtml(data, opts = {}) {
    const { canRecord = false, canDelete = false } = opts;
    const d = data || {};
    const eligible = !!d.eligible;
    const rounds = normRounds(d.rounds);
    const [r1, r2] = rounds;
    const nDone = (r1.paid ? 1 : 0) + (r2.paid ? 1 : 0);
    const row = (r) => {
        const k = r.round;
        const canAdd = canRecord && eligible && !r.paid && (k === 1 || r1.paid);
        const canEdit = canRecord && eligible && r.paid;
        const canDel = canDelete && r.paid && !(k === 1 && r2.paid);
        const photos = (r.photos || []).map((p) => safeUrl(p && (p.url || p.image || p.file_url))).filter(Boolean);
        const acts = (canAdd ? `<button type="button" class="npp-btn-primary npp-pay-act" data-pay-act="add" data-round="${k}">➕ Ghi trả thưởng lần ${k}</button>` : '')
            + (canEdit ? `<button type="button" class="npp-cn-btn npp-pay-act" data-pay-act="edit" data-round="${k}">✏️ Sửa</button>` : '')
            + (canDel ? `<button type="button" class="npp-cn-btn npp-pay-act npp-pay-del" data-pay-act="del" data-round="${k}">🗑 Xoá</button>` : '');
        return `<div class="npp-pay-round${r.paid ? ' npp-pay-done' : ''}">
            <div class="npp-pay-rhead"><strong>Lần ${k}</strong>
                ${r.paid
                    ? `<span class="npp-pay-ok">✓ ${dateVN(r.payout_date)}</span>${r.recorded_by_label || r.recorded_by ? `<span class="npp-text-sm npp-text-muted">· ${escapeHtml(r.recorded_by_label || r.recorded_by)}</span>` : ''}`
                    : '<span class="npp-text-muted">Chưa trả</span>'}
            </div>
            ${r.paid && r.recorded_on ? `<div class="npp-text-sm npp-text-muted">Ghi lúc ${dateTimeVN(r.recorded_on)}</div>` : ''}
            ${r.paid && r.note ? `<div class="npp-text-sm npp-mt-1">📝 ${escapeHtml(r.note)}</div>` : ''}
            ${photos.length ? `<div class="npp-pay-thumbs">${photos.map((u, i) => `<img class="npp-zoomable" src="${attr(u)}" alt="${attr(`Ảnh trả thưởng lần ${k} (${i + 1})`)}" loading="lazy">`).join('')}</div>` : ''}
            ${!r.paid && k === 2 && !r1.paid && canRecord && eligible ? '<div class="npp-text-sm npp-text-muted npp-mt-1">Ghi được sau khi đã trả lần 1.</div>' : ''}
            ${acts ? `<div class="npp-pay-acts">${acts}</div>` : ''}
        </div>`;
    };
    return `<div class="npp-pay">
        <div class="npp-pay-head"><h4 class="npp-font-bold">💰 Trả thưởng</h4>
            <span class="npp-badge npp-badge-${nDone === 2 ? 'success' : (nDone ? 'warning' : 'muted')}">${nDone}/2 lần</span></div>
        ${d.reward_per_point ? `<div class="npp-text-sm npp-text-muted">Mức thưởng: <strong>${formatNumber(d.reward_per_point)}đ</strong>/điểm</div>` : ''}
        ${eligible ? '' : '<div class="npp-note-block npp-note-internal npp-mt-2">Chỉ lượt <strong>Đã duyệt</strong> mới trả thưởng được.</div>'}
        ${rounds.map(row).join('')}
    </div>`;
}

/**
 * Gắn nút Ghi / Sửa / Xoá của mục vừa vẽ (root chứa payoutSectionHtml).
 * ctx: { data, participation, pointName, endpoint, back, onDone(result, alive) }.
 * back = hàm mở LẠI modal đang đứng (form có "← Quay lại"); onDone gọi sau khi ghi/xoá thành công.
 */
export function bindPayoutSection(root, ctx = {}) {
    if (!root) return;
    const { data, participation, pointName = '', endpoint, back = null, onDone = null } = ctx;
    const rounds = normRounds(data && data.rounds);
    root.querySelectorAll('.npp-pay-act').forEach((b) => b.addEventListener('click', () => {
        const k = Number(b.dataset.round) === 2 ? 2 : 1;
        if (b.dataset.payAct === 'del') {
            deletePayout({ participation, round: k, pointName, endpoint, onDone, btn: b });
            return;
        }
        const r = rounds[k - 1];
        openPayoutForm({
            participation, round: k, pointName, endpoint, back, onDone,
            existing: r.paid ? r : null,
            minDate: k === 2 && rounds[0].paid ? rounds[0].payout_date : null,   // R3: ngày lần 2 ≥ ngày lần 1
            maxDate: k === 1 && rounds[1].paid ? rounds[1].payout_date : null,   // sửa lần 1 không vượt ngày lần 2
        });
    }));
}

// ─── Ảnh: thu nhỏ + upload ─────────────────────────────────────────────
function csrfToken() {
    return (window.NPP_CONTEXT && window.NPP_CONTEXT.csrfToken) || (window.frappe && window.frappe.csrf_token) || '';
}

// Thu nhỏ (cạnh dài ≤ MAX_DIM) + tái mã hoá JPEG. Trả {blob, name}. Ảnh JPEG/PNG gốc đã nhỏ hơn
// bản nén → giữ gốc; định dạng khác (HEIC/WebP…) luôn đổi sang JPEG vì tài khoản portal chỉ được
// upload JPG/PNG. Trình duyệt không giải mã được → gửi gốc (server tự kiểm định dạng).
async function resizeImage(file) {
    const orig = { blob: file, name: file.name || 'tra-thuong.jpg' };
    let url = '';
    try {
        url = URL.createObjectURL(file);
        const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = url;
        });
        const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
        if (!w0 || !h0) return orig;
        const scale = Math.min(1, MAX_DIM / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';            // PNG trong suốt → nền trắng (JPEG không có kênh alpha)
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_Q));
        if (!blob) return orig;
        if (/^image\/(jpeg|png)$/.test(file.type || '') && blob.size >= file.size) return orig;
        const base = (file.name || '').replace(/\.[^.]+$/, '') || 'tra-thuong';
        return { blob, name: base + '.jpg' };
    } catch (e) {
        return orig;
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

function uploadErrMsg(j) {
    try {
        const msg = JSON.parse((j && j._server_messages) || '[]').map((m) => {
            try { return JSON.parse(m).message; } catch (e) { return m; }
        }).filter(Boolean).join('; ');
        if (msg) return String(msg).replace(/<[^>]*>/g, '');
    } catch (e) { /* _server_messages hỏng → dùng exception */ }
    const ex = String((j && j.exception) || '');
    return ex.replace(/^[\w.]+Error:\s*/, '');
}

// Upload 1 ảnh (public — portal hiển thị được). Trả file_url (/files/…).
async function uploadImage(file) {
    const { blob, name } = await resizeImage(file);
    const fd = new FormData();
    // Bỏ dấu nháy / < > / ký tự điều khiển khỏi tên file — server từ chối URL ảnh chứa chúng.
    fd.append('file', blob, String(name || 'tra-thuong.jpg').replace(/["'<>`\\\u0000-\u001f\u007f]/g, '_'));
    fd.append('is_private', '0');
    fd.append('folder', 'Home');
    let res;
    try {
        res = await fetch('/api/method/upload_file', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-Frappe-CSRF-Token': csrfToken(), Accept: 'application/json' },
            body: fd,
        });
    } catch (e) {
        throw new Error('Lỗi mạng khi tải ảnh — kiểm tra kết nối rồi thử lại.');
    }
    let j = {};
    try { j = await res.json(); } catch (e) { /* body không phải JSON (502, trang lỗi HTML…) */ }
    const url = j && j.message && j.message.file_url;
    if (!res.ok || !url) throw new Error(uploadErrMsg(j) || `Tải ảnh thất bại (mã ${res.status}).`);
    return url;
}

// ─── Form ghi / sửa 1 lần trả thưởng ───────────────────────────────────
/**
 * Modal "💰 Trả thưởng lần N — <điểm bán>": ngày trả (mặc định hôm nay, max hôm nay), ảnh chọn từ thư
 * viện (xem trước + xoá từng ảnh, tối đa 10), ghi chú, nút "Lưu trả thưởng" (chống bấm 2 lần).
 * o: { participation, round, pointName, existing (dòng rounds[] đã trả → điền sẵn), endpoint,
 *      back (mở lại màn trước), onDone(result, alive), minDate?, maxDate? }.
 */
export function openPayoutForm(o = {}) {
    const { participation, pointName = '', existing = null, endpoint, back = null, onDone = null } = o;
    const k = Number(o.round) === 2 ? 2 : 1;
    const today = todayISO();
    const lo = o.minDate ? String(o.minDate).slice(0, 10) : '';   // ngày trả lần 1 (khi ghi lần 2)
    const hi = o.maxDate ? String(o.maxDate).slice(0, 10) : '';   // ngày trả lần 2 (khi sửa lần 1)
    const minDate = lo && lo <= today ? lo : '';
    const maxDate = hi && hi < today ? hi : today;
    let initDate = (existing && existing.payout_date ? String(existing.payout_date).slice(0, 10) : '') || today;
    if (initDate > maxDate) initDate = maxDate;
    if (minDate && initDate < minDate) initDate = minDate;
    // Mỗi ảnh: {url} đã upload (ảnh cũ khi sửa) hoặc {file, preview} mới chọn — url gán sau khi upload
    // xong (lưu lỗi bấm lại không upload lại ảnh đã lên).
    _previews.forEach((u) => URL.revokeObjectURL(u));
    _previews = [];
    const items = ((existing && existing.photos) || [])
        .map((p) => safeUrl(p && (p.url || p.image || p.file_url))).filter(Boolean).map((url) => ({ url }));
    const formId = 'npp-pay-form-' + (++_formSeq);
    let busy = false;

    showModal({
        title: `💰 Trả thưởng lần ${k} — ${escapeHtml(pointName)}`,
        body: `<div id="${formId}" class="npp-pay-form">
            <div style="margin:-4px 0 8px;"><a href="javascript:void(0)" id="npp-pay-back" class="npp-link">← ${back ? 'Quay lại' : 'Đóng'}</a></div>
            ${existing ? '<div class="npp-note-block npp-note-internal" style="margin:0 0 10px;">✏️ Đang sửa lần đã ghi — lưu sẽ thay ngày, ảnh và ghi chú.</div>' : ''}
            <div><label class="npp-cn-flabel" for="npp-pay-date">Ngày trả thưởng *</label>
                <input id="npp-pay-date" type="date" class="npp-cn-input npp-pay-input" value="${attr(initDate)}" max="${attr(maxDate)}"${minDate ? ` min="${attr(minDate)}"` : ''}>
                ${minDate ? `<div class="npp-text-sm npp-text-muted npp-mt-1">Từ ${dateVN(minDate)} (ngày trả lần 1) đến ${dateVN(maxDate)}.</div>` : ''}</div>
            <div class="npp-mt-3"><label class="npp-cn-flabel">Ảnh trả thưởng * (1–${MAX_PHOTOS} ảnh)</label>
                <div id="npp-pay-grid" class="npp-pay-picker"></div>
                <input id="npp-pay-file" type="file" accept="image/*" multiple hidden>
                <div class="npp-text-sm npp-text-muted npp-mt-1">Chọn từ thư viện: ảnh chuyển khoản, biên nhận, ảnh trao thưởng… Không cần vị trí.</div></div>
            <div class="npp-mt-3"><label class="npp-cn-flabel" for="npp-pay-note">Ghi chú (tuỳ chọn)</label>
                <textarea id="npp-pay-note" class="npp-textarea" rows="2" placeholder="VD: chuyển khoản, tiền mặt, số tiền…">${escapeHtml((existing && existing.note) || '')}</textarea></div>
            <div id="npp-pay-up" class="npp-pay-upbar" hidden><div id="npp-pay-uptxt" class="npp-text-sm npp-font-bold"></div>${payBar(0)}</div>
            <div class="npp-flex npp-flex-wrap" style="gap:8px;margin-top:12px;">
                <button id="npp-pay-save" type="button" class="npp-btn-primary" style="flex:2;min-width:150px;padding:10px;">💾 Lưu trả thưởng</button>
                <button id="npp-pay-cancel" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:10px;">Huỷ</button>
            </div>
        </div>`,
    });

    const $ = (id) => document.getElementById(id);
    const alive = () => !!$(formId);
    const grid = $('npp-pay-grid');
    const fileInput = $('npp-pay-file');
    const leave = () => { if (busy) return; if (back) back(); else closeModal(); };

    function renderGrid() {
        if (!grid) return;
        grid.innerHTML = items.map((it, i) => `<div class="npp-pay-prev">
                <img class="npp-zoomable" src="${attr(it.preview || it.url)}" alt="${attr(`Ảnh trả thưởng ${i + 1}`)}">
                ${it.file && !it.url ? '<span class="npp-pay-new">Mới</span>' : ''}
                <button type="button" class="npp-pay-rm" data-i="${i}" aria-label="${attr(`Bỏ ảnh ${i + 1}`)}"${busy ? ' disabled' : ''}>✕</button>
            </div>`).join('')
            + (items.length < MAX_PHOTOS
                ? `<button type="button" class="npp-pay-addimg" id="npp-pay-pick"${busy ? ' disabled' : ''}><span aria-hidden="true">🖼️</span><span>${items.length ? 'Thêm ảnh' : 'Chọn ảnh'}</span></button>`
                : '');
    }
    function setBusy(on, label) {
        busy = on;
        ['npp-pay-save', 'npp-pay-cancel', 'npp-pay-date', 'npp-pay-note'].forEach((id) => { const el = $(id); if (el) el.disabled = on; });
        const save = $('npp-pay-save');
        if (save) save.textContent = on ? (label || '⏳ Đang lưu…') : '💾 Lưu trả thưởng';
        if (!on) { const up = $('npp-pay-up'); if (up) up.hidden = true; }
        renderGrid();
    }
    function progress(text, p) {
        // Form đã đóng (× / nền) mà lượt lưu vẫn chạy → KHÔNG ghi vào form khác đang mở (id cố định trùng).
        if (!alive()) return;
        const up = $('npp-pay-up');
        if (!up) return;
        up.hidden = false;
        const t = $('npp-pay-uptxt');
        if (t) t.textContent = text;
        const bar = up.querySelector('.npp-pay-bar > i');
        if (bar) bar.style.width = Math.max(0, Math.min(100, p)).toFixed(0) + '%';
        const save = $('npp-pay-save');
        if (save) save.textContent = text;
    }

    grid.onclick = (e) => {
        if (busy) return;
        const rm = e.target.closest('.npp-pay-rm');
        if (rm) {
            const it = items.splice(Number(rm.dataset.i), 1)[0];
            if (it && it.preview) { URL.revokeObjectURL(it.preview); _previews = _previews.filter((u) => u !== it.preview); }
            renderGrid();
            return;
        }
        if (e.target.closest('#npp-pay-pick')) fileInput.click();
    };
    fileInput.addEventListener('change', () => {
        const picked = Array.from(fileInput.files || []);
        fileInput.value = '';                                  // chọn lại đúng ảnh đó vẫn nhận change
        const imgs = picked.filter((f) => !f.type || f.type.startsWith('image/'));
        if (imgs.length < picked.length) showToast('Chỉ nhận file ảnh — đã bỏ qua file khác', 'warning');
        const room = MAX_PHOTOS - items.length;
        if (imgs.length > room) showToast(`Tối đa ${MAX_PHOTOS} ảnh — chỉ thêm ${Math.max(0, room)} ảnh đầu`, 'warning');
        imgs.slice(0, Math.max(0, room)).forEach((f) => {
            const preview = URL.createObjectURL(f);
            _previews.push(preview);
            items.push({ file: f, preview });
        });
        renderGrid();
    });
    $('npp-pay-back').addEventListener('click', leave);
    $('npp-pay-cancel').addEventListener('click', leave);
    $('npp-pay-save').addEventListener('click', save);
    renderGrid();

    async function save() {
        if (busy) return;
        const date = ($('npp-pay-date')?.value || '').trim();
        const note = ($('npp-pay-note')?.value || '').trim();
        if (!date) return showToast('Chọn ngày trả thưởng', 'warning');
        if (date > todayISO()) return showToast('Ngày trả thưởng không được ở tương lai', 'warning');
        if (minDate && date < minDate) return showToast(`Ngày trả lần 2 phải từ ${dateVN(minDate)} (ngày trả lần 1) trở đi`, 'warning');
        if (hi && date > hi) return showToast(`Ngày trả lần 1 không được sau ngày trả lần 2 (${dateVN(hi)})`, 'warning');
        if (!items.length) return showToast('Cần ít nhất 1 ảnh trả thưởng', 'warning');
        if (items.length > MAX_PHOTOS) return showToast(`Tối đa ${MAX_PHOTOS} ảnh`, 'warning');
        setBusy(true);
        try {
            const todo = items.filter((it) => !it.url);
            for (let i = 0; i < todo.length; i += 1) {
                progress(`⏳ Đang tải ảnh ${i + 1}/${todo.length}…`, (i / todo.length) * 100);
                todo[i].url = await uploadImage(todo[i].file);
            }
            progress('⏳ Đang lưu…', 100);
            const r = await api.call(endpoint.record, {
                participation, payout_round: k, payout_date: date, photos: items.map((it) => it.url), note,
            });
            busy = false;
            const still = alive();
            // Form đã đóng → kèm tên điểm bán để không lẫn với form khác đang mở.
            showToast(`Đã lưu trả thưởng lần ${k}${!still && pointName ? ` — ${pointName}` : ''}`, 'success');
            if (onDone) onDone(r, still);
            else if (still) closeModal();
        } catch (err) {
            errToast(err);
            if (alive()) setBusy(false);
            else busy = false;
        }
    }
}

/** Xoá 1 lần trả thưởng (confirm → endpoint.remove). Trả true nếu đã xoá. */
export async function deletePayout({ participation, round, pointName = '', endpoint, onDone = null, btn = null } = {}) {
    const k = Number(round) === 2 ? 2 : 1;
    if (!window.confirm(`Xoá trả thưởng lần ${k}${pointName ? ` của "${pointName}"` : ''}?\nNgày trả, ảnh và ghi chú của lần này sẽ bị xoá.`)) return false;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang xoá…'; }
    try {
        const r = await api.call(endpoint.remove, { participation, payout_round: k });
        showToast(`Đã xoá trả thưởng lần ${k}`, 'success');
        if (onDone) onDone(r, true);
        return true;
    } catch (err) {
        errToast(err);
        if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
        return false;
    }
}
