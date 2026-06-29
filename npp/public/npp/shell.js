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
// Cache-bust mỗi lần tải trang: Frappe serve /assets với cache 'immutable' 1
// năm, nên view module lazy-load PHẢI mang query ?v=... nếu không trình duyệt
// vẫn chạy code cũ sau khi deploy. assetVersion render mới ở mỗi full page load.
const ASSET_V = encodeURIComponent(window.NPP_CONTEXT?.assetVersion || '');
const withV = (path) => (ASSET_V ? `${path}?v=${ASSET_V}` : path);
const VIEW_MODULES = {
    '/'           : () => import(withV('./views/dashboard.js')),
    '/dat-hang'   : () => import(withV('./views/dat-hang.js')),
    '/don-hang'   : () => import(withV('./views/don-hang.js')),
    '/cong-no'    : () => import(withV('./views/cong-no.js')),
    '/khuyen-mai' : () => import(withV('./views/khuyen-mai.js')),
    '/thong-ke'   : () => import(withV('./views/thong-ke.js')),
    '/quan-ly'    : () => import(withV('./views/quan-ly.js')),
    '/ql-sp'      : () => import(withV('./views/quan-ly-sanpham.js')),
    '/ql-npp'     : () => import(withV('./views/quan-ly-npp.js')),
    '/ql-target'  : () => import(withV('./views/quan-ly-target.js')),
    '/ql-alert'   : () => import(withV('./views/quan-ly-alert.js')),
    '/ql-debt'    : () => import(withV('./views/quan-ly-debt.js')),
    '/ql-tet'     : () => import(withV('./views/quan-ly-tet.js')),
    '/ql-ds'      : () => import(withV('./views/quan-ly-doanhso.js')),
    '/ql-km'      : () => import(withV('./views/quan-ly-khuyenmai.js')),
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
router.add('/quan-ly',                 ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/quan-ly',    { query }); });
router.add('/ql-sp',                   ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/ql-sp',      { query }); });
router.add('/ql-npp',                  ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/ql-npp',     { query }); });
router.add('/ql-target',               ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/ql-target',  { query }); });
router.add('/ql-alert',                ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/ql-alert',   { query }); });
router.add('/ql-debt',                 ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/ql-debt',    { query }); });
router.add('/ql-tet',                  ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/ql-tet',     { query }); });
router.add('/ql-ds',                   ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/ql-ds',      { query }); });
router.add('/ql-km',                   ({ query }) => { highlightActiveRoute('/quan-ly');    return renderRoute('/ql-km',      { query }); });

// ─── 7. Header title sync ──────────────────────────────────────────────
const TITLES = {
    '/'           : 'Trang chủ',
    '/dat-hang'   : 'Đặt hàng',
    '/don-hang'   : 'Đơn hàng',
    '/cong-no'    : 'Công nợ',
    '/khuyen-mai' : 'Khuyến mãi',
    '/thong-ke'   : 'Thống kê',
    '/quan-ly'    : 'Quản lý NPP',
    '/ql-sp'      : 'Phân tích sản phẩm',
    '/ql-npp'     : 'Chi tiết NPP',
    '/ql-target'  : 'Mục tiêu',
    '/ql-alert'   : 'Cần xử lý',
    '/ql-debt'    : 'Công nợ',
    '/ql-tet'     : 'Theo dõi Tết',
    '/ql-ds'      : 'Doanh số tháng',
    '/ql-km'      : 'Khuyến mại',
};

router.setBeforeNavigate(({ path }) => {
    const seg = '/' + (path.split('/')[1] || '');
    document.getElementById('npp-header-title').textContent = TITLES[seg] || 'NPP Portal';
    const isDetail = path !== '/' && path.split('/').length > 2;
    const backBtn  = document.getElementById('npp-btn-back');
    if (backBtn) backBtn.hidden = !isDetail;
});

// ─── 8. Manager entry (chỉ hiện cho role quản lý) ──────────────────────
if (window.NPP_CONTEXT?.isManager) {
    const actions = document.querySelector('.npp-header-actions');
    if (actions && !document.getElementById('npp-btn-manager')) {
        const btn = document.createElement('button');
        btn.id = 'npp-btn-manager';
        btn.className = 'npp-icon-btn';
        btn.type = 'button';
        btn.title = 'Quản lý NPP';
        btn.setAttribute('aria-label', 'Quản lý NPP');
        btn.innerHTML = '<i class="fas fa-users"></i>';
        btn.addEventListener('click', () => { location.hash = '#/quan-ly'; });
        actions.insertBefore(btn, actions.firstChild);
    }
    // Quản lý không gắn NPP riêng → vào thẳng trang tổng quan.
    if (!window.NPP_CONTEXT.customer && ['', '#', '#/'].includes(location.hash)) {
        location.hash = '#/quan-ly';
    }
}

// ─── 9. Start ──────────────────────────────────────────────────────────
router.start();

// Expose minimal debug surface
window.NPP = { store, router, showToast };
