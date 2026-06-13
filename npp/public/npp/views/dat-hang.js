import { html } from '../lib/dom.js';
import { formatNumber, escapeHtml, debounce } from '../lib/format.js';
import * as api from '../lib/api.js';
import { showToast } from '../components/toast.js';
import { showLoading, hideLoading } from '../components/loading.js';
import { showModal, closeModal } from '../components/modal.js';
// _config.js nạp ĐỘNG kèm ?v= để bust cache 'immutable' của /assets — đổi tên
// field/config có hiệu lực chỉ với F5, không cần hard-refresh.
let PRICE_LIST, ITEM_GROUPS, ITEM_FIELDS, SI_FIELDS, cleanItemName;
async function loadConfig() {
    const v = encodeURIComponent(window.NPP_CONTEXT?.assetVersion || '');
    const cfg = await import(v ? `./_config.js?v=${v}` : './_config.js');
    ({ PRICE_LIST, ITEM_GROUPS, ITEM_FIELDS, SI_FIELDS, cleanItemName } = cfg);
}

const QTY = {};   // item_code → qty (số thùng)
let activeTab = 'traditional';
let itemsCache = {};  // item_code → item doc
let pricesCache = {}; // item_code → rate
let containerEl = null;
let editingOrder = null;   // tên SI đang sửa (null = tạo đơn mới)
let editNote = '';         // ghi chú prefill khi sửa

export async function render({ container, query }) {
    await loadConfig();   // nạp _config.js (versioned) trước khi dùng
    containerEl = container;

    // Edit-mode: /dat-hang?edit=<tên SI nháp> — prefill số lượng để cập nhật.
    const editName = (query && query.edit) || null;
    if (editName) {
        if (editingOrder !== editName) {
            editingOrder = editName;
            await prefillFromOrder(editName);
        }
    } else if (editingOrder) {
        // Rời chế độ sửa → reset giỏ để không tạo nhầm đơn mới từ đơn cũ.
        editingOrder = null;
        editNote = '';
        Object.keys(QTY).forEach((k) => delete QTY[k]);
    }

    container.innerHTML = html`
        ${editingOrder ? html`<div class="npp-card" style="margin-bottom:12px;border-left:3px solid var(--npp-season-1);">
            <i class="fas fa-pen"></i> Đang sửa đơn <strong>${escapeHtml(editingOrder)}</strong> —
            chỉnh số lượng rồi bấm <strong>Cập nhật đơn</strong>.
        </div>` : ''}
        <div class="npp-dh-tabs">
            ${Object.entries(ITEM_GROUPS).map(([key, g]) => html`
                <button class="npp-dh-tab ${key === activeTab ? 'npp-active' : ''}" data-tab="${key}" type="button">
                    ${g.icon} ${g.label}
                </button>
            `).join('')}
        </div>
        <div class="npp-dh-search-wrap">
            <i class="fas fa-search"></i>
            <input id="npp-dh-search" class="npp-dh-search" placeholder="Tìm sản phẩm..." />
        </div>
        <div class="npp-dh-grid" id="npp-dh-grid"></div>
        <div class="npp-dh-summary" id="npp-dh-summary" hidden></div>
        <button class="npp-dh-cta" id="npp-dh-cta" type="button">
            ${editingOrder ? '<i class="fas fa-save"></i> Cập nhật đơn' : '<i class="fas fa-paper-plane"></i> Lên đơn hàng'}
        </button>
    `;

    // Tab switching
    container.querySelectorAll('.npp-dh-tab').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Search
    const search = document.getElementById('npp-dh-search');
    search.addEventListener('input', debounce((e) => filterCards(e.target.value), 250));

    // CTA
    document.getElementById('npp-dh-cta').addEventListener('click', openOrderReview);

    // Increment/decrement (delegated)
    document.getElementById('npp-dh-grid').addEventListener('click', (e) => {
        const btn = e.target.closest('.npp-qty-btn');
        if (!btn) return;
        const card = btn.closest('.npp-product-card');
        const code = card.dataset.code;
        const input = card.querySelector('.npp-qty-input');
        let v = parseInt(input.value, 10) || 0;
        v = btn.dataset.action === 'inc' ? Math.min(999, v + 1) : Math.max(0, v - 1);
        input.value = v; QTY[code] = v;
        updateSummary();
    });
    document.getElementById('npp-dh-grid').addEventListener('input', (e) => {
        const input = e.target.closest('.npp-qty-input');
        if (!input) return;
        const card = input.closest('.npp-product-card');
        const code = card.dataset.code;
        const v = Math.min(999, Math.max(0, parseInt(input.value, 10) || 0));
        input.value = v; QTY[code] = v;
        updateSummary();
    });

    await loadGroup(activeTab);
}

