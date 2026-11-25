// Xuất Excel (.xlsx thật, Office Open XML) dựng ngay trên trình duyệt — không thư viện ngoài,
// không round-trip server (doc salep/doc/10_excel_export.md §1). Cùng API với bản salep.
//
//   const sheet = { name: 'Điểm bán', rows, columns: [{ header, value, type, width }] };
//   type : 'text' (mặc định) | 'int' | 'number' | 'percent' (0–100 → 12,5%) | 'date' | 'datetime'
//   value: (row, index) => giá trị ô (hoặc key: 'field'); null/undefined/'' → ô trống.
//   width: số ký tự (tuỳ chọn) — bỏ trống thì tự ước theo nội dung.
//
//   await buildXlsx([sheet, ...])          → Uint8Array (không đụng DOM → chạy được trên Node 22)
//   await downloadXlsx(filename, sheets)   → số dòng đã xuất (tổng các sheet); 0 dòng → toast, không tải.
//                                            Người gọi tự toast "Đã xuất N dòng" + chống bấm 2 lần.
//   fileStamp(scopeLabel, base)            → 'DiemBan_NPP-Ha-Noi_2026-10-16.xlsx'
//
// Chuỗi luôn ghi t="inlineStr" → không bao giờ thành công thức (an toàn với '=…', '+…', '@…').
// Ngày nhận 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM[:SS[.ffffff]]' (tự tách chuỗi — KHÔNG new Date(str),
// Safari iOS parse sai) hoặc Date; chuỗi không đúng dạng → ghi nguyên văn dạng chữ (không mất dữ liệu).

import { showToast } from './toast.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const MAX_CELL_CHARS = 32767;   // giới hạn ký tự / ô của Excel
const MAX_SHEET_NAME = 31;
const AUTO_WIDTH_MIN = 6;
const AUTO_WIDTH_MAX = 60;

// Chỉ số cellXfs trong styles.xml (giữ khớp với stylesXml()).
const S_HEADER = 1;
const S_INT = 2;
const S_PERCENT = 3;
const S_DATE = 4;
const S_DATETIME = 5;

// Ký tự cấm trong XML 1.0 (C0 trừ \t \n \r, U+FFFE/U+FFFF) + surrogate lẻ (cờ u → cặp hợp lệ không khớp).
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/gu;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const DT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;
const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

// ─── Chuỗi ─────────────────────────────────────────────────────────────
function xmlEscape(s) {
    return s.replace(/[&<>"']/g, (ch) => XML_ESC[ch]);
}

// Cắt theo đơn vị UTF-16 nhưng không tách đôi 1 cặp surrogate (emoji…).
function cut(s, max) {
    if (s.length <= max) return s;
    const head = s.slice(0, max);
    const last = head.charCodeAt(head.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

// Chuỗi ô: bỏ ký tự cấm, \r\n → \n, cắt ≤ 32 767 ký tự.
function cleanText(v) {
    const s = String(v).replace(BAD_XML, '').replace(/\r\n?/g, '\n');
    return cut(s, MAX_CELL_CHARS);
}

// Excel/LibreOffice giải mã _xHHHH_ (ST_Xstring) thành 1 ký tự → mọi '_' mở đầu 1 mẫu như vậy ghi thành
// _x005F_ để giữ nguyên văn. Dùng lookahead: '_x0041_x0042_' có 2 mẫu dùng chung dấu '_' giữa.
const X_PATTERN = /_(?=x[0-9A-Fa-f]{4}_)/g;
function xstr(s) {
    return xmlEscape(s.replace(X_PATTERN, '_x005F_'));
}

function longestLine(s) {
    if (s.indexOf('\n') < 0) return s.length;
    return s.split('\n').reduce((m, line) => Math.max(m, line.length), 0);
}

// ─── Số & ngày ─────────────────────────────────────────────────────────
// NaN = không phải số (chuỗi lạ → ghi dạng chữ). Chuỗi chỉ nhận dạng số thô '1234.5' / '-3' / '1e3'.
function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
        const s = v.trim();
        if (NUM_RE.test(s)) return Number(s);
    }
    return NaN;
}

// → [năm, tháng, ngày, giờ, phút, giây (có phần lẻ)] hoặc null.
function dateParts(v) {
    if (v instanceof Date) {
        if (isNaN(v.getTime())) return null;
        return [v.getFullYear(), v.getMonth() + 1, v.getDate(),
            v.getHours(), v.getMinutes(), v.getSeconds() + v.getMilliseconds() / 1000];
    }
    const m = DT_RE.exec(String(v).trim());
    if (!m) return null;
    const sec = m[6] === undefined ? 0 : Number(m[6]) + (m[7] ? Number('0.' + m[7]) : 0);
    return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), sec];
}

