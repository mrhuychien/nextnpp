import { html } from '../lib/dom.js';
import { formatCurrency, formatVNDShort, formatNumber, escapeHtml } from '../lib/format.js';
import * as api from '../lib/api.js';
import { banner } from '../components/banner.js';

// Tab quản lý & theo dõi CHƯƠNG TRÌNH KHUYẾN MẠI (trưng bày) — dữ liệu từ app `salep`
// (API contract: salep.api.dashboard.channel_summary / npp_summary). Manager-gated ở server.

function nav(active) {
    const items = [['#/quan-ly', 'ov', '📊 Tổng quan'], ['#/ql-sp', 'sp', '📦 Sản phẩm'], ['#/ql-npp', 'npp', '🔍 Chi tiết NPP'],
                   ['#/ql-target', 'tg', '🎯 Mục tiêu'], ['#/ql-alert', 'al', '🔔 Cần xử lý'], ['#/ql-debt', 'db', '💰 Công nợ'],
                   ['#/ql-tet', 'tet', '🧧 Tết'], ['#/ql-ds', 'ds', '📅 DS tháng'], ['#/ql-km', 'km', '🎁 Khuyến mại']];
    return `<div class="npp-ql-nav">${items.map(([h, k, l]) =>
        `<a href="${h}" class="${k === active ? 'npp-active' : ''}">${l}</a>`).join('')}</div>`;
}

const STATUS_BADGE = { 'Nháp': 'muted', 'Đang chạy': 'success', 'Kết thúc': 'primary' };
const N = (x) => Number(x) || 0;

