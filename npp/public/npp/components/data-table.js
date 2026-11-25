import { html } from '../lib/dom.js';
import { escapeHtml } from '../lib/format.js';
import { emptyState } from './empty-state.js';

/**
 * @param {object} opts
 * @param {Array<{key, label, render?}>} opts.columns
 * @param {Array<object>}                opts.rows
 * @param {function?}                    opts.onRowClick   // (row) => void
 * @param {string?}                      opts.emptyMessage
 */
export function dataTable({ columns, rows, onRowClick, emptyMessage = 'Không có dữ liệu' }) {
    if (!rows || rows.length === 0) {
        return emptyState({ icon: '📭', title: emptyMessage });
    }

    const renderCell = (col, row) => col.render ? col.render(row) : escapeHtml(row[col.key] ?? '');
    const clickable  = onRowClick ? 'npp-table-row-clickable' : '';

    return html`
        <table class="npp-table">
            <thead>
                <tr>${columns.map((c) => html`<th>${escapeHtml(c.label)}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${rows.map((row, i) => html`
                    <tr class="${clickable}" data-row-index="${i}">
                        ${columns.map((c) => html`<td data-label="${escapeHtml(c.label)}">${renderCell(c, row)}</td>`).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/** Attach click handler after rendering. Call with the container element + rows + handler. */
export function bindTableClicks(container, rows, handler) {
    container.querySelectorAll('.npp-table-row-clickable').forEach((tr) => {
        tr.addEventListener('click', () => {
            const i = Number(tr.dataset.rowIndex);
            if (!isNaN(i)) handler(rows[i]);
        });
    });
}

// ─── Phân trang client-side ────────────────────────────────────────────
// Lọc/tìm/sắp trên TOÀN BỘ dữ liệu trước, rồi đưa kết quả vào paged() (đổi bộ lọc
// → gọi paged() mới → về trang 1). State mỗi bảng nằm trong PT_REG theo id.
const PT_REG = new Map();
let ptSeq = 0;

function ptPager(id, st) {
    const totalPages = Math.max(1, Math.ceil(st.rows.length / st.pageSize));
    if (totalPages <= 1) return '';                    // ≤ pageSize dòng → pager tự ẩn
    return `<div class="npp-pager">
        <button type="button" class="npp-pager-btn" data-pt-prev="${id}" ${st.page <= 0 ? 'disabled' : ''} aria-label="Trang trước">‹ Trước</button>
        <span class="npp-pager-info">Trang ${st.page + 1}/${totalPages} · ${st.rows.length} dòng</span>
        <button type="button" class="npp-pager-btn" data-pt-next="${id}" ${st.page >= totalPages - 1 ? 'disabled' : ''} aria-label="Trang sau">Sau ›</button></div>`;
}

function ptInner(id) {
    const st = PT_REG.get(id);
    if (!st) return '';
    const start = st.page * st.pageSize;
    return st.render(st.rows.slice(start, start + st.pageSize), start) + ptPager(id, st);
}

function ptDraw(id) {
    const el = document.querySelector(`[data-pt="${id}"]`);
    const st = PT_REG.get(id);
    if (!el || !st) return;
    el.innerHTML = ptInner(id);
    if (st.onDraw) { try { st.onDraw(el); } catch (e) { console.error(e); } }
    // Sang trang khi đang đứng ở pager cuối bảng → kéo về đầu bảng (mobile 20 thẻ/trang)
    if (el.getBoundingClientRect().top < 60) el.scrollIntoView({ block: 'start' });
}

/**
 * Bảng/danh sách dài chia trang. Trả CHUỖI HTML → nhúng vào template bất kỳ.
 * @param {object}   opts
 * @param {Array}    opts.rows      // toàn bộ dòng ĐÃ lọc
 * @param {function} opts.render    // (slice, startIndex) => html của 1 trang
 * @param {number?}  opts.pageSize  // mặc định 10
 * @param {function?} opts.onDraw   // (wrapperEl) => void — bind sự kiện trong trang vừa vẽ.
 *   Gọi lại MỖI lần đổi trang trên CÙNG wrapper → dùng el.onclick = … (gán), không
 *   addEventListener (chồng listener). Chỉ query trong wrapperEl.
 */
export function paged({ rows, render, pageSize = 10, onDraw = null }) {
    const id = 'pt' + (++ptSeq);
    if (PT_REG.size > 200) PT_REG.delete(PT_REG.keys().next().value);   // giới hạn bộ nhớ
    PT_REG.set(id, { rows: rows || [], render, pageSize, page: 0, onDraw });
    if (onDraw) {
        setTimeout(() => {                                             // onDraw cho TRANG ĐẦU
            const el = document.querySelector(`[data-pt="${id}"]`);
            if (el) { try { onDraw(el); } catch (e) { console.error(e); } }
        }, 0);
    }
    return `<div class="npp-paged" data-pt="${id}">${ptInner(id)}</div>`;
}

// Delegation 1 LẦN khi module nạp — nút ‹ › sống dù bảng nằm sâu trong innerHTML/modal
document.addEventListener('click', (e) => {
    const prev = e.target.closest('[data-pt-prev]');
    const next = e.target.closest('[data-pt-next]');
    if (!prev && !next) return;
    const id = prev ? prev.dataset.ptPrev : next.dataset.ptNext;
    const st = PT_REG.get(id);
    if (!st) return;
    const total = Math.max(1, Math.ceil(st.rows.length / st.pageSize));
    st.page = Math.min(Math.max(0, st.page + (prev ? -1 : 1)), total - 1);
    ptDraw(id);
});