// → số ngày Excel (gốc 1899-12-30, hệ 1900); NaN nếu không hiểu được.
function toSerial(v, withTime) {
    const parts = dateParts(v);
    if (!parts) return NaN;
    const [y, mo, d, h, mi, sec] = parts;
    if (y < 1900 || y > 9999 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || sec >= 60) return NaN;
    const utc = Date.UTC(y, mo - 1, d);
    if (new Date(utc).getUTCDate() !== d) return NaN;           // 31/02, 30/02…
    const days = utc / 86400000 + 25569;                        // 25569 = 1899-12-30 → 1970-01-01
    if (days < 61) return NaN;                                  // trước 01/03/1900: lỗi năm nhuận 1900 của Excel
    return withTime ? days + (h * 3600 + mi * 60 + sec) / 86400 : days;
}

function intLen(n) {
    const digits = String(Math.round(Math.abs(n))).length;
    return digits + Math.floor((digits - 1) / 3) + (n < 0 ? 1 : 0);
}

// ─── Ô ─────────────────────────────────────────────────────────────────
// Trả [xml, độ dài hiển thị ước lượng]; ô trống → ['', 0].
function textCell(ref, v, style) {
    const s = cleanText(v);
    if (s === '') return ['', 0];
    const st = style ? ` s="${style}"` : '';
    return [`<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xstr(s)}</t></is></c>`, longestLine(s)];
}

// Số nguyên ≥ 2^53 mà String() in thành dãy chữ số ('11805916207174113000') → ghi dạng mũ để trình đọc
// số nguyên chính xác (openpyxl, pandas) không đọc ra 1 số khác với số double đã ghi.
function numText(n) {
    const s = String(n);
    return Math.abs(n) >= 9007199254740992 && !/[.e]/.test(s) ? n.toExponential() : s;
}

function numCell(ref, n, style) {
    const st = style ? ` s="${style}"` : '';
    return `<c r="${ref}"${st}><v>${numText(n)}</v></c>`;
}

function makeCell(ref, v, type) {
    if (v === null || v === undefined || v === '') return ['', 0];
    switch (type) {
        case 'int':
        case 'number':
        case 'percent': {
            const n = toNumber(v);
            // number NaN/±Infinity → ô trống; chuỗi/bigint không đọc được hoặc tràn ('1e400') → giữ dạng chữ.
            if (!Number.isFinite(n)) return typeof v === 'number' ? ['', 0] : textCell(ref, v, 0);
            if (type === 'int') return [numCell(ref, n, S_INT), intLen(n)];
            if (type === 'percent') return [numCell(ref, n / 100, S_PERCENT), n.toFixed(1).length + 1];
            return [numCell(ref, n, 0), Math.min(String(n).length, 12)];
        }
        case 'date':
        case 'datetime': {
            const serial = toSerial(v, type === 'datetime');
            if (Number.isNaN(serial)) return textCell(ref, v, 0);
            return type === 'date' ? [numCell(ref, serial, S_DATE), 10] : [numCell(ref, serial, S_DATETIME), 16];
        }
        default:
            return textCell(ref, v, 0);
    }
}

// 0 → A, 25 → Z, 26 → AA
function colName(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}

function cellValue(col, row, index) {
    if (typeof col.value === 'function') return col.value(row, index);
    if (col.key != null && row != null) return row[col.key];
    return null;
}

// ─── Sheet ─────────────────────────────────────────────────────────────
// Tên sheet: ≤ 31 ký tự, bỏ []:*?/\ + ký tự điều khiển, không bắt đầu/kết thúc bằng ', không trùng
// (Excel so không phân biệt hoa thường), tránh tên dành riêng "History".
function sheetNames(sheets) {
    const used = new Set();
    const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s']+|[\s']+$/g, '');
    return sheets.map((sh, i) => {
        let base = tidy(String(sh.name ?? '').replace(BAD_XML, '').normalize('NFC')
            .replace(/[\[\]:*?\/\\\u0000-\u001F]/g, ' '));
        if (!base) base = `Sheet${i + 1}`;
        if (base.toLowerCase() === 'history') base += ' 1';
        base = tidy(cut(base, MAX_SHEET_NAME)) || `Sheet${i + 1}`;
        let name = base;
        for (let k = 2; used.has(name.toLowerCase()); k++) {
            const suffix = ` (${k})`;
            name = tidy(cut(base, MAX_SHEET_NAME - suffix.length)) + suffix;
        }
        used.add(name.toLowerCase());
        return name;
    });
}