async function prefillFromOrder(name) {
    let doc;
    try {
        doc = await api.get('Sales Invoice', name);
    } catch (err) {
        showToast('Không tải được đơn để sửa: ' + (err.message || ''), 'error');
        editingOrder = null;
        return;
    }
    const lines = doc.items || [];
    const codes = [...new Set(lines.map((l) => l.item_code).filter(Boolean))];

    // Nạp chi tiết + giá cho MỌI item của đơn (kể cả khác tab) để submit không sót.
    if (codes.length) {
        try {
            const items = await api.list('Item', {
                fields: ['item_code', 'item_name', 'image', 'standard_rate', 'item_group', ITEM_FIELDS.quycach, ITEM_FIELDS.the_tich],
                filters: [['item_code', 'in', codes]],
                limit: 0,
            });
            items.forEach((it) => itemsCache[it.item_code] = it);
            const prices = await api.list('Item Price', {
                fields: ['item_code', 'price_list_rate'],
                filters: [['item_code', 'in', codes], ['price_list', '=', PRICE_LIST]],
                order_by: 'modified desc',
                limit: 0,
            });
            prices.forEach((p) => { if (!(p.item_code in pricesCache)) pricesCache[p.item_code] = p.price_list_rate; });
            items.forEach((it) => { if (!(it.item_code in pricesCache) && it.standard_rate) pricesCache[it.item_code] = it.standard_rate; });
        } catch { /* lỗi giá/chi tiết không chặn việc prefill số lượng */ }
    }

    // QTY = số thùng từ các dòng đơn (đơn đặt theo uom 'Thùng').
    Object.keys(QTY).forEach((k) => delete QTY[k]);
    lines.forEach((l) => { QTY[l.item_code] = (QTY[l.item_code] || 0) + (parseInt(l.qty, 10) || 0); });
    editNote = doc[SI_FIELDS.note_npp] || '';
}

async function loadGroup(tabKey) {
    const grid = document.getElementById('npp-dh-grid');
    grid.innerHTML = '<div class="npp-skeleton" style="height:300px;"></div>';

    const codes = ITEM_GROUPS[tabKey].items;
    try {
        // Items
        const items = await api.list('Item', {
            fields: [
                'item_code', 'item_name', 'image', 'standard_rate',
                'item_group',
                ITEM_FIELDS.quycach, ITEM_FIELDS.the_tich,
            ],
            filters: [['item_code', 'in', codes]],
            order_by: 'item_code asc',
            limit: 999,
        });
        items.forEach((it) => itemsCache[it.item_code] = it);

        // Prices
        const prices = await api.list('Item Price', {
            fields: ['item_code', 'price_list_rate'],
            filters: [['item_code', 'in', codes], ['price_list', '=', PRICE_LIST]],
            order_by: 'modified desc',
            limit: 999,
        });
        prices.forEach((p) => {
            if (!(p.item_code in pricesCache)) pricesCache[p.item_code] = p.price_list_rate;
        });
        // Fallback to standard_rate
        items.forEach((it) => {
            if (!(it.item_code in pricesCache) && it.standard_rate) pricesCache[it.item_code] = it.standard_rate;
        });

        renderGrid(codes);
    } catch (err) {
        grid.innerHTML = `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div><div>${escapeHtml(err.message)}</div></div>`;
    }
}

function renderGrid(codes) {
    const grid = document.getElementById('npp-dh-grid');
    grid.innerHTML = codes.map((code) => {
        const item = itemsCache[code];
        if (!item) return `<div class="npp-product-card"><p>Lỗi: ${escapeHtml(code)}</p></div>`;
        const quycach = parseInt(item[ITEM_FIELDS.quycach], 10) || 1;
        const price = pricesCache[code] || 0;
        const rateBox = price * quycach;
        const name = cleanItemName(item.item_name);
        const qty = QTY[code] || 0;
        const img = item.image || '/assets/frappe/images/fallback-thumbnail.gif';
        return html`
            <div class="npp-product-card" data-code="${escapeHtml(code)}">
                <div class="npp-product-img" style="background-image:url('${escapeHtml(img)}');"></div>
                <h6>${escapeHtml(name)}</h6>
                <div class="npp-product-price">${formatNumber(rateBox)}đ /thùng (${quycach} hộp)</div>
                <div class="npp-qty-control">
                    <button class="npp-qty-btn" data-action="dec" type="button">−</button>
                    <input class="npp-qty-input" type="number" min="0" max="999" value="${qty}">
                    <button class="npp-qty-btn" data-action="inc" type="button">+</button>
                </div>
            </div>`;
    }).join('');
    updateSummary();
}

function switchTab(key) {
    activeTab = key;
    containerEl.querySelectorAll('.npp-dh-tab').forEach((b) => b.classList.toggle('npp-active', b.dataset.tab === key));
    loadGroup(key);
}

function filterCards(term) {
    term = term.toLowerCase().trim();
    document.querySelectorAll('.npp-product-card').forEach((card) => {
        card.style.display = card.textContent.toLowerCase().includes(term) ? '' : 'none';
    });
}

