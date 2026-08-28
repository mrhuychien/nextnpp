// Bàn phím số RIÊNG cho ô số lượng — bottom-sheet, phím to, nhập nhanh khi đặt hàng.
// Không dùng bàn phím hệ thống (ô input để inputmode="none") nên không che màn hình,
// không auto-zoom, và bấm 1 tay được. Hỗ trợ cả bàn phím vật lý trên desktop.

import { escapeHtml } from '../lib/format.js';

let _state = null;   // { buf, max, onDone, onChange, fresh }

function el() { return document.getElementById('npp-numpad'); }

function paint() {
    const d = document.getElementById('npp-numpad-val');
    if (d) d.textContent = _state.buf === '' ? '0' : _state.buf;
}

function setBuf(b) {
    // Kẹp theo max, bỏ số 0 thừa ở đầu.
    b = String(b).replace(/^0+(?=\d)/, '');
    if (b !== '' && Number(b) > _state.max) b = String(_state.max);
    _state.buf = b;
    paint();
    if (_state.onChange) _state.onChange(Number(_state.buf || 0));
}

function press(k) {
    if (!_state) return;
    if (k === 'del') return setBuf(_state.buf.slice(0, -1));
    if (k === 'clr') return setBuf('');
    if (k.startsWith('+')) return setBuf(String(Number(_state.buf || 0) + Number(k.slice(1))));
    // Phím số: lần gõ ĐẦU sau khi mở sẽ thay thế giá trị cũ (khỏi phải xoá số 0).
    if (_state.fresh) { _state.fresh = false; return setBuf(k); }
    if (_state.buf.length >= 4) return;
    setBuf(_state.buf + k);
}

function onKey(e) {
    if (!_state) return;
    if (e.key >= '0' && e.key <= '9') { press(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { press('del'); e.preventDefault(); }
    else if (e.key === 'Enter') { closeNumpad(true); e.preventDefault(); }
    else if (e.key === 'Escape') { closeNumpad(false); e.preventDefault(); }
}

export function closeNumpad(commit) {
    const n = el();
    if (n) { n.remove(); }
    document.removeEventListener('keydown', onKey);
    const s = _state;
    _state = null;
    if (s && commit && s.onDone) s.onDone(Number(s.buf || 0));
}

/**
 * Mở bàn phím số.
 * @param {string} title    tên sản phẩm
 * @param {string} subtitle dòng phụ (đơn giá…)
 * @param {number} value    giá trị hiện tại
 * @param {number} max      giá trị tối đa (mặc định 999)
 * @param {function} onChange (n) => void  — cập nhật realtime khi gõ
 * @param {function} onDone   (n) => void  — bấm Xong / Enter
 */
export function openNumpad({ title = '', subtitle = '', value = 0, max = 999, onChange, onDone } = {}) {
    closeNumpad(false);
    _state = { buf: String(value || 0) === '0' ? '' : String(value), max, onChange, onDone, fresh: true };

    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const wrap = document.createElement('div');
    wrap.id = 'npp-numpad';
    wrap.className = 'npp-numpad-mount';
    wrap.innerHTML = `
        <div class="npp-numpad" role="dialog" aria-label="Nhập số lượng">
            <div class="npp-numpad-head">
                <div>
                    <div class="npp-numpad-title">${escapeHtml(title)}</div>
                    ${subtitle ? `<div class="npp-numpad-sub">${escapeHtml(subtitle)}</div>` : ''}
                </div>
                <button type="button" class="npp-icon-btn" data-k="close" aria-label="Đóng">✕</button>
            </div>
            <div class="npp-numpad-display"><span id="npp-numpad-val">0</span> <small>thùng</small></div>
            <div class="npp-numpad-quick">
                ${['+1', '+5', '+10', '+50'].map((q) => `<button type="button" data-k="${q}">${q}</button>`).join('')}
            </div>
            <div class="npp-numpad-grid">
                ${keys.map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}
                <button type="button" data-k="clr" class="npp-numpad-fn">C</button>
                <button type="button" data-k="0">0</button>
                <button type="button" data-k="del" class="npp-numpad-fn">⌫</button>
            </div>
            <button type="button" class="npp-numpad-done" data-k="done">Xong</button>
        </div>`;
    document.body.appendChild(wrap);
    paint();

    wrap.addEventListener('click', (e) => {
        if (e.target === wrap) return closeNumpad(true);      // chạm nền → lưu & đóng
        const b = e.target.closest('button[data-k]');
        if (!b) return;
        const k = b.dataset.k;
        if (k === 'done') return closeNumpad(true);
        if (k === 'close') return closeNumpad(false);
        press(k);
    });
    document.addEventListener('keydown', onKey);
}
