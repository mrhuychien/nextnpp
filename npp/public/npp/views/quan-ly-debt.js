import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, formatDate, todayISO, debounce, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'], ['#/ql-npp', 'npp', '🔍 Chi tiết NPP'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'],
                   ['#/ql-debt', 'db', '💰 Công nợ'], ['#/ql-tet', 'tet', '🧧 Tết'], ['#/ql-ds', 'ds', '📅 DS tháng'], ['#/ql-km', 'km', '🎁 Khuyến mại'], ['#/ql-bot', 'bot', '🥣 Hàng bột']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

const BUCKETS = [
    ['current', 'Trong hạn', 'success'], ['d1_30', '1–30 ngày', 'muted'],
    ['d31_60', '31–60 ngày', 'warning'], ['d61_90', '61–90 ngày', 'warning'], ['over_90', '> 90 ngày', 'danger'],
];
const PLEVEL = { grace: ['npp-badge-muted', '⏳'], warn: ['npp-badge-warning', '🟠'], critical: ['npp-badge-danger', '🔴'], ok: ['npp-badge-success', '✅'] };

function policySection(p) {
    p = p || {};
    const alerts = p.alerts || [];
    const done = p.completed || [];
    const rm = p.reward_month ? ` tháng ${p.reward_month}` : ' tháng trước';
    const doneHtml = done.length ? `
        <div class="npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:8px;">
                <h4 class="npp-font-bold">🎉 Đã hoàn thành thanh toán — thật tuyệt vời!</h4>
                <span class="npp-badge npp-badge-success">${done.length} NPP</span></div>
            <div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th>Tỉnh</th><th class="npp-text-end">Thưởng 2%${escapeHtml(rm)}</th></tr></thead>
                <tbody>${done.map((r) => `<tr>
                    <td data-label="NPP">🎉 <a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a></td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="Thưởng" class="npp-text-end"><strong style="color:var(--npp-success);">${formatCurrency(r.reward_effective)}</strong></td>
                </tr>`).join('')}</tbody></table></div>
        </div>` : '';
    return html`
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:8px;">
                <h3 class="npp-font-bold">🧾 Chính sách thanh toán — kế toán xử lý</h3>
                <span class="npp-badge ${p.action_needed ? 'npp-badge-danger' : 'npp-badge-success'}">${p.action_needed || 0} NPP cần xử lý</span>
            </div>
            ${p.action_needed ? `<div class="npp-risk-bar npp-mt-2"><span>🚨 <strong>${p.warn || 0}</strong> NPP phạt 50% thưởng · <strong>${p.critical || 0}</strong> NPP cắt thưởng</span><span>Tổng phạt thưởng ~ <strong>${formatVNDShort(p.penalty_total || 0)}</strong></span></div>` : ''}
            ${alerts.length ? `<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th>Tỉnh</th><th class="npp-text-center">Trễ</th><th>Trạng thái</th><th class="npp-text-end">Nợ quá hạn</th><th class="npp-text-end">Thưởng 2%${escapeHtml(rm)}</th><th class="npp-text-end">Còn được</th></tr></thead>
                <tbody>${alerts.map((r) => { const lv = PLEVEL[r.level] || PLEVEL.grace; return `<tr>
                    <td data-label="NPP"><a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a></td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="Trễ" class="npp-text-center">${r.days_late}d</td>
                    <td data-label="Trạng thái"><span class="npp-badge ${lv[0]}">${lv[1]} ${escapeHtml(r.label)}</span></td>
                    <td data-label="Nợ quá hạn" class="npp-text-end"><strong style="color:var(--npp-danger);">${formatCurrency(r.overdue)}</strong></td>
                    <td data-label="Thưởng 2%" class="npp-text-end">${formatCurrency(r.reward_full)}</td>
                    <td data-label="Còn được" class="npp-text-end"><strong style="color:${r.reward_factor > 0 ? 'var(--npp-success)' : 'var(--npp-danger)'};">${formatCurrency(r.reward_effective)}</strong></td>
                </tr>`; }).join('')}</tbody></table></div>
                <p class="npp-text-sm npp-text-muted npp-mt-2">Thưởng 2% tính trên doanh số<strong>${escapeHtml(rm)}</strong>. Trễ 6–10 ngày (từ ngày 10) phạt 50%, trễ &gt;10 ngày cắt thưởng. Số để tham khảo — kế toán tự xử lý chi thưởng.</p>`
                : '<p class="npp-text-sm npp-text-muted npp-mt-2">✅ Không có NPP nào trễ hạn thanh toán.</p>'}
            ${doneHtml}
        </div>`;
}