function sheetXml(sheet, selected) {
    const cols = (Array.isArray(sheet.columns) ? sheet.columns : []).filter(Boolean);
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const ncol = cols.length;
    const lastRef = ncol ? `${colName(ncol - 1)}${rows.length + 1}` : 'A1';
    const names = cols.map((_, c) => colName(c));
    // Tiêu đề in đậm + nút lọc → cộng thêm chỗ.
    const lens = cols.map((col) => Math.ceil(longestLine(cleanText(col.header ?? '')) * 1.15) + 3);
    const out = [];

    const head = cols.map((col, c) => textCell(`${names[c]}1`, col.header ?? '', S_HEADER)[0]);
    out.push(`<row r="1">${head.join('')}</row>`);

    for (let i = 0; i < rows.length; i++) {
        const r = i + 2;
        let line = `<row r="${r}">`;
        for (let c = 0; c < ncol; c++) {
            const col = cols[c];
            const [xml, len] = makeCell(`${names[c]}${r}`, cellValue(col, rows[i], i), col.type || 'text');
            line += xml;
            if (len > lens[c]) lens[c] = len;
        }
        out.push(line + '</row>');
    }

    const colsXml = ncol ? '<cols>' + cols.map((col, c) => {
        const fixed = Number(col.width);
        const w = fixed > 0 ? Math.min(fixed, 255)
            : Math.min(AUTO_WIDTH_MAX, Math.max(AUTO_WIDTH_MIN, lens[c] + 2));
        return `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
    }).join('') + '</cols>' : '';

    return XML_HEAD
        + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
        + `<dimension ref="${ncol ? 'A1:' + lastRef : 'A1'}"/>`
        + `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>`
        + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
        + '</sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15"/>'
        + colsXml
        + `<sheetData>${out.join('')}</sheetData>`
        + (ncol ? `<autoFilter ref="A1:${lastRef}"/>` : '')
        + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        + '</worksheet>';
}

// ─── Workbook parts ────────────────────────────────────────────────────
function stylesXml() {
    const font = (bold) => `<font>${bold ? '<b/>' : ''}<sz val="11"/><name val="Calibri"/><family val="2"/></font>`;
    const xf = (fmt) => `<xf numFmtId="${fmt}" fontId="0" fillId="0" borderId="0" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}/>`;
    return XML_HEAD
        + `<styleSheet xmlns="${NS_MAIN}">`
        + '<numFmts count="3">'
        + '<numFmt numFmtId="164" formatCode="0.0%"/>'
        + '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>'
        + '<numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/>'
        + '</numFmts>'
        + `<fonts count="2">${font(false)}${font(true)}</fonts>`
        + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>'
        + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
        + '<border><left/><right/><top/><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="6">'
        + xf(0)
        + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
        + '<alignment vertical="center"/></xf>'
        + xf(3) + xf(164) + xf(165) + xf(166)
        + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
        + '</styleSheet>';
}

function workbookXml(names, sheets) {
    const defs = [];
    names.forEach((name, i) => {
        const ncol = (Array.isArray(sheets[i].columns) ? sheets[i].columns : []).filter(Boolean).length;
        // Tên chứa mẫu _xHHHH_: tên trong <sheet> được thoát, còn công thức của definedName thì trình đọc
        // hiểu khác nhau → bỏ tên ẩn này (tuỳ chọn; AutoFilter vẫn nằm trong sheet).
        if (!ncol || /_x[0-9A-Fa-f]{4}_/.test(name)) return;
        const nrow = (Array.isArray(sheets[i].rows) ? sheets[i].rows.length : 0) + 1;
        const ref = `'${name.replace(/'/g, "''")}'!$A$1:$${colName(ncol - 1)}$${nrow}`;
        defs.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlEscape(ref)}</definedName>`);
    });
    return XML_HEAD
        + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
        + '<workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>'
        + names.map((name, i) => `<sheet name="${xstr(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets>'
        + (defs.length ? `<definedNames>${defs.join('')}</definedNames>` : '')
        + '</workbook>';
}

