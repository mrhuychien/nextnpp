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
