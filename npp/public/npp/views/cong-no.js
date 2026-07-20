import { html } from '../lib/dom.js';
import { formatCurrency, formatDate, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { emptyState } from '../components/empty-state.js';
import { showModal } from '../components/modal.js';

let _data = null;     // payload ledger_detail
let _ledger = [];     // toàn bộ GL entries (lọc client-side)

function isoOffset(months) {
    const d = new Date();
    if (months) d.setMonth(d.getMonth() + months);
    return d.toISOString().split('T')[0];
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Công nợ chi tiết', subtitle: 'Sổ công nợ, lịch thanh toán & chi tiết giao dịch' })}
        <div id="npp-cn-policy"></div>
        <div class="npp-cn-summary" id="npp-cn-summary">
            ${'<div class="npp-skeleton" style="height:120px;"></div>'.repeat(3)}
        </div>
        <div id="npp-cn-tet" class="npp-mt-3"></div>
        <div class="npp-card npp-mt-3">
            <h3 class="npp-font-bold">📅 Lịch thanh toán</h3>
            <p class="npp-text-sm npp-text-muted">Chốt đơn ngày 5 · Hạn thanh toán ngày 10 hàng tháng (HĐ đến hạn 30 ngày).</p>
            <div class="npp-cn-sched npp-mt-2" id="npp-cn-sched">
                <div class="npp-skeleton" style="height:120px;"></div><div class="npp-skeleton" style="height:120px;"></div>
            </div>
        </div>
        <div class="npp-card npp-mt-3">
            <div class="npp-ql-filters">
                <div><label class="npp-cn-flabel">Từ ngày</label><input type="date" id="npp-cn-from" class="npp-cn-input"></div>
                <div><label class="npp-cn-flabel">Đến ngày</label><input type="date" id="npp-cn-to" class="npp-cn-input"></div>
                <div><label class="npp-cn-flabel">Loại chứng từ</label>
                    <select id="npp-cn-type" class="npp-cn-input">
                        <option value="">Tất cả loại</option>
                        <option value="Sales Invoice">Hóa đơn bán hàng</option>
                        <option value="Payment Entry">Thanh toán</option>
                        <option value="Journal Entry">Bút toán</option>
                    </select>
                </div>
                <div class="npp-flex" style="gap:8px;align-items:flex-end;">
                    <button id="npp-cn-reset" class="npp-cn-btn" type="button">Đặt lại</button>
                    <button id="npp-cn-export" class="npp-cn-btn" type="button">⬇ Xuất CSV</button>
                </div>
            </div>
        </div>
        <div class="npp-card npp-mt-3">
            <h3 class="npp-font-bold">Chi tiết giao dịch</h3>
            <div id="npp-cn-table" class="npp-mt-2"><div class="npp-skeleton" style="height:240px;"></div></div>
        </div>
    `;

    document.getElementById('npp-cn-from').value = isoOffset(-3);
    document.getElementById('npp-cn-to').value = isoOffset(0);
    ['npp-cn-from', 'npp-cn-to', 'npp-cn-type'].forEach((id) =>
        document.getElementById(id).addEventListener('input', applyFilter));
    document.getElementById('npp-cn-reset').addEventListener('click', () => {
        document.getElementById('npp-cn-from').value = isoOffset(-3);
        document.getElementById('npp-cn-to').value = isoOffset(0);
        document.getElementById('npp-cn-type').value = '';
        applyFilter();
    });
    document.getElementById('npp-cn-export').addEventListener('click', exportCSV);

    try {
        _data = await api.call('npp.api.outstanding.ledger_detail');
        _ledger = _data.ledger || [];
        renderPolicy(_data);
        renderSummary(_data);
        renderTet(_data.tet || {});
        renderSchedule(_data.schedule || {});
        applyFilter();
    } catch (err) {
        document.getElementById('npp-cn-summary').innerHTML =
            `<div class="npp-empty" style="grid-column:1/-1;"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
        document.getElementById('npp-cn-table').innerHTML = '';
    }
}