function calcTotals() {
    let qty = 0, amount = 0, volume = 0;
    for (const [code, q] of Object.entries(QTY)) {
        if (!q) continue;
        const item = itemsCache[code];
        const price = pricesCache[code];
        if (!item || !price) continue;
        const quycach = parseInt(item[ITEM_FIELDS.quycach], 10) || 1;
        qty += q;
        amount += q * price * quycach;
        volume += (parseFloat(item[ITEM_FIELDS.the_tich]) || 0) * quycach * q / 1_000_000;
    }
    return { qty, amount, volume };
}

function updateSummary() {
    const sum = document.getElementById('npp-dh-summary');
    const { qty, amount, volume } = calcTotals();
    if (qty <= 0) { sum.hidden = true; return; }
    sum.hidden = false;
    sum.innerHTML = html`<strong>${qty}</strong> thùng · <strong>${formatNumber(amount)}đ</strong> · <strong>${volume.toFixed(2)} m³</strong>`;
}

function openOrderReview() {
    const { qty, amount } = calcTotals();
    if (qty === 0) return showToast('Chọn ít nhất 1 sản phẩm', 'warning');

    const rows = [];
    for (const [code, q] of Object.entries(QTY)) {
        if (!q) continue;
        const item = itemsCache[code];
        const price = pricesCache[code];
        if (!item || !price) continue;
        const quycach = parseInt(item[ITEM_FIELDS.quycach], 10) || 1;
        rows.push({ code, name: cleanItemName(item.item_name), qty: q, rate: price * quycach, amount: q * price * quycach, quycach });
    }

    const body = html`
        <table class="npp-table">
            <thead><tr><th>Sản phẩm</th><th>SL</th><th>Tiền</th></tr></thead>
            <tbody>
                ${rows.map((r) => html`<tr>
                    <td data-label="Sản phẩm">${escapeHtml(r.name)}</td>
                    <td data-label="SL">${r.qty}</td>
                    <td data-label="Tiền">${formatNumber(r.amount)}đ</td>
                </tr>`).join('')}
            </tbody>
        </table>
        <div class="npp-card npp-mt-3 npp-flex npp-justify-between">
            <span>Tổng (giá niêm yết):</span>
            <strong>${formatNumber(amount)}đ</strong>
        </div>
        <div class="npp-mt-3">
            <label for="npp-dh-note" class="npp-text-sm npp-font-bold">Ghi chú (tuỳ chọn)</label>
            <textarea id="npp-dh-note"
                      class="npp-textarea npp-mt-2"
                      rows="2"
                      placeholder="VD: Giao trước 9h sáng, ưu tiên hàng Tết..."></textarea>
        </div>
        <p class="npp-text-sm npp-text-muted npp-mt-2 npp-text-center">
            * Giá cuối sẽ tự động áp khuyến mãi còn hiệu lực
        </p>
    `;
    const footer = html`<button class="npp-btn-primary" id="npp-dh-confirm" type="button">
        <i class="fas fa-check"></i> ${editingOrder ? 'Cập nhật đơn' : 'Xác nhận gửi đơn'}
    </button>`;
    showModal({ title: editingOrder ? `Cập nhật đơn ${escapeHtml(editingOrder)}` : 'Xác nhận đơn hàng', body, footer });
    const noteEl = document.getElementById('npp-dh-note');
    if (noteEl && editNote) noteEl.value = editNote;
    document.getElementById('npp-dh-confirm').addEventListener('click', () => submitOrder(rows));
}

async function submitOrder(rows) {
    const isEdit = !!editingOrder;
    showLoading(isEdit ? 'Đang cập nhật đơn...' : 'Đang tạo đơn...');
    try {
        const noteEl = document.getElementById('npp-dh-note');
        const note = noteEl ? noteEl.value.trim() : '';
        // Gửi số THÙNG cho server; server tự quy đổi + áp giá (gồm khuyến mãi).
        const payload = rows.map((r) => ({ item_code: r.code, cases: r.qty }));
        const inv = isEdit
            ? await api.call('npp.api.orders.update_order', { invoice: editingOrder, items: JSON.stringify(payload), note })
            : await api.call('npp.api.orders.create_order', { items: JSON.stringify(payload), note });

        closeModal();
        showToast(isEdit ? `Đã cập nhật đơn ${inv.name}` : `Đã tạo đơn ${inv.name}`, 'success');
        Object.keys(QTY).forEach((k) => delete QTY[k]);   // clear cart
        editingOrder = null;
        editNote = '';
        location.hash = `#/don-hang/${encodeURIComponent(inv.name)}`;
    } catch (err) {
        showToast('Lỗi: ' + (err.message || (isEdit ? 'Không cập nhật được đơn' : 'Không tạo được đơn')), 'error');
    } finally {
        // LUÔN tắt spinner — hết "quay tròn" kể cả khi lỗi/timeout.
        hideLoading();
    }
}