// ─── Trạng thái view ──────────────────────────────────────────────────────
let _d = null;          // payload receivables (cache, đổi tab không gọi lại API)
let _tab = 'tq';
let _q = '';

const TODO_LABEL = {
    missing_einvoice:  () => 'Cần xuất HĐĐT',
    overdue:           (t) => `Quá hạn ${t.days} ngày — cần thu ${formatCurrency(t.amount)}`,
    in_term:           (t) => `Còn nợ ${formatCurrency(t.amount)} — trong hạn`,
    unmatched_payment: () => 'Chưa khớp hóa đơn',
    draft_return:      () => 'Chờ hóa đơn NPP (trả hàng)',
    draft_je:          () => 'Chờ duyệt bút toán',
};
const todoChips = (todos) => (todos || []).map((t) => {
    const f = TODO_LABEL[t.code];
    return `<span class="npp-todo ${t.sev === 'red' ? 'red' : 'yellow'}">${escapeHtml(f ? f(t) : t.code)}</span>`;
}).join('');

export async function render({ container }) {
    _tab = 'tq'; _q = '';        // vào view là về trạng thái mặc định
    container.innerHTML = html`
        ${banner({ title: 'Công nợ & Tuổi nợ', subtitle: 'Aging toàn kênh · bảng kê NPP · hạn mức · biên bản đối chiếu' })}
        ${nav('db')}
        <div class="npp-seg npp-mt-2" id="db-tabs">
            <button type="button" data-tab="tq" class="npp-active">Tổng quan</button>
            <button type="button" data-tab="ke">Bảng kê NPP</button>
        </div>
        <div id="npp-db-body"><div class="npp-skeleton" style="height:280px;"></div></div>
    `;
    document.querySelectorAll('#db-tabs button').forEach((b) =>
        b.addEventListener('click', () => switchTab(b.dataset.tab)));
    try {
        _d = await api.call('npp.api.manager.receivables');
        paint();
    } catch (err) {
        document.getElementById('npp-db-body').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function switchTab(t) {
    _tab = t;
    document.querySelectorAll('#db-tabs button').forEach((b) => b.classList.toggle('npp-active', b.dataset.tab === t));
    paint();
}

function paint() {
    if (!_d) return;
    if (_tab === 'ke') renderTable(_d); else renderOverview(_d);
}

// ─── TAB 1: Tổng quan ─────────────────────────────────────────────────────
function agingBars(ag) {
    const b = (ag && ag.buckets) || {};
    const max = Math.max(1, ...BUCKETS.map(([k]) => Math.abs(b[k] || 0)));
    const color = { success: 'var(--npp-success)', muted: 'var(--npp-warning)', warning: 'var(--npp-warning)', danger: 'var(--npp-danger)' };
    return `<div class="npp-aging-list npp-mt-2">${BUCKETS.map(([k, label, c]) => `
        <div style="display:grid;grid-template-columns:110px 1fr auto;gap:10px;align-items:center;font-size:.8rem;">
            <span>${label}</span>
            <div class="npp-aging-bar"><div style="width:${Math.abs(b[k] || 0) / max * 100}%;background:${color[c]};"></div></div>
            <strong style="white-space:nowrap;">${formatVNDShort(b[k] || 0)}</strong>
        </div>`).join('')}</div>`;
}

function renderOverview(d) {
    const b = d.buckets || {}, t = d.totals || {}, credit = d.credit || [];
    const ag = d.aging_gl || {}, sch = d.schedule || {};
    const schRight = sch.in_window ? '🟢 Đang trong cửa sổ thu'
        : (sch.days_to_window > 0 ? `Còn ${sch.days_to_window} ngày tới kỳ chốt`
            : `Đã qua hạn ${Math.abs(sch.days_to_due || 0)} ngày`);
    document.getElementById('npp-db-body').innerHTML = html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng công nợ toàn kênh</div>
                <div class="npp-kpi-value">${formatVNDShort(t.debt || 0)}</div>
                <div class="npp-kpi-sub">Số dư sổ cái (GL) · nhóm NPP</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Nợ quá hạn</div>
                <div class="npp-kpi-value danger">${formatVNDShort(t.overdue || 0)}</div>
                <div class="npp-kpi-sub">${t.npp_with_debt || 0} NPP có nợ quá hạn</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Trong hạn</div>
                <div class="npp-kpi-value">${formatVNDShort(t.current || 0)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">DSO</div>
                <div class="npp-kpi-value">${t.dso == null ? '—' : t.dso} <span style="font-size:.8rem;font-weight:600;">ngày</span></div>
                <div class="npp-kpi-sub">Nợ / doanh số 365 ngày × 365</div></div>
        </div>

        ${sch.cutoff ? `<div class="npp-risk-bar npp-mt-3" style="background:var(--npp-surface-2);border-color:var(--npp-border);color:var(--npp-text);">
            <span>📅 <strong>Kỳ thu hiện hành</strong>: chốt ${formatDate(sch.cutoff)} · hạn thanh toán ${formatDate(sch.window_end)}</span>
            <span>${schRight}</span></div>` : ''}

        ${policySection(d.policy)}

        <div class="npp-card npp-mt-3">
            <h3 class="npp-font-bold">Tuổi nợ (theo chứng từ GL)</h3>
            ${agingBars(ag)}
            <p class="npp-text-sm npp-text-muted npp-mt-2">
                Tổng theo chứng từ GL: <strong>${formatCurrency(ag.total || 0)}</strong> — khớp tổng công nợ.
                ${t.unbilled ? `Trong đó <strong>${formatCurrency(t.unbilled)}</strong> chưa gắn với hóa đơn nào (bút toán điều chỉnh, số dư đầu kỳ, khoản thu chưa đối trừ).` : ''}
            </p>
            ${ag.truncated ? '<p class="npp-text-sm" style="color:var(--npp-warning);">⚠ Vượt 20.000 chứng từ — số liệu tuổi nợ có thể chưa đầy đủ.</p>' : ''}
        </div>

        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Hạn mức tín dụng &amp; % sử dụng</h3>
            ${credit.length ? html`<table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th class="npp-text-end">Hạn mức</th><th class="npp-text-end">Dư nợ</th><th class="npp-text-end">% dùng</th></tr></thead>
                <tbody>
                    ${credit.map((r) => html`<tr>
                        <td data-label="NPP">${r.usage_pct >= 100 ? '🔴 ' : (r.usage_pct >= 80 ? '🟠 ' : '')}<a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a></td>
                        <td data-label="Hạn mức" class="npp-text-end">${formatCurrency(r.credit_limit)}</td>
                        <td data-label="Dư nợ" class="npp-text-end">${formatCurrency(r.outstanding)}</td>
                        <td data-label="% dùng" class="npp-text-end"><strong style="color:${r.usage_pct >= 100 ? 'var(--npp-danger)' : (r.usage_pct >= 80 ? 'var(--npp-warning)' : 'var(--npp-text)')};">${r.usage_pct.toFixed(0)}%</strong></td>
                    </tr>`).join('')}
                </tbody>
            </table>` : '<p class="npp-text-sm npp-text-muted npp-mt-2">Chưa thiết lập hạn mức tín dụng (Customer Credit Limit) cho NPP nào.</p>'}
        </div>
    `;
}

// ─── TAB 2: Bảng kê NPP ───────────────────────────────────────────────────
function tbodyHtml(rows) {
    if (!rows.length) return '<tr><td colspan="7" class="npp-text-center npp-text-muted">Không tìm thấy NPP nào</td></tr>';
    return rows.map((r) => {
        const lv = PLEVEL[r.level] || PLEVEL.ok;
        const pct = r.usage_pct == null ? '—'
            : `<strong style="color:${r.usage_pct >= 100 ? 'var(--npp-danger)' : (r.usage_pct >= 80 ? 'var(--npp-warning)' : 'var(--npp-text)')};">${r.usage_pct.toFixed(0)}%</strong>`;
        return `<tr class="npp-table-row-clickable" data-customer="${escapeHtml(r.customer)}">
            <td data-label="NPP"><a href="#/ql-npp?c=${encodeURIComponent(r.customer)}" class="npp-link">${escapeHtml(r.customer_name)}</a></td>
            <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
            <td data-label="Công nợ" class="npp-text-end">${formatCurrency(r.debt)}</td>
            <td data-label="Quá hạn" class="npp-text-end">${r.overdue > 0
                ? `<strong style="color:var(--npp-danger);">${formatCurrency(r.overdue)}</strong><div class="npp-text-sm npp-text-muted">quá ${r.days_overdue} ngày</div>`
                : '<span style="color:var(--npp-success);">trong hạn</span>'}</td>
            <td data-label="Trạng thái"><span class="npp-badge ${lv[0]}">${lv[1]} ${escapeHtml(r.label || '')}</span></td>
            <td data-label="% hạn mức" class="npp-text-end">${pct}</td>
            <td class="npp-text-center" style="white-space:nowrap;">
                <button type="button" class="npp-icon-act db-zalo" data-c="${escapeHtml(r.customer)}" title="Nhắc nợ Zalo">💬</button>
                <button type="button" class="npp-icon-act db-pdf" data-c="${escapeHtml(r.customer)}" title="Xuất biên bản đối chiếu">📄</button>
                <button type="button" class="npp-icon-act db-ledger" data-c="${escapeHtml(r.customer)}" title="Sổ công nợ">📒</button>
            </td></tr>`;
    }).join('');
}

function filtered() {
    const rows = (_d && _d.rows) || [];
    const q = _q.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((r) => (r.customer_name || '').toLowerCase().includes(q)
        || (r.customer || '').toLowerCase().includes(q)
        || (r.territory || '').toLowerCase().includes(q));
}

function renderTable(d) {
    const rows = d.rows || [];
    document.getElementById('npp-db-body').innerHTML = html`
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:8px;">
                <h3 class="npp-font-bold">👥 Bảng kê công nợ theo NPP <span class="npp-text-sm npp-text-muted">(${rows.length} NPP)</span></h3>
                <div class="npp-flex npp-flex-wrap" style="gap:8px;">
                    <input id="db-search" class="npp-cn-input" placeholder="Tìm NPP / tỉnh..." value="${escapeHtml(_q)}">
                    <button id="db-bulk-pdf" type="button" class="npp-cn-btn">📄 Xuất biên bản (tất cả)</button>
                </div>
            </div>
            <div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th>Tỉnh</th><th class="npp-text-end">Công nợ</th><th class="npp-text-end">Quá hạn</th><th>Trạng thái</th><th class="npp-text-end">% hạn mức</th><th></th></tr></thead>
                <tbody id="db-tbody">${tbodyHtml(filtered())}</tbody>
            </table></div>
            <p class="npp-text-sm npp-text-muted npp-mt-2">Bấm 1 dòng để mở chi tiết NPP · 💬 nhắc nợ Zalo · 📄 biên bản đối chiếu · 📒 sổ công nợ.
                Cột <strong>Quá hạn</strong> đếm từ hạn hóa đơn; cột <strong>Trạng thái</strong> đếm từ ngày 10 (chính sách thưởng).</p>
        </div>`;
    const search = document.getElementById('db-search');
    search.addEventListener('input', debounce(() => {
        _q = search.value || '';
        document.getElementById('db-tbody').innerHTML = tbodyHtml(filtered());
    }, 200));
    document.getElementById('db-bulk-pdf').addEventListener('click', () => pdfModal(null));
    const body = document.getElementById('npp-db-body');
    body.addEventListener('click', (e) => {
        const btn = e.target.closest('.db-zalo,.db-pdf,.db-ledger');
        if (btn) {
            e.stopPropagation();
            const c = btn.dataset.c;
            if (btn.classList.contains('db-zalo')) return zaloModal(c);
            if (btn.classList.contains('db-pdf')) return pdfModal(c);
            return ledgerModal(c);
        }
        const tr = e.target.closest('[data-customer]');
        if (tr && !e.target.closest('a')) location.hash = '#/ql-npp?c=' + encodeURIComponent(tr.dataset.customer);
    });
}

// ─── Modal A: nhắc nợ Zalo ────────────────────────────────────────────────
function zaloModal(customer) {
    const r = (_d.rows || []).find((x) => x.customer === customer);
    if (!r) return;
    const sch = _d.schedule || {};
    const rm = (_d.policy || {}).reward_month || '';
    const L = [`Kính gửi Quý khách ${r.customer_name},`, '',
        'Công ty Cổ phần Hoàng Giang xin thông báo công nợ hiện tại:',
        `• Tổng công nợ: ${formatCurrency(r.debt)}`];
    if (r.overdue > 0) L.push(`• Nợ quá hạn: ${formatCurrency(r.overdue)} (quá ${r.days_overdue} ngày)`);
    else L.push('• Các khoản đang trong hạn thanh toán.');
    if (sch.cutoff) L.push(`• Kỳ thu hiện tại: chốt ngày ${formatDate(sch.cutoff)} · hạn thanh toán ${formatDate(sch.window_end)}.`);
    if (r.days_late > 0 && rm) L.push(`• Lưu ý: thanh toán trễ sẽ ảnh hưởng thưởng 2% doanh số tháng ${rm}.`);
    L.push('', 'Kính mong Quý khách sắp xếp thanh toán đúng hạn. Trân trọng cảm ơn!', '— Phòng Kế toán, Công ty Cổ phần Hoàng Giang');
    const msg = L.join('\n');
    showModal({
        title: '💬 Tin nhắn nhắc nợ — ' + escapeHtml(r.customer_name),
        body: html`
            <textarea id="db-zalo-msg" class="npp-textarea" style="min-height:220px;">${escapeHtml(msg)}</textarea>
            <div class="npp-flex npp-flex-wrap" style="gap:8px;margin-top:10px;">
                <button id="db-zalo-copy" type="button" class="npp-btn-primary" style="flex:2;min-width:140px;padding:10px;">📋 Sao chép</button>
                <button id="db-zalo-close" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:10px;">Đóng</button>
            </div>`,
    });
    document.getElementById('db-zalo-close').addEventListener('click', closeModal);
    document.getElementById('db-zalo-copy').addEventListener('click', async () => {
        const text = document.getElementById('db-zalo-msg').value;
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
        } catch { ok = false; }
        if (!ok) {
            const ta = document.getElementById('db-zalo-msg');
            ta.focus(); ta.select();
            try { ok = document.execCommand('copy'); } catch { ok = false; }
        }
        showToast(ok ? 'Đã sao chép tin nhắn' : 'Không sao chép được — hãy copy thủ công', ok ? 'success' : 'warning');
    });
}

// ─── Modal B: biên bản đối chiếu (PDF) ────────────────────────────────────
function pdfModal(customer) {
    const rows = filtered();
    const one = customer ? (_d.rows || []).find((x) => x.customer === customer) : null;
    const y = new Date().getFullYear();
    showModal({
        title: '📄 Xuất biên bản đối chiếu công nợ',
        body: html`
            <p>${one ? `NPP: <strong>${escapeHtml(one.customer_name)}</strong>` : `<strong>${rows.length} NPP</strong> trong danh sách hiện tại (mỗi NPP 1 trang)`}</p>
            <div class="npp-grid-2 npp-mt-2">
                <div><label class="npp-cn-flabel">Từ ngày</label><input type="date" id="db-from" class="npp-cn-input" style="width:100%;" value="${y}-01-01"></div>
                <div><label class="npp-cn-flabel">Đến ngày</label><input type="date" id="db-to" class="npp-cn-input" style="width:100%;" value="${todayISO()}" max="${todayISO()}"></div>
            </div>
            <div class="npp-flex npp-flex-wrap" style="gap:8px;margin-top:12px;">
                <button id="db-pdf-go" type="button" class="npp-btn-primary" style="flex:2;min-width:140px;padding:10px;">Tải PDF</button>
                <button id="db-pdf-cancel" type="button" class="npp-cn-btn" style="flex:1;min-width:90px;padding:10px;">Hủy</button>
            </div>`,
    });
    document.getElementById('db-pdf-cancel').addEventListener('click', closeModal);
    document.getElementById('db-pdf-go').addEventListener('click', async () => {
        const from_date = document.getElementById('db-from').value;
        const to_date = document.getElementById('db-to').value;
        if (from_date && to_date && from_date > to_date) return showToast('"Từ ngày" phải trước "Đến ngày"', 'warning');
        const btn = document.getElementById('db-pdf-go');
        btn.disabled = true; btn.textContent = '⏳ Đang tạo PDF…';
        try {
            if (one) await api.downloadPost('npp.api.recon.export_reconciliation', { customer, from_date, to_date });
            else await api.downloadPost('npp.api.recon.export_reconciliation_bulk',
                { customers: rows.map((x) => x.customer), from_date, to_date });
            closeModal();
            showToast('Đã tải biên bản đối chiếu', 'success');
        } catch (err) {
            showToast('Lỗi: ' + ((err && err.message) || ''), 'error');
            btn.disabled = false; btn.textContent = 'Tải PDF';
        }
    });
}

// ─── Modal C: sổ công nợ ──────────────────────────────────────────────────
async function ledgerModal(customer) {
    showModal({ title: 'Đang tải sổ công nợ…', body: '<div class="npp-skeleton" style="height:260px;"></div>' });
    try {
        const d = await api.call('npp.api.manager.debt_ledger', { customer });
        const rows = d.rows || [], drafts = d.drafts || [];
        showModal({
            title: '📒 Sổ công nợ — ' + escapeHtml(d.customer_name || customer),
            body: html`
                <div class="npp-kpi-grid">
                    <div class="npp-kpi-card"><div class="npp-kpi-label">Dư đầu kỳ</div><div class="npp-kpi-value" style="font-size:1.1rem;">${formatVNDShort(d.opening || 0)}</div></div>
                    <div class="npp-kpi-card"><div class="npp-kpi-label">Phát sinh nợ</div><div class="npp-kpi-value" style="font-size:1.1rem;">${formatVNDShort(d.total_debit || 0)}</div></div>
                    <div class="npp-kpi-card"><div class="npp-kpi-label">Đã thanh toán</div><div class="npp-kpi-value" style="font-size:1.1rem;color:var(--npp-success);">${formatVNDShort(d.total_credit || 0)}</div></div>
                    <div class="npp-kpi-card"><div class="npp-kpi-label">Dư cuối kỳ</div><div class="npp-kpi-value danger" style="font-size:1.1rem;">${formatVNDShort(d.closing || 0)}</div></div>
                </div>
                <div style="overflow-x:auto;margin-top:12px;"><table class="npp-table">
                    <thead><tr><th>Ngày</th><th>Chứng từ</th><th class="npp-text-end">Nợ</th><th class="npp-text-end">Có</th><th class="npp-text-end">Lũy kế</th><th>Việc cần làm</th></tr></thead>
                    <tbody>${rows.map((r) => `<tr>
                        <td data-label="Ngày" class="npp-text-sm">${formatDate(r.posting_date)}</td>
                        <td data-label="Chứng từ"><strong>${escapeHtml(r.voucher_no)}</strong><div class="npp-text-sm npp-text-muted">${escapeHtml(r.voucher_type)}</div></td>
                        <td data-label="Nợ" class="npp-text-end">${r.debit ? formatCurrency(r.debit) : ''}</td>
                        <td data-label="Có" class="npp-text-end" style="color:var(--npp-success);">${r.credit ? formatCurrency(r.credit) : ''}</td>
                        <td data-label="Lũy kế" class="npp-text-end"><strong>${formatCurrency(r.balance)}</strong></td>
                        <td data-label="Việc cần làm">${todoChips(r.todos)}</td>
                    </tr>`).join('') || '<tr><td colspan="6" class="npp-text-center npp-text-muted">Không có giao dịch</td></tr>'}</tbody>
                </table></div>
                ${drafts.length ? `<h4 class="npp-font-bold npp-mt-3">⏳ Chứng từ nháp đang treo (không tính vào số dư)</h4>
                    <div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                        <thead><tr><th>Ngày</th><th>Chứng từ</th><th class="npp-text-end">Giá trị</th><th>Trạng thái</th></tr></thead>
                        <tbody>${drafts.map((r) => `<tr>
                            <td data-label="Ngày" class="npp-text-sm">${formatDate(r.posting_date)}</td>
                            <td data-label="Chứng từ"><strong>${escapeHtml(r.voucher_no)}</strong><div class="npp-text-sm npp-text-muted">${escapeHtml(r.voucher_type)}</div></td>
                            <td data-label="Giá trị" class="npp-text-end">${formatCurrency(r.credit)}</td>
                            <td data-label="Trạng thái">${todoChips(r.todos)}</td>
                        </tr>`).join('')}</tbody></table></div>` : ''}`,
        });
    } catch (err) {
        showModal({ title: '⚠️ Lỗi', body: `<div class="npp-text-muted">${escapeHtml((err && err.message) || '')}</div>` });
    }
}