function bar(pct, color) {
    pct = Math.max(0, Math.min(100, pct || 0));
    return `<div style="height:6px;background:var(--npp-surface-2);border-radius:4px;overflow:hidden;margin-top:4px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

export async function render({ container }) {
    container.innerHTML = html`
        ${banner({ title: 'Khuyến mại', subtitle: 'Quản lý & theo dõi chương trình trưng bày' })}
        ${nav('km')}
        <div id="npp-km-body"><div class="npp-skeleton" style="height:320px;"></div></div>
    `;
    try {
        const cs = await api.call('salep.api.dashboard.channel_summary');
        const ns = await api.call('salep.api.dashboard.npp_summary').catch(() => []);
        renderAll(cs || {}, ns || []);
    } catch (err) {
        const msg = String(err && err.message || '');
        const hint = /not whitelisted|does not exist|No module|ImportError|404/i.test(msg)
            ? 'Site chưa cài app <strong>salep</strong> (module Khuyến mại) hoặc method chưa được expose.'
            : (/Permission|403|not permitted|forbidden/i.test(msg)
                ? 'Tài khoản chưa có quyền <strong>Channel Manager</strong> để xem dữ liệu khuyến mại.'
                : escapeHtml(msg));
        document.getElementById('npp-km-body').innerHTML =
            `<div class="npp-empty"><div class="npp-empty-icon">🎁</div><div class="npp-empty-title">Chưa tải được dữ liệu khuyến mại</div><div class="npp-text-sm npp-text-muted">${hint}</div></div>`;
    }
}

function renderAll(cs, ns) {
    const programs = cs.program_progress || [];
    const rankNpp = cs.rank_npp || [];
    const rankStaff = cs.rank_staff || [];
    const gps = cs.gps_points || [];

    const totApproved = programs.reduce((s, p) => s + N(p.approved), 0);
    const totBudget = programs.reduce((s, p) => s + N(p.budget), 0);
    const totUsed = programs.reduce((s, p) => s + N(p.budget_used), 0);
    const nRunning = programs.filter((p) => p.status === 'Đang chạy').length;

    document.getElementById('npp-km-body').innerHTML = html`
        <div class="npp-kpi-grid">
            <div class="npp-kpi-card"><div class="npp-kpi-label">Chương trình</div><div class="npp-kpi-value">${programs.length}</div><div class="npp-kpi-sub">${nRunning} đang chạy</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Lượt được duyệt</div><div class="npp-kpi-value">${formatNumber(totApproved)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Ngân sách</div><div class="npp-kpi-value">${formatVNDShort(totBudget)}</div></div>
            <div class="npp-kpi-card"><div class="npp-kpi-label">Đã sử dụng</div>
                <div class="npp-kpi-value ${totUsed > totBudget ? 'danger' : ''}">${formatVNDShort(totUsed)}</div>
                <div class="npp-kpi-sub">${totBudget ? (totUsed / totBudget * 100).toFixed(0) : 0}% ngân sách</div></div>
        </div>

        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Tiến độ chương trình</h3>
            ${programs.length ? html`<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>Chương trình</th><th>Trạng thái</th><th class="npp-text-end">Mục tiêu</th><th class="npp-text-end">Tham gia</th><th class="npp-text-end">Đã duyệt</th><th class="npp-text-end" style="min-width:140px;">Ngân sách</th></tr></thead>
                <tbody>${programs.map((p) => {
                    const total = N(p.total), approved = N(p.approved), target = N(p.target_points);
                    const budget = N(p.budget), used = N(p.budget_used);
                    const usedPct = budget ? used / budget * 100 : 0;
                    const apprPct = target ? approved / target * 100 : 0;
                    const uColor = usedPct >= 100 ? 'var(--npp-danger)' : (usedPct >= 80 ? 'var(--npp-warning)' : 'var(--npp-success)');
                    return `<tr>
                        <td data-label="Chương trình"><strong>${escapeHtml(p.program_name || p.program || '')}</strong><div class="npp-text-sm npp-text-muted">${N(p.reward_per_point) ? formatCurrency(p.reward_per_point) + '/điểm' : ''}</div></td>
                        <td data-label="Trạng thái"><span class="npp-badge npp-badge-${STATUS_BADGE[p.status] || 'muted'}">${escapeHtml(p.status || '—')}</span></td>
                        <td data-label="Mục tiêu" class="npp-text-end">${formatNumber(target)}</td>
                        <td data-label="Tham gia" class="npp-text-end">${formatNumber(total)}</td>
                        <td data-label="Đã duyệt" class="npp-text-end"><strong>${formatNumber(approved)}</strong>${target ? `<div class="npp-text-sm npp-text-muted">${apprPct.toFixed(0)}% MT</div>` : ''}</td>
                        <td data-label="Ngân sách" class="npp-text-end">${formatVNDShort(used)}/${formatVNDShort(budget)}${bar(usedPct, uColor)}</td>
                    </tr>`;
                }).join('')}</tbody></table></div>`
                : '<div class="npp-text-muted npp-mt-2">Chưa có chương trình.</div>'}
        </div>

        <div class="npp-grid-2 npp-mt-3">
            <div class="npp-card"><h3 class="npp-font-bold">🏆 Top NPP (lượt duyệt)</h3>${rankList(rankNpp, 'npp', 'approved')}</div>
            <div class="npp-card"><h3 class="npp-font-bold">🏅 Top nhân viên (lượt duyệt)</h3>${rankList(rankStaff, 'full_name', 'approved', 'staff_user')}</div>
        </div>

        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">Tham gia theo NPP</h3>
            ${(ns && ns.length) ? html`<div style="overflow-x:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>NPP</th><th class="npp-text-end">Lượt tham gia</th><th class="npp-text-end">Đã duyệt</th><th class="npp-text-end">Điểm trưng bày</th></tr></thead>
                <tbody>${ns.map((r) => `<tr>
                    <td data-label="NPP">${escapeHtml(r.npp || '')}</td>
                    <td data-label="Tham gia" class="npp-text-end">${formatNumber(N(r.total_participations))}</td>
                    <td data-label="Đã duyệt" class="npp-text-end"><strong>${formatNumber(N(r.approved_participations))}</strong></td>
                    <td data-label="Điểm" class="npp-text-end">${formatNumber(N(r.distinct_points))}</td>
                </tr>`).join('')}</tbody></table></div>`
                : '<div class="npp-text-muted npp-mt-2">Chưa có dữ liệu tham gia.</div>'}
        </div>

        <div class="npp-card npp-mt-3"><h3 class="npp-font-bold">📍 Điểm trưng bày (GPS)${gps.length ? ` · ${gps.length}` : ''}</h3>
            ${gps.length ? html`<div style="overflow-x:auto;max-height:420px;overflow-y:auto;"><table class="npp-table npp-mt-2">
                <thead><tr><th>Điểm</th><th>NPP</th><th>Chương trình</th><th>Bản đồ</th></tr></thead>
                <tbody>${gps.map((g) => `<tr>
                    <td data-label="Điểm">${escapeHtml(g.display_point || g.name || '')}</td>
                    <td data-label="NPP">${escapeHtml(g.distributor || '')}</td>
                    <td data-label="Chương trình">${escapeHtml(g.promotion_program || '')}</td>
                    <td data-label="Bản đồ">${(g.latitude && g.longitude)
                        ? `<a href="https://www.google.com/maps?q=${N(g.latitude)},${N(g.longitude)}" target="_blank" rel="noopener" class="npp-link">📍 Mở</a>`
                        : '<span class="npp-text-muted">—</span>'}</td>
                </tr>`).join('')}</tbody></table></div>`
                : '<div class="npp-text-muted npp-mt-2">Chưa có điểm trưng bày.</div>'}
        </div>
    `;
}

function rankList(rows, nameKey, valKey, subKey) {
    if (!rows || !rows.length) return '<div class="npp-text-muted npp-mt-2">Chưa có dữ liệu.</div>';
    const max = Math.max(...rows.map((r) => N(r[valKey]))) || 1;
    return '<div class="npp-mt-2">' + rows.map((r, i) => {
        const name = r[nameKey] || (subKey ? r[subKey] : '') || '—';
        const v = N(r[valKey]);
        return `<div style="padding:6px 0;border-bottom:1px solid var(--npp-border);">
            <div class="npp-flex npp-justify-between npp-text-sm"><span><strong style="color:var(--npp-text-muted);">${i + 1}.</strong> ${escapeHtml(name)}</span><strong>${formatNumber(v)}</strong></div>
            ${bar(v / max * 100, 'var(--npp-season-grad, #3b82f6)')}</div>`;
    }).join('') + '</div>';
}