// ─── Banner chính sách ────────────────────────────────────────────────────
function renderPolicy(d) {
    const root = document.getElementById('npp-cn-policy');
    const p = d.policy || {};
    const txt = d.policy_text || {};
    const LV = {
        ok:       ['normal', '✅', 'Thanh toán đúng hạn'],
        grace:    ['normal', '⏳', p.label || 'Trong ân hạn'],
        warn:     ['tet',    '🟠', p.label || 'Trễ hạn — phạt 50% thưởng'],
        critical: ['tet',    '🔴', p.label || 'Trễ hạn — cắt thưởng'],
    };
    const lv = LV[p.level] || LV.ok;
    let rewardLine = '';
    if (p.reward_full) {
        rewardLine = (p.reward_factor >= 1)
            ? `<p class="npp-text-sm" style="margin-top:4px;">Thưởng 2% tháng này: <strong style="color:var(--npp-success);">${formatCurrency(p.reward_full)}</strong> (giữ nguyên nếu thanh toán đúng hạn).</p>`
            : `<p class="npp-text-sm" style="margin-top:4px;">Thưởng 2% tháng này: <strong>${formatCurrency(p.reward_full)}</strong> → còn <strong style="color:${p.reward_factor > 0 ? 'var(--npp-warning)' : 'var(--npp-danger)'};">${formatCurrency(p.reward_effective)}</strong> (${p.reward_factor > 0 ? 'phạt 50%' : 'bị cắt'}).</p>`;
    }
    let h = html`<div class="npp-policy-card ${lv[0]}"><div class="npp-policy-icon">${lv[1]}</div>
        <div>
            <h4>${escapeHtml(txt.title || 'Chính sách thanh toán')} · ${escapeHtml(lv[2])}</h4>
            <p>${(txt.lines || ['Thanh toán trong cửa sổ ngày 5–10 hàng tháng cho hoá đơn đến hạn 30 ngày.']).map(escapeHtml).join(' ')}</p>
            ${rewardLine}
        </div></div>`;
    if (d.tet && d.tet.active) {
        h += html`<div class="npp-policy-card tet npp-mt-2"><div class="npp-policy-icon">🧧</div>
            <div><h4>Chính sách Tết ${d.tet.year}</h4><p>Đơn hàng từ <strong>01/11/${d.tet.year}</strong> được nợ tối đa <strong>50%</strong> tổng giá trị; phần vượt phải thanh toán.</p></div></div>`;
    }
    root.innerHTML = h;
}

// ─── 3 thẻ tóm tắt ────────────────────────────────────────────────────────
function renderSummary(d) {
    const s = d.summary || {};
    document.getElementById('npp-cn-summary').innerHTML = html`
        <div class="npp-cn-card balance">
            <div class="npp-cn-card-label">💰 Công nợ hiện tại</div>
            <div class="npp-cn-card-value">${formatCurrency(d.current_balance || 0)}</div>
            <div class="npp-cn-card-sub">${d.transaction_count || 0} giao dịch</div>
        </div>
        <div class="npp-cn-card due" id="npp-cn-card-due" role="button" tabindex="0">
            <div class="npp-cn-card-label">✅ HĐ trong hạn thanh toán</div>
            <div class="npp-cn-card-value">${formatCurrency(s.in_term_amount || 0)}</div>
            <div class="npp-cn-card-sub">${s.in_term_count || 0} hóa đơn · Xem chi tiết →</div>
        </div>
        <div class="npp-cn-card overdue" id="npp-cn-card-need" role="button" tabindex="0">
            <div class="npp-cn-card-label">🚨 HĐ cần thanh toán</div>
            <div class="npp-cn-card-value">${formatCurrency(s.need_to_pay_amount || 0)}</div>
            <div class="npp-cn-card-sub">${s.need_to_pay_count || 0} hóa đơn · Xem chi tiết →</div>
        </div>
    `;
    document.getElementById('npp-cn-card-due').addEventListener('click', () =>
        invoiceListModal('✅ Hóa đơn trong hạn thanh toán', s.in_term_invoices || [], s.in_term_amount || 0, 'var(--npp-success)'));
    document.getElementById('npp-cn-card-need').addEventListener('click', () =>
        invoiceListModal('🚨 Hóa đơn cần thanh toán', s.need_to_pay_invoices || [], s.need_to_pay_amount || 0, 'var(--npp-warning)'));
}