function contentTypesXml(n) {
    let s = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    for (let i = 1; i <= n; i++) {
        s += `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    }
    return s + '</Types>';
}

function rootRelsXml() {
    return XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">`
        + `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>`
        + '</Relationships>';
}

function workbookRelsXml(n) {
    let s = XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">`;
    for (let i = 1; i <= n; i++) {
        s += `<Relationship Id="rId${i}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`;
    }
    return s + `<Relationship Id="rId${n + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
}

// ─── ZIP (deflate-raw qua CompressionStream nếu có, không thì store) ──────
let CRC_TABLE = null;
function crc32(buf) {
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data) {
    if (typeof globalThis.CompressionStream !== 'function') return null;
    try {
        const stream = new Blob([data]).stream().pipeThrough(new globalThis.CompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
        return null;   // trình duyệt cũ không hỗ trợ 'deflate-raw' → store
    }
}

async function zipFiles(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const entries = await Promise.all(files.map(async ([name, text]) => {
        const data = enc.encode(text);
        const packed = await deflateRaw(data);
        const deflated = !!packed && packed.length < data.length;
        return { name: enc.encode(name), data, crc: crc32(data), body: deflated ? packed : data, method: deflated ? 8 : 0 };
    }));

    let size = 22;
    for (const e of entries) size += 30 + e.name.length + e.body.length + 46 + e.name.length;
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let p = 0;
    const u16 = (v) => { dv.setUint16(p, v, true); p += 2; };
    const u32 = (v) => { dv.setUint32(p, v, true); p += 4; };

    // Local file header (central = false) / central directory header (central = true).
    const header = (e, central) => {
        u32(central ? 0x02014b50 : 0x04034b50);
        if (central) u16(20);           // version made by
        u16(20);                        // version needed (2.0)
        u16(0x0800);                    // cờ bit 11: tên file UTF-8
        u16(e.method);
        u16(dosTime);
        u16(dosDate);
        u32(e.crc);
        u32(e.body.length);
        u32(e.data.length);
        u16(e.name.length);
        u16(0);                         // extra
        if (central) {
            u16(0);                     // comment
            u16(0);                     // disk
            u16(0);                     // internal attrs
            u32(0);                     // external attrs
            u32(e.offset);
        }
        out.set(e.name, p);
        p += e.name.length;
    };

    for (const e of entries) {
        e.offset = p;
        header(e, false);
        out.set(e.body, p);
        p += e.body.length;
    }
    const cdStart = p;
    for (const e of entries) header(e, true);
    const cdSize = p - cdStart;
    u32(0x06054b50);                    // end of central directory
    u16(0);
    u16(0);
    u16(entries.length);
    u16(entries.length);
    u32(cdSize);
    u32(cdStart);
    u16(0);
    return out;
}

// ─── API ───────────────────────────────────────────────────────────────
function sheetList(sheets) {
    return (Array.isArray(sheets) ? sheets : [sheets]).filter((s) => s && typeof s === 'object');
}

/** Dựng workbook → Uint8Array (.xlsx). Không dùng DOM. */
export async function buildXlsx(sheets) {
    let list = sheetList(sheets);
    if (!list.length) list = [{ name: 'Sheet1', columns: [], rows: [] }];   // workbook phải có ≥ 1 sheet
    const names = sheetNames(list);
    const files = [
        ['[Content_Types].xml', contentTypesXml(list.length)],
        ['_rels/.rels', rootRelsXml()],
        ['xl/workbook.xml', workbookXml(names, list)],
        ['xl/_rels/workbook.xml.rels', workbookRelsXml(list.length)],
        ['xl/styles.xml', stylesXml()],
    ];
    list.forEach((sh, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, i === 0)]));
    return zipFiles(files);
}

/** Dựng + tải file về. Trả tổng số dòng dữ liệu (mọi sheet); 0 dòng → toast cảnh báo, không tải. */
export async function downloadXlsx(filename, sheets) {
    const list = sheetList(sheets);
    const total = list.reduce((n, s) => n + (Array.isArray(s.rows) ? s.rows.length : 0), 0);
    if (!total) {
        showToast('Không có dòng nào để xuất', 'warning');
        return 0;
    }
    const bytes = await buildXlsx(list);
    let name = String(filename || '').trim() || 'DanhSach.xlsx';
    if (!/\.xlsx$/i.test(name)) name += '.xlsx';
    const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return total;
}

// Chữ ASCII cho tên file: bỏ dấu (đ→d), ký tự lạ → '-'.
function asciiSlug(s) {
    return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 60).replace(/-+$/, '');
}

/** fileStamp('NPP Hà Nội', 'DiemBan') → 'DiemBan_NPP-Ha-Noi_2026-10-16.xlsx' (ngày theo giờ máy). */
export function fileStamp(scopeLabel, base, date = new Date()) {
    const ymd = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
    return [asciiSlug(base) || 'DanhSach', asciiSlug(scopeLabel), ymd].filter(Boolean).join('_') + '.xlsx';
}
