export function highlightActiveRoute(path) {
    const items = document.querySelectorAll('.npp-nav-item');
    const seg = '/' + (path.split('/')[1] || '');
    items.forEach((el) => {
        const r = el.dataset.route;
        const active = r === seg || (seg === '/' && r === '/');
        el.classList.toggle('npp-active', active);
    });
}