// ─── Thẻ Tết ──────────────────────────────────────────────────────────────
function renderTet(tet) {
    const root = document.getElementById('npp-cn-tet');
    if (!tet.active) { root.innerHTML = ''; return; }
    root.innerHTML = html`
        <div class="npp-cn-tet-card" id="npp-cn-tet-card" role="button" tabindex="0">
            <div class="npp-flex npp-items-center" style="gap:10px;">
                <span style="font-size:1.6rem;">🧧</span>
                <div><strong style="color:#991b1b;">Chính sách Tết ${tet.year}</strong>
                    <div class="npp-text-sm" style="color:#b91c1c;">Thanh toán 50% đơn hàng từ 01/11/${tet.year}</div></div>
            </div>
            <div class="npp-cn-tet-stats npp-mt-3">
                <div><div class="npp-cn-tet-l">Đơn hàng Tết</div><div class="npp-cn-tet-v">${tet.count} đơn</div></div>
                <div><div class="npp-cn-tet-l">Tổng giá trị HĐ</div><div class="npp-cn-tet-v">${formatCurrency(tet.total_amount)}</div></div>
                <div class="hl"><div class="npp-cn-tet-l">Cần thanh toán thêm</div><div class="npp-cn-tet-v">${formatCurrency(tet.payment50)}</div></div>
            </div>
            <div class="npp-text-sm npp-mt-2" style="text-align:right;color:#dc2626;font-weight:600;">Xem chi tiết →</div>
        </div>
    `;
    document.getElementById('npp-cn-tet-card').addEventListener('click', () => tetModal(tet));
}

function tetModal(tet) {
    const note = tet.payment50 > 0
        ? `<div class="npp-policy-card" style="border-left-color:var(--npp-warning);margin-top:0;"><div class="npp-policy-icon">🧮</div><div><p>Công thức: ${formatCurrency(tet.current_balance)} − 50% × ${formatCurrency(tet.total_amount)} = <strong>${formatCurrency(tet.payment50)}</strong></p></div></div>`
        : `<div class="npp-policy-card" style="border-left-color:var(--npp-success);margin-top:0;"><div class="npp-policy-icon">✅</div><div><p>Công nợ hiện tại (${formatCurrency(tet.current_balance)}) ≤ 50% tổng HĐ Tết (${formatCurrency(tet.half)}). Không cần thanh toán thêm.</p></div></div>`;
    const body = html`
        ${note}
        <div class="npp-kpi-grid npp-mt-3">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Số đơn Tết</div><div class="npp-kpi-value">${tet.count}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng giá trị HĐ</div><div class="npp-kpi-value">${formatCurrency(tet.total_amount)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Công nợ hiện tại</div><div class="npp-kpi-value">${formatCurrency(tet.current_balance)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Cần thanh toán thêm</div><div class="npp-kpi-value warning">${formatCurrency(tet.payment50)}</div></div>
        </div>
        <div class="npp-text-sm npp-text-muted npp-mt-3">Hóa đơn Tết (${tet.count}):</div>
        <div class="npp-mt-2">${(tet.invoices || []).map(invoiceRow).join('') || emptyState({ icon: '✅', title: 'Không có' })}</div>
    `;
    showModal({ title: `🧧 Chính sách Tết ${tet.year}`, body });
    bindInvoiceRows();
}

