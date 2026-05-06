// Wrapper around frappe.call() with cache, error normalisation,
// and high-level helpers for CRUD on standard DocTypes.

import * as store from './store.js';

function call(method, args = {}) {
    return new Promise((resolve, reject) => {
        if (typeof window.frappe?.call !== 'function') {
            return reject(new Error('Frappe API not available — are you logged in?'));
        }
        window.frappe.call({
            method,
            args,
            callback: (r) => resolve(r?.message),
            error: (xhr) => {
                const msg = xhr?.responseJSON?.exc || xhr?.statusText || 'API error';
                reject(new Error(String(msg).slice(0, 500)));
            },
        });
    });
}

// ─── Standard CRUD ─────────────────────────────────────────────────────
export const list = (doctype, opts = {}) => call('frappe.client.get_list', {
    doctype,
    fields:             opts.fields            || ['name'],
    filters:            opts.filters           || [],
    or_filters:         opts.or_filters        || undefined,
    order_by:           opts.order_by          || 'creation desc',
    limit_page_length:  opts.limit             ?? 20,
    limit_start:        opts.start             ?? 0,
});

export const get   = (doctype, name)         => call('frappe.client.get',       { doctype, name });
export const value = (doctype, filters, fn)  => call('frappe.client.get_value', { doctype, filters, fieldname: fn });
export const insert= (doc)                   => call('frappe.client.insert',    { doc });
export const update= (doctype, name, fields) => call('frappe.client.set_value', { doctype, name, fieldname: fields });
export const remove= (doctype, name)         => call('frappe.client.delete',    { doctype, name });
export const count = (doctype, filters)      => call('frappe.client.get_count', { doctype, filters });

// ─── Custom whitelisted methods (Phase 5) ──────────────────────────────
export const dashboard         = ()              => call('npp.api.dashboard.summary');
export const outstanding       = ()              => call('npp.api.outstanding.summary');
export const aging             = ()              => call('npp.api.outstanding.aging');
export const promotionsList    = ()              => call('npp.api.promotions.active_for_user');
export const salesByMonth      = (months = 12)   => call('npp.api.analytics.sales_by_month', { months });
export const salesByItemGroup  = (months = 12)   => call('npp.api.analytics.sales_by_item_group', { months });
export const topItems          = (months = 1, item_group = null) => call('npp.api.analytics.top_items', { months, item_group });

// ─── Cached variants ───────────────────────────────────────────────────
export const cached = {
    items(filters)        { return store.ensure(`items:${JSON.stringify(filters)}`, () => list('Item', filters), store.TTL.LONG); },
    prices(priceList)     { return store.ensure(`prices:${priceList}`,              () => list('Item Price', { fields: ['item_code','price_list_rate'], filters: [['price_list','=',priceList]], limit: 0 }), store.TTL.LONG); },
    dashboard()           { return store.ensure('dashboard',                        () => dashboard(),       store.TTL.SHORT); },
    outstanding()         { return store.ensure('outstanding',                      () => outstanding(),     store.TTL.SHORT); },
    promotions()          { return store.ensure('promotions',                       () => promotionsList(),  store.TTL.MEDIUM); },
};

// ─── Custom: get_item_details for pricing rule application ─────────────
export function getItemDetails(args) {
    return call('erpnext.stock.get_item_details.get_item_details', { args });
}

export { call };  // escape hatch
