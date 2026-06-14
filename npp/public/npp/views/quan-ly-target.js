import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';
import { showToast } from '../components/toast.js';

let _months = 1;
let _pace = 0;   // % tiến độ kỳ vọng (số ngày đã qua / tổng số ngày kỳ)

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'],
                   ['#/ql-debt', 'db', '💰 Công nợ'], ['#/ql-tet', 'tet', '🧧 Tết']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

/** Tô màu % đạt theo nhịp kỳ vọng: ≥ nhịp = xanh, ≥80% nhịp = vàng, còn lại = đỏ. */
function attBadge(pct) {
    if (pct === null || pct === undefined) return '<span class="npp-text-muted">— chưa đặt</span>';
    const ref = _pace || 100;
    const color = pct >= ref ? 'var(--npp-success)' : (pct >= ref * 0.8 ? 'var(--npp-warning)' : 'var(--npp-danger)');
    return `<strong style="color:${color};">${pct.toFixed(0)}%</strong>`;
}

const BTN = 'padding:8px 14px;font-size:.85rem;border:none;border-radius:10px;font-weight:700;cursor:pointer;';

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Mục tiêu doanh số', subtitle: '% hoàn thành theo NPP' })}
        ${nav('tg')}
        <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:10px;">
            <h3 class="npp-font-bold">Mục tiêu vs Thực tế</h3>
            <select id="npp-tg-period" style="padding:8px 12px;border-radius:10px;border:1px solid var(--npp-border);background:var(--npp-surface);font-weight:600;color:var(--npp-text);">
                <option value="1" selected>Tháng này</option><option value="3">3 tháng</option><option value="6">6 tháng</option><option value="12">12 tháng</option>
            </select>
        </div>
        <div class="npp-kpi-grid" id="npp-tg-totals">
            <div class="npp-skeleton" style="height:90px;"></div><div class="npp-skeleton" style="height:90px;"></div><div class="npp-skeleton" style="height:90px;"></div>
        </div>
        <div class="npp-card npp-mt-3">
            <div class="npp-flex npp-justify-between npp-items-center npp-flex-wrap" style="gap:10px;">
                <p class="npp-text-sm npp-text-muted" style="margin:0;flex:1;min-width:220px;">Nhập <strong>mục tiêu doanh số/tháng</strong> cho từng NPP. % đạt = doanh số kỳ ÷ (mục tiêu tháng × số tháng), tô màu theo <strong>nhịp kỳ vọng</strong>.</p>
                <div class="npp-flex" style="gap:8px;">
                    <button id="npp-tg-fill" type="button" style="${BTN}background:var(--npp-surface-2);color:var(--npp-text);border:1px solid var(--npp-border);">✨ Điền gợi ý</button>
                    <button id="npp-tg-saveall" type="button" style="${BTN}background:var(--npp-season-grad);color:#fff;">💾 Lưu tất cả</button>
                </div>
            </div>
            <details class="npp-mt-2" style="font-size:.85rem;">
                <summary style="cursor:pointer;color:var(--npp-text-muted);">📋 Dán hàng loạt từ Excel/Sheets</summary>
                <p class="npp-text-sm npp-text-muted npp-mt-2" style="margin-bottom:6px;">Mỗi dòng: <code>Tên NPP (hoặc mã)</code> &lt;tab/phẩy&gt; <code>mục tiêu</code>. Bấm “Áp dụng” để điền vào bảng (chưa lưu), kiểm tra rồi “Lưu tất cả”.</p>
                <textarea id="npp-tg-paste" rows="4" placeholder="NPP Hà Nội	150000000&#10;NPP Hải Phòng, 90000000" style="width:100%;padding:8px;border:1px solid var(--npp-border);border-radius:8px;background:var(--npp-surface);color:var(--npp-text);font-family:monospace;font-size:.8rem;"></textarea>
                <button id="npp-tg-apply" type="button" class="npp-mt-2" style="${BTN}background:var(--npp-surface-2);color:var(--npp-text);border:1px solid var(--npp-border);">Áp dụng vào bảng</button>
            </details>
            <div id="npp-tg-table" class="npp-mt-3"><div class="npp-skeleton" style="height:240px;"></div></div>
        </div>
    `;
    document.getElementById('npp-tg-period').addEventListener('change', (e) => load(parseInt(e.target.value, 10) || 1));
    document.getElementById('npp-tg-fill').addEventListener('click', fillSuggestions);
    document.getElementById('npp-tg-saveall').addEventListener('click', saveAll);
    document.getElementById('npp-tg-apply').addEventListener('click', applyPaste);
    await load(1);
}

async function load(months) {
    _months = months;
    try {
        const d = await api.call('npp.api.manager.targets', { months });
        _pace = d.expected_pace_pct || 0;
        const t = d.totals || {};
        document.getElementById('npp-tg-totals').innerHTML = html`
            <div class="npp-kpi-card"><div class="npp-kpi-label">Tổng mục tiêu</div><div class="npp-kpi-value">${formatVNDShort(t.target || 0)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Doanh số thực</div><div class="npp-kpi-value">${formatVNDShort(t.revenue || 0)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">% hoàn thành</div><div class="npp-kpi-value">${t.attainment_pct === null || t.attainment_pct === undefined ? '—' : t.attainment_pct.toFixed(0) + '%'}</div><div class="npp-kpi-sub">Nhịp kỳ vọng ~${_pace.toFixed(0)}%</div></div>
        `;
        renderTable(d.rows || []);
    } catch (err) {
        document.getElementById('npp-tg-table').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderTable(rows) {
    const root = document.getElementById('npp-tg-table');
    root.innerHTML = html`
        <table class="npp-table">
            <thead><tr><th>NPP</th><th>Tỉnh</th><th>Mục tiêu/tháng</th><th>Gợi ý</th><th class="npp-text-end">Doanh số kỳ</th><th class="npp-text-end">% đạt</th></tr></thead>
            <tbody>
                ${rows.map((r) => html`<tr>
                    <td data-label="NPP"><strong>${escapeHtml(r.customer_name)}</strong></td>
                    <td data-label="Tỉnh">${escapeHtml(r.territory || '—')}</td>
                    <td data-label="Mục tiêu/tháng" style="white-space:nowrap;">
                        <input type="number" min="0" step="1000000" class="npp-tg-input" data-c="${escapeHtml(r.customer)}" data-name="${escapeHtml((r.customer_name || '').toLowerCase().trim())}" data-orig="${r.monthly_target || 0}" data-sug="${r.suggested || 0}" value="${r.monthly_target || 0}"
                               style="width:130px;padding:6px 8px;border:1px solid var(--npp-border);border-radius:8px;background:var(--npp-surface);color:var(--npp-text);">
                        <button class="npp-tg-save" data-c="${escapeHtml(r.customer)}" type="button" style="padding:6px 10px;font-size:.8rem;border:none;border-radius:8px;background:var(--npp-season-grad);color:#fff;font-weight:700;cursor:pointer;">Lưu</button>
                    </td>
                    <td data-label="Gợi ý" style="white-space:nowrap;">
                        ${r.suggested ? html`<span class="npp-text-muted">${formatVNDShort(r.suggested)}</span> <a href="javascript:void(0)" class="npp-tg-use npp-link npp-text-sm" data-c="${escapeHtml(r.customer)}">dùng</a>` : '<span class="npp-text-muted">—</span>'}
                    </td>
                    <td data-label="Doanh số" class="npp-text-end">${formatCurrency(r.revenue)}</td>
                    <td data-label="% đạt" class="npp-text-end">${attBadge(r.attainment_pct)}</td>
                </tr>`).join('') || '<tr><td colspan="6" class="npp-text-center npp-text-muted">Không có NPP</td></tr>'}
            </tbody>
        </table>
    `;
    root.querySelectorAll('.npp-tg-save').forEach((b) => b.addEventListener('click', () => saveTarget(b.dataset.c, root)));
    root.querySelectorAll('.npp-tg-use').forEach((b) => b.addEventListener('click', () => {
        const inp = root.querySelector(`.npp-tg-input[data-c="${CSS.escape(b.dataset.c)}"]`);
        if (inp) { inp.value = inp.dataset.sug || 0; inp.focus(); }
    }));
}

/** Điền gợi ý (TB 3 tháng × 1.1) vào MỌI ô chưa có mục tiêu (giá trị 0/trống). */
function fillSuggestions() {
    const inputs = document.querySelectorAll('#npp-tg-table .npp-tg-input');
    let n = 0;
    inputs.forEach((inp) => {
        const cur = parseFloat(inp.value) || 0;
        const sug = parseFloat(inp.dataset.sug) || 0;
        if (cur <= 0 && sug > 0) { inp.value = sug; n++; }
    });
    showToast(n ? `Đã điền gợi ý cho ${n} NPP — kiểm tra rồi “Lưu tất cả”` : 'Tất cả NPP đã có mục tiêu', n ? 'info' : 'success');
}

/** Lưu mọi ô có thay đổi so với giá trị đã tải (set_targets_bulk). */
async function saveAll() {
    const inputs = document.querySelectorAll('#npp-tg-table .npp-tg-input');
    const changed = [];
    inputs.forEach((inp) => {
        const cur = parseFloat(inp.value) || 0;
        const orig = parseFloat(inp.dataset.orig) || 0;
        if (cur !== orig) changed.push({ customer: inp.dataset.c, amount: cur });
    });
    if (!changed.length) { showToast('Không có thay đổi để lưu', 'info'); return; }
    try {
        const r = await api.call('npp.api.manager.set_targets_bulk', { data: changed });
        showToast(`Đã lưu ${r.updated} NPP`, 'success');
        load(_months);
    } catch (err) {
        showToast('Lỗi lưu: ' + (err.message || ''), 'error');
    }
}

/** Dán từ Excel/Sheets: mỗi dòng "tên/mã <tab|,> số". Khớp theo mã hoặc tên (không phân biệt hoa thường). */
function applyPaste() {
    const ta = document.getElementById('npp-tg-paste');
    const text = (ta.value || '').trim();
    if (!text) { showToast('Chưa có dữ liệu để dán', 'info'); return; }
    const inputs = Array.from(document.querySelectorAll('#npp-tg-table .npp-tg-input'));
    const byCode = new Map(inputs.map((i) => [i.dataset.c.toLowerCase(), i]));
    const byName = new Map(inputs.map((i) => [i.dataset.name, i]));
    let ok = 0, miss = 0;
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split(/\t|,|;|\s{2,}/).map((s) => s.trim()).filter(Boolean);
        if (parts.length < 2) { miss++; continue; }
        const amount = parseFloat(parts[parts.length - 1].replace(/[^\d.-]/g, '')) || 0;
        const key = parts.slice(0, -1).join(' ').toLowerCase().trim();
        const inp = byCode.get(key) || byName.get(key);
        if (inp && amount > 0) { inp.value = amount; ok++; } else { miss++; }
    }
    showToast(`Đã áp dụng ${ok} dòng${miss ? `, ${miss} dòng không khớp` : ''} — kiểm tra rồi “Lưu tất cả”`, ok ? 'success' : 'error');
}

async function saveTarget(customer, root) {
    const input = root.querySelector(`.npp-tg-input[data-c="${CSS.escape(customer)}"]`);
    const amount = parseFloat(input.value) || 0;
    try {
        await api.call('npp.api.manager.set_target', { customer, amount });
        showToast('Đã lưu mục tiêu', 'success');
        load(_months);   // tải lại để cập nhật % đạt + tổng
    } catch (err) {
        showToast('Lỗi lưu: ' + (err.message || ''), 'error');
    }
}