// ─── Lịch thanh toán ──────────────────────────────────────────────────────
function renderSchedule(sch) {
    const c1 = sch.this_cycle || { total: 0, invoices: [], chot_date: null, due_date: null };
    const c2 = sch.next_cycle || { total: 0, invoices: [], chot_date: null, due_date: null };
    const card = (c, id, cls, label) => `
        <div class="npp-cn-sch-card ${cls}" id="${id}" role="button" tabindex="0">
            <div class="npp-flex npp-items-center" style="gap:10px;"><div class="npp-cn-sch-day">10</div>
                <div><div class="npp-cn-sch-date">Hạn TT: ${c.due_date ? formatDate(c.due_date) : '—'}</div>
                    <div class="npp-text-sm" style="opacity:.75;">${label} · chốt ${c.chot_date ? formatDate(c.chot_date) : '—'}</div></div></div>
            <div class="npp-cn-sch-amt npp-mt-2">${formatCurrency(c.total)}</div>
            <div class="npp-text-sm">${(c.invoices || []).length} hóa đơn · Xem chi tiết →</div>
        </div>`;
    document.getElementById('npp-cn-sched').innerHTML = html`
        ${card(c1, 'npp-cn-sch1', 'day5', 'Kỳ này')}
        ${card(c2, 'npp-cn-sch2', 'day20', 'Kỳ sau')}
    `;
    document.getElementById('npp-cn-sch1').addEventListener('click', () =>
        invoiceListModal(`📅 Kỳ này — hạn TT ${c1.due_date ? formatDate(c1.due_date) : ''}`, c1.invoices || [], c1.total, 'var(--npp-warning)'));
    document.getElementById('npp-cn-sch2').addEventListener('click', () =>
        invoiceListModal(`📅 Kỳ sau — hạn TT ${c2.due_date ? formatDate(c2.due_date) : ''}`, c2.invoices || [], c2.total, 'var(--npp-primary, #3b82f6)'));
}

// ─── Modal: danh sách hóa đơn ─────────────────────────────────────────────
function invoiceRow(inv) {
    const diff = inv.days_diff;
    const txt = diff < 0 ? `Quá hạn ${Math.abs(diff)} ngày` : (diff === 0 ? 'Hôm nay' : `Còn ${diff} ngày`);
    const color = diff < 0 ? 'var(--npp-danger)' : (diff === 0 ? 'var(--npp-warning)' : 'var(--npp-success)');
    return `<div class="npp-cn-invrow" data-name="${escapeHtml(inv.name)}">
        <div><strong style="color:var(--npp-primary, #3b82f6);">${escapeHtml(inv.name)}</strong>
            <div class="npp-text-sm npp-text-muted">HĐ ${formatDate(inv.posting_date)} · Hạn ${formatDate(inv.due_date)}</div></div>
        <div style="text-align:right;"><strong>${formatCurrency(inv.outstanding_amount)}</strong>
            <div class="npp-text-sm" style="color:${color};">${txt}</div></div>
    </div>`;
}

function bindInvoiceRows() {
    document.querySelectorAll('#npp-modal-mount .npp-cn-invrow').forEach((el) =>
        el.addEventListener('click', () => showVoucher('Sales Invoice', el.dataset.name)));
}

function invoiceListModal(title, invoices, total, color) {
    const body = html`
        <div class="npp-card" style="margin-top:0;"><div class="npp-flex npp-justify-between">
            <span>Tổng cộng (${invoices.length} hóa đơn)</span>
            <strong style="font-size:1.15rem;color:${color};">${formatCurrency(total)}</strong></div></div>
        <div class="npp-mt-3">${invoices.map(invoiceRow).join('') || emptyState({ icon: '✅', title: 'Không có hóa đơn' })}</div>
    `;
    showModal({ title, body });
    bindInvoiceRows();
}

