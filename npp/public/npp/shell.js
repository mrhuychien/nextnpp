import * as router from './lib/router.js';
import { showToast } from './components/toast.js';
import { initSeason, openSeasonPicker } from './components/season-picker.js';
import { highlightActiveRoute } from './components/bottom-nav.js';
import * as store from './lib/store.js';

// ─── 1. Sanity check ───────────────────────────────────────────────────
if (!window.NPP_CONTEXT) {
    console.error('[NPP] window.NPP_CONTEXT missing — check www/npp.html');
}

// ─── 2. Season ─────────────────────────────────────────────────────────
initSeason();
document.getElementById('npp-btn-season')?.addEventListener('click', openSeasonPicker);

// ─── 3. Header refresh button ─────────────────────────────────────────
document.getElementById('npp-btn-refresh')?.addEventListener('click', () => {
    const evt = new CustomEvent('npp:refresh');
    window.dispatchEvent(evt);
    showToast('Đã làm mới dữ liệu', 'info');
});

// ─── 4. Header back button ────────────────────────────────────────────
document.getElementById('npp-btn-back')?.addEventListener('click', () => {
    history.length > 1 ? history.back() : router.navigate('/');
});

// ─── 5. Lazy-load views (code-split per route) ─────────────────────────
const VIEW_MODULES = {
    '/'           : () => import('./views/dashboard.js'),
    '/dat-hang'   : () => import('./views/dat-hang.js'),
    '/don-hang'   : () => import('./views/don-hang.js'),
    '/cong-no'    : () => import('./views/cong-no.js'),
    '/khuyen-mai' : () => import('./views/khuyen-mai.js'),
    '/thong-ke'   : () => import('./views/thong-ke.js'),
};

async function renderRoute(routeKey, ctx) {
    const viewEl = document.getElementById('npp-view');
    viewEl.innerHTML = '<div class="npp-skeleton" style="height:200px;"></div>';
    try {
        const mod = await VIEW_MODULES[routeKey]();
        if (typeof mod.render !== 'function') throw new Error(`View ${routeKey} missing render()`);
        await mod.render({ container: viewEl, ...ctx });
    } catch (err) {
        console.error(err);
        viewEl.innerHTML = `<div class="npp-empty"><div class="npp-empty-icon">⚠️</div>
            <div class="npp-empty-title">Lỗi tải trang</div>
            <div class="npp-text-sm">${err.message}</div></div>`;
    }
}

// ─── 6. Routes ─────────────────────────────────────────────────────────
router.add('/',                        ({ query }) => { highlightActiveRoute('/');           return renderRoute('/',           { query }); });
router.add('/dat-hang',                ({ query }) => { highlightActiveRoute('/dat-hang');   return renderRoute('/dat-hang',   { query }); });
router.add('/don-hang',                ({ query }) => { highlightActiveRoute('/don-hang');   return renderRoute('/don-hang',   { query, params: {} }); });
router.add('/don-hang/:name',          ({ params, query }) => { highlightActiveRoute('/don-hang'); return renderRoute('/don-hang',   { query, params }); });
router.add('/cong-no',                 ({ query }) => { highlightActiveRoute('/cong-no');    return renderRoute('/cong-no',    { query }); });
router.add('/khuyen-mai',              ({ query }) => { highlightActiveRoute('/khuyen-mai'); return renderRoute('/khuyen-mai', { query }); });
router.add('/thong-ke',                ({ query }) => { highlightActiveRoute('/thong-ke');   return renderRoute('/thong-ke',   { query }); });

// ─── 7. Header title sync ──────────────────────────────────────────────
const TITLES = {
    '/'           : 'Trang chủ',
    '/dat-hang'   : 'Đặt hàng',
    '/don-hang'   : 'Đơn hàng',
    '/cong-no'    : 'Công nợ',
    '/khuyen-mai' : 'Khuyến mãi',
    '/thong-ke'   : 'Thống kê',
};

router.setBeforeNavigate(({ path }) => {
    const seg = '/' + (path.split('/')[1] || '');
    document.getElementById('npp-header-title').textContent = TITLES[seg] || 'NPP Portal';
    const isDetail = path !== '/' && path.split('/').length > 2;
    const backBtn  = document.getElementById('npp-btn-back');
    if (backBtn) backBtn.hidden = !isDetail;
});

// ─── 8. Start ──────────────────────────────────────────────────────────
router.start();

// Expose minimal debug surface
window.NPP = { store, router, showToast };
