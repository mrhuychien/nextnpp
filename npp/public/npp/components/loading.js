const mount = () => document.getElementById('npp-loading-mount');
const text  = () => mount()?.querySelector('.npp-loading-text');

export function showLoading(message = 'Đang xử lý...') {
    const m = mount(); if (!m) return;
    text().textContent = message;
    m.hidden = false;
}

export function hideLoading() {
    const m = mount(); if (!m) return;
    m.hidden = true;
}