// ─── Bộ lọc + bảng giao dịch ──────────────────────────────────────────────
function applyFilter() {
    const from = document.getElementById('npp-cn-from')?.value || '';
    const to = document.getElementById('npp-cn-to')?.value || '';
    const type = document.getElementById('npp-cn-type')?.value || '';
    const rows = _ledger.filter((e) =>
        (!from || e.posting_date >= from) && (!to || e.posting_date <= to) && (!type || e.voucher_type === type));
    renderTable(rows);
}

function vBadge(t) {
    const m = { 'Sales Invoice': ['primary', '🧾 Hóa đơn'], 'Payment Entry': ['success', '💳 Thanh toán'], 'Journal Entry': ['warning', '📝 Bút toán'] };
    const [c, l] = m[t] || ['muted', t || '—'];
    return `<span class="npp-badge npp-badge-${c}">${l}</span>`;
}

function renderTable(rows) {
    const wrap = document.getElementById('npp-cn-table');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = emptyState({ icon: '📭', title: 'Không có giao dịch', message: 'Thử mở rộng khoảng ngày.' }); return; }
    wrap.innerHTML = `<div style="overflow-x:auto;"><table class="npp-table">
        <thead><tr><th>Ngày</th><th>Loại</th><th>Số CT</th><th>Tài khoản</th><th class="npp-text-end">Nợ</th><th class="npp-text-end">Có</th><th class="npp-text-end">Số dư</th><th>Ghi chú</th></tr></thead>
        <tbody>${rows.map((e) => `<tr class="npp-cn-row" data-vt="${escapeHtml(e.voucher_type)}" data-vn="${escapeHtml(e.voucher_no)}" style="cursor:pointer;">
            <td data-label="Ngày" style="white-space:nowrap;">${formatDate(e.posting_date)}</td>
            <td data-label="Loại">${vBadge(e.voucher_type)}</td>
            <td data-label="Số CT"><span style="color:var(--npp-primary, #3b82f6);font-weight:600;">${escapeHtml(e.voucher_no)}</span></td>
            <td data-label="Tài khoản">${escapeHtml((e.account || '').split(' - ')[0] || '—')}</td>
            <td data-label="Nợ" class="npp-text-end" style="${e.debit > 0 ? 'color:var(--npp-danger);font-weight:700;' : ''}">${e.debit > 0 ? formatCurrency(e.debit) : '—'}</td>
            <td data-label="Có" class="npp-text-end" style="${e.credit > 0 ? 'color:var(--npp-success);font-weight:700;' : ''}">${e.credit > 0 ? formatCurrency(e.credit) : '—'}</td>
            <td data-label="Số dư" class="npp-text-end"><strong>${formatCurrency(e.running_balance)}</strong></td>
            <td data-label="Ghi chú" class="npp-text-sm npp-text-muted" style="max-width:220px;">${escapeHtml(e.remarks || '—')}</td>
        </tr>`).join('')}</tbody></table></div>
        <div class="npp-text-sm npp-text-muted npp-mt-2">Hiển thị ${rows.length} giao dịch</div>`;
    wrap.querySelectorAll('.npp-cn-row').forEach((tr) => tr.addEventListener('click', () => showVoucher(tr.dataset.vt, tr.dataset.vn)));
}

// ─── Modal chi tiết chứng từ ──────────────────────────────────────────────
async function showVoucher(vt, vn) {
    showModal({ title: `📄 ${escapeHtml(vn)}`, body: '<div class="npp-skeleton" style="height:220px;"></div>' });
    try {
        const d = await api.call('npp.api.outstanding.voucher_detail', { voucher_type: vt, voucher_no: vn });
        if (d.voucher_type === 'Sales Invoice') invoiceModal(d);
        else if (d.voucher_type === 'Payment Entry') paymentModal(d);
        else genericModal(d);
    } catch (err) {
        showModal({ title: '⚠️ Lỗi', body: `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>` });
    }
}

