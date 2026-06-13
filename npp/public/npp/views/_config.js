// ════════════════════════════════════════════════════════════════════════
// NPP CONFIG — Sửa file này khi schema ERPNext của Hoàng Giang đổi.
// Tất cả views import từ đây thay vì hardcode tên field.
// ════════════════════════════════════════════════════════════════════════

export const COMPANY    = 'Công ty cổ phần Hoàng Giang';
export const PRICE_LIST = 'TỈNH';
export const ZALO_PHONE = '0965028868';

// ─── Item Group mapping (đã setup sẵn trong ERP) ──────────────────────
// Tên các nhóm phải khớp CHÍNH XÁC với ERP. Verify bằng cách vào
// /app/item-group → list các record con của item group root.
export const ITEM_GROUPS_BY_NAME = {
    traditional: 'Hàng truyền thống',
    tet:         'Hàng Tết',
};

// ─── Item Groups for đặt hàng UI ──────────────────────────────────────
// v0.1: hardcoded list cho stability. v0.2: chuyển sang query Item theo
// item_group dynamic. Mỗi entry có item_group_name khớp ERP để analytics
// có thể query theo group.
export const ITEM_GROUPS = {
    traditional: {
        label: 'Truyền Thống',
        icon: '🏮',
        item_group_name: 'Hàng truyền thống',
        items: [
            'LX','LD','LC','LS','LK','H15','HG20','H25','H24 X','H24 D','H24 C','H24 K','H24 S',
            'TC24','TCT','SVTV','TVI','BX','CĐ','T250','Mix510','Mix900','TX170','TX300','SR170',
            'SR300','TH170','TH300','TX510','SR510','TH510','TX900','SR900','TH900','TIV','TRE',
            '5S','TX5S','TH5S','SR5S',
            'Vỉ ăn thử trái cây','Vỉ ăn thử thượng hạng','Vỉ ăn thử trà xanh','Vỉ ăn thử sầu riêng',
        ],
    },
    tet: {
        label: 'Hàng Tết',
        icon: '🧧',
        item_group_name: 'Hàng Tết',
        items: [
            'MDTC','TSV','BSV','HDN','TVR','NV','THSV','THHD','THHM','CRV','TTPL','CVTT',
            'PL','CĐTT','CLV','SL','ĐTL','ĐTT','ĐTN','BCT','HDT','TTNP','LPLH','KLPQ',
            'KDBA','TLPQ','TDD',
        ],
    },
};

// ─── Field map (Sales Invoice) ────────────────────────────────────────
// Custom field tiếng Việt có dấu — fixture trong npp/fixtures/custom_field.json.
// net_weight là field CHUẨN của Sales Invoice (parent), KHÔNG phải custom.
// Khi đổi tên field: sửa ở đây + fixture JSON (nếu là custom) + bench migrate.
export const SI_FIELDS = {
    shipping_type:    'custom_hình_thức_vận_chuyển',
    chuyen_xe:        'custom_chuyến_xe',
    vehicle:          'custom_xe',
    driver:           'custom_tên_lái_xe',
    driver_phone:     'custom_điện_thoại_lái_xe',
    delivery_status:  'custom_trạng_thái_vận_chuyển',
    note_npp:         'custom_ghi_chú_npp',
    note_internal:    'custom_ghi_chú_giao_hàng',
    net_weight:       'total_net_weight',   // Standard ERPNext (kg) — Sales Invoice parent
};

// ─── Item custom + standard fields ────────────────────────────────────
// Lưu ý: Item KHÔNG có total_weight/total_net_weight. Field cân nặng của Item
// là 'weight_per_unit' (kg/đơn vị) — thêm vào đây nếu cần dùng trong catalog.
export const ITEM_FIELDS = {
    quycach:    'custom_quycach',      // Item master field (ERP quản lý) — số hộp/thùng
    the_tich:   'custom_thể_tích',     // Item master field (ERP) — thể tích/hộp
    item_group: 'item_group',          // Standard ERPNext
};

// ─── Delivery status enum (đồng bộ với fixture Select options) ───────
export const DELIVERY_STATUS = {
    PENDING:   'Chờ xử lý',
    SHIPPING:  'Đang giao',
    DELIVERED: 'Đã giao',
    CANCELLED: 'Đã hủy',
};

export const DELIVERY_STATUS_LABELS = {
    'Chờ xử lý': { color: 'warning', icon: '⏳' },
    'Đang giao': { color: 'primary', icon: '🚚' },
    'Đã giao':   { color: 'success', icon: '✅' },
    'Đã hủy':    { color: 'muted',   icon: '❌' },
};

// ─── Display name cleaning rules ──────────────────────────────────────
export const STRIP_PATTERNS = [
    /Bánh đậu xanh hương vị/gi,
    /Bánh đậu xanh/gi,
    /Bánh đậu/gi,
    /RVHG/gi,
];

export function cleanItemName(name) {
    let s = String(name || '');
    for (const p of STRIP_PATTERNS) s = s.replace(p, '');
    return s.trim();
}