function attHtml(atts) {
    if (!atts || !atts.length) return '<div class="npp-text-muted npp-text-sm">Không có file đính kèm</div>';
    const base = window.NPP_CONTEXT?.baseUrl || '';
    return `<div class="npp-flex npp-flex-wrap" style="gap:8px;">${atts.map((a) => {
        let url = a.file_url || '';
        if (url && !/^https?:/i.test(url)) url = base + url;
        const name = a.file_name || url.split('/').pop();
        const isImg = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name || '');
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="npp-badge npp-badge-muted" style="text-decoration:none;">${isImg ? '🖼️' : '📎'} ${escapeHtml(name)}</a>`;
    }).join('')}</div>`;
}

function invoiceModal(d) {
    const inv = d.invoice || {};
    const items = d.items || [];
    const itemsHtml = items.length ? `<div style="overflow-x:auto;"><table class="npp-table">
        <thead><tr><th>Sản phẩm</th><th class="npp-text-center">SL</th><th class="npp-text-end">Đơn giá</th><th class="npp-text-end">Thành tiền</th></tr></thead>
        <tbody>${items.map((it) => `<tr><td data-label="SP">${escapeHtml(it.item_name || it.item_code)}</td><td data-label="SL" class="npp-text-center">${it.qty} ${escapeHtml(it.uom || '')}</td><td data-label="Đơn giá" class="npp-text-end">${formatCurrency(it.rate)}</td><td data-label="TT" class="npp-text-end">${formatCurrency(it.amount)}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="npp-text-muted npp-text-sm">Không có dòng hàng</div>';
    const taxHtml = (d.taxes || []).map((t) => `<div class="npp-flex npp-justify-between npp-text-sm" style="padding:4px 0;"><span>${escapeHtml((t.description || t.account_head || 'Thuế').replace(/\s*-?\s*\d+(\.\d+)?%/g, '').trim())}</span><span>${formatCurrency(t.tax_amount)}</span></div>`).join('');
    const body = html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Ngày HĐ</div><div class="npp-kpi-value" style="font-size:1rem;">${formatDate(inv.posting_date)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Hạn TT</div><div class="npp-kpi-value" style="font-size:1rem;">${inv.due_date ? formatDate(inv.due_date) : '—'}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Trạng thái</div><div class="npp-kpi-value" style="font-size:1rem;">${escapeHtml(inv.status || '—')}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Còn nợ</div><div class="npp-kpi-value danger" style="font-size:1rem;">${formatCurrency(inv.outstanding_amount)}</div></div>
        </div>
        <h4 class="npp-font-bold npp-mt-3">Chi tiết sản phẩm</h4><div class="npp-mt-2">${itemsHtml}</div>
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-text-sm" style="padding:4px 0;"><span>Tổng tiền hàng</span><span>${formatCurrency(inv.net_total)}</span></div>
            ${taxHtml}
            ${inv.discount_amount > 0 ? `<div class="npp-flex npp-justify-between npp-text-sm" style="padding:4px 0;"><span>Chiết khấu</span><span style="color:var(--npp-success);">-${formatCurrency(inv.discount_amount)}</span></div>` : ''}
            <div class="npp-flex npp-justify-between" style="padding-top:8px;margin-top:6px;border-top:1px solid var(--npp-border);"><strong>Tổng cộng</strong><strong style="color:var(--npp-primary, #3b82f6);font-size:1.15rem;">${formatCurrency(inv.grand_total)}</strong></div>
        </div>
        <h4 class="npp-font-bold npp-mt-3">File đính kèm (${(d.attachments || []).length})</h4><div class="npp-mt-2">${attHtml(d.attachments)}</div>
    `;
    showModal({ title: `🧾 ${escapeHtml(inv.name || '')}`, body });
}

function glRows(gl) {
    if (!gl || !gl.length) return '<div class="npp-text-muted npp-text-sm">Không có giao dịch kế toán</div>';
    return `<div style="overflow-x:auto;"><table class="npp-table"><thead><tr><th>Ngày</th><th>Tài khoản</th><th class="npp-text-end">Nợ</th><th class="npp-text-end">Có</th></tr></thead>
        <tbody>${gl.map((g) => `<tr><td data-label="Ngày">${formatDate(g.posting_date)}</td><td data-label="TK">${escapeHtml((g.account || '').split(' - ')[0] || '—')}</td><td data-label="Nợ" class="npp-text-end">${g.debit > 0 ? formatCurrency(g.debit) : '—'}</td><td data-label="Có" class="npp-text-end">${g.credit > 0 ? formatCurrency(g.credit) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}

function paymentModal(d) {
    const p = d.payment || {};
    const refs = (d.references || []).map((r) => `<div class="npp-cn-invrow" data-name="${escapeHtml(r.reference_name)}" data-dt="${escapeHtml(r.reference_doctype)}">
        <div><strong style="color:var(--npp-primary, #3b82f6);">${escapeHtml(r.reference_name)}</strong><div class="npp-text-sm npp-text-muted">${escapeHtml(r.reference_doctype)}</div></div>
        <strong>${formatCurrency(r.allocated_amount)}</strong></div>`).join('') || '<div class="npp-text-muted npp-text-sm">Không có hóa đơn liên quan</div>';
    const body = html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Ngày</div><div class="npp-kpi-value" style="font-size:1rem;">${formatDate(p.posting_date)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Số tiền</div><div class="npp-kpi-value" style="color:var(--npp-success);font-size:1rem;">${formatCurrency(p.paid_amount)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tham chiếu</div><div class="npp-kpi-value" style="font-size:1rem;">${escapeHtml(p.reference_no || '—')}</div></div>
        </div>
        <h4 class="npp-font-bold npp-mt-3">Hóa đơn liên quan</h4><div class="npp-mt-2">${refs}</div>
        <h4 class="npp-font-bold npp-mt-3">Giao dịch kế toán</h4><div class="npp-mt-2">${glRows(d.gl)}</div>
    `;
    showModal({ title: `💳 ${escapeHtml(p.name || '')}`, body });
    document.querySelectorAll('#npp-modal-mount .npp-cn-invrow').forEach((el) =>
        el.addEventListener('click', () => showVoucher(el.dataset.dt || 'Sales Invoice', el.dataset.name)));
}

function genericModal(d) {
    showModal({
        title: `📝 ${escapeHtml(d.voucher_type)} ${escapeHtml(d.voucher_no || '')}`,
        body: html`<h4 class="npp-font-bold">Giao dịch kế toán</h4><div class="npp-mt-2">${glRows(d.gl)}</div>`,
    });
}

// ─── Xuất CSV ─────────────────────────────────────────────────────────────
function exportCSV() {
    const from = document.getElementById('npp-cn-from')?.value || '';
    const to = document.getElementById('npp-cn-to')?.value || '';
    const type = document.getElementById('npp-cn-type')?.value || '';
    const rows = _ledger.filter((e) =>
        (!from || e.posting_date >= from) && (!to || e.posting_date <= to) && (!type || e.voucher_type === type));
    if (!rows.length) return;
    let csv = '﻿Ngày,Loại,Số CT,Tài khoản,Nợ,Có,Số dư,Ghi chú\n';
    rows.forEach((e) => {
        csv += [e.posting_date, e.voucher_type, e.voucher_no, `"${(e.account || '').replace(/"/g, '""')}"`,
            e.debit || 0, e.credit || 0, e.running_balance || 0, `"${(e.remarks || '').replace(/"/g, '""')}"`].join(',') + '\n';
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `cong_no_${isoOffset(0)}.csv`;
    a.click();
}
