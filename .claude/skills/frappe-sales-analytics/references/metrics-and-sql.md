# Sales analytics — công thức & SQL copy-paste (ERPNext v16, Sales Invoice)

Giả định: mô hình chỉ-Sales-Invoice, `update_stock=Yes`, đơn vị bán "Thùng".
`names = tuple(...)` là danh sách khách trong phạm vi.

## Helpers nền

```python
from frappe.utils import add_days, add_months, date_diff, flt, get_first_day, get_last_day, getdate

def _sum_by_customer(query, params):
    return {r["k"]: flt(r["v"]) for r in frappe.db.sql(query, params, as_dict=True)}

# Kỳ hiện tại: ĐẾN HÔM NAY (partial), không lấy cả tháng cuối
today = getdate()
start = get_first_day(add_months(today, -(months - 1)))
end   = today
# Kỳ trước (cùng độ dài, cùng số ngày đã trôi)
prev_start, prev_end = add_months(start, -months), add_months(today, -months)
# YoY
ly_start, ly_end = add_months(start, -12), add_months(today, -12)
```

## Doanh số (LOẠI opening)

```python
def rev_between(s, e):
    return flt(frappe.db.sql(
        """SELECT COALESCE(SUM(grand_total),0) FROM `tabSales Invoice`
           WHERE docstatus=1 AND customer IN %s AND posting_date BETWEEN %s AND %s
             AND IFNULL(is_opening,'No')!='Yes'""", (names, s, e))[0][0] or 0)

revenue   = rev_between(start, end)
prev_rev  = rev_between(prev_start, prev_end)
ly_rev    = rev_between(ly_start, ly_end)
growth_pct = ((revenue - prev_rev) / prev_rev * 100) if prev_rev else None
yoy_pct    = ((revenue - ly_rev)  / ly_rev  * 100) if ly_rev  else None
```

## Run-rate (ước cả tháng theo nhịp MTD)

```python
mtd = rev_between(get_first_day(today), today)
run_rate = mtd / today.day * get_last_day(today).day   # today.day = số ngày đã qua
```

## Sản lượng (thùng) — lọc uom

```python
qty = _sum_by_customer(
    """SELECT si.customer AS k, COALESCE(SUM(sii.qty),0) AS v
       FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
       WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
         AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')
       GROUP BY si.customer""", (names, start, end))
```

## Biên lợi nhuận (COGS = incoming_rate × stock_qty)

```python
row = frappe.db.sql(
    """SELECT COALESCE(SUM(sii.amount),0) AS rev,
              COALESCE(SUM(sii.incoming_rate*sii.stock_qty),0) AS cogs
       FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON sii.parent=si.name
       WHERE si.docstatus=1 AND si.customer IN %s AND si.posting_date BETWEEN %s AND %s
         AND IFNULL(si.is_opening,'No')!='Yes' AND sii.uom IN ('Thùng','Box')""",
    (names, start, end), as_dict=True)[0]
margin_pct = ((flt(row.rev)-flt(row.cogs))/flt(row.rev)*100) if row.rev else None
```

## Công nợ + Aging + DSO (GIỮ opening)

```python
buckets = {"current":0.0,"d1_30":0.0,"d31_60":0.0,"d61_90":0.0,"over_90":0.0}
debt = overdue = 0.0
for r in frappe.db.sql(
    """SELECT outstanding_amount AS amt, COALESCE(due_date,posting_date) AS due
       FROM `tabSales Invoice`
       WHERE docstatus=1 AND customer IN %s AND outstanding_amount>0""",
    (names,), as_dict=True):
    amt = flt(r.amt); debt += amt
    age = date_diff(today, r.due) if r.due else 0
    if   age <= 0:  buckets["current"] += amt
    elif age <= 30: buckets["d1_30"]  += amt; overdue += amt
    elif age <= 60: buckets["d31_60"] += amt; overdue += amt
    elif age <= 90: buckets["d61_90"] += amt; overdue += amt
    else:           buckets["over_90"]+= amt; overdue += amt
dso = (debt / rev_12 * 365) if rev_12 else None   # rev_12 = doanh số trailing 12 tháng
```

## Phân khúc vòng đời + nhịp tái đặt

```python
# fl = MAX/MIN posting_date, COUNT(*) theo khách
last, first, orders = fl.last, fl.first, int(fl.n or 0)
days_since = date_diff(today, last) if last else None
r90 = rev_between(add_days(today,-90), today)
p90 = rev_between(add_days(today,-180), add_days(today,-90))

if   last is None:                              seg = "Chưa mua"
elif days_since > 90:                           seg = "Mất"
elif days_since > 30:                           seg = "Ngủ đông"
elif first and getdate(first) >= add_days(today,-90): seg = "Mới"
elif r90 > p90*1.2:                             seg = "Tăng trưởng"
elif r90 < p90*0.8:                             seg = "Suy giảm"
else:                                           seg = "Ổn định"

avg_cycle = (date_diff(last, first)/(orders-1)) if (orders>1 and first and last) else None
overdue_reorder = bool(avg_cycle and days_since is not None and days_since > avg_cycle*1.5)
```

## Hạng A/B/C theo doanh số bình quân tháng

```python
rev_12 = rev_between(get_first_day(add_months(today,-11)), today)
avg_monthly = rev_12 / 12.0
rank = "A" if avg_monthly >= 200_000_000 else ("B" if avg_monthly >= 100_000_000 else "C")
```

## Pareto (tập trung doanh số)

```python
vals = sorted(rev_map.values(), reverse=True)   # rev_map = {customer: revenue}
total = sum(vals) or 1.0
top5_pct  = sum(vals[:5])  / total * 100
top10_pct = sum(vals[:10]) / total * 100
acc = 0.0; npp_for_80 = 0
for v in vals:
    acc += v; npp_for_80 += 1
    if acc >= total*0.8: break
```

## % đạt mục tiêu vs nhịp kỳ vọng

```python
monthly_target = flt(customer_doc.custom_monthly_target)   # Custom Field Currency
target = monthly_target * months
attainment_pct = (revenue / target * 100) if target else None
total_days   = (months-1)*30 + get_last_day(today).day
elapsed_days = (months-1)*30 + today.day
expected_pace_pct = elapsed_days / total_days * 100        # "đang đúng nhịp" nếu attainment >= pace
suggested_target = round(rev_between(get_first_day(add_months(today,-2)), today)/3*1.1, -3)  # TB 3 tháng ×1.1
```

## Xu hướng 12 tháng + overlay năm trước (1 khách)

```python
trend_start = get_first_day(add_months(today,-11))
rev_by_m = {r.m: flt(r.v) for r in frappe.db.sql(
    "SELECT DATE_FORMAT(posting_date,'%%Y-%%m') AS m, COALESCE(SUM(grand_total),0) AS v "
    "FROM `tabSales Invoice` WHERE docstatus=1 AND customer=%s AND posting_date>=%s "
    "AND IFNULL(is_opening,'No')!='Yes' GROUP BY m", (customer, trend_start), as_dict=True)}
monthly = []
for i in range(12):
    d  = getdate(add_months(trend_start, i))          # add_months trả str → getdate()
    k  = d.strftime("%Y-%m")
    lk = getdate(add_months(d, -12)).strftime("%Y-%m")
    monthly.append({"month": d.strftime("%m/%Y"), "revenue": rev_by_m.get(k,0.0),
                    "revenue_ly": rev_by_m_ly.get(lk,0.0)})
```

## Chuẩn hoá tỉnh từ territory / tên khách

```python
def _resolve_province(territory, name):
    t = (territory or "").strip()
    if t and t.lower() not in {"", "vietnam", "việt nam", "all territories"}:
        for p in PROVINCES:                      # PROVINCES: 63 tỉnh, sort theo len giảm dần
            if p.lower() in t.lower(): return _canon(p)
        return t
    for p in PROVINCES:
        if p.lower() in (name or "").lower(): return _canon(p)
    return "Khác"
# territory_clean = (số khách có tỉnh thật / tổng) >= 0.9  → mới bật chart theo tỉnh
```

## Lỗi cột hay gặp
| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| `Unknown column 'prd.customer'` | Pricing Rule Detail không có customer | lọc `pr.customer` (parent) |
| `Unknown column ... total_weight` | Item không có cột này | dùng `total_net_weight` ở parent Sales Invoice |
| `%` báo lỗi format trong sql | `%` literal đụng placeholder | đổi thành `%%` (vd `'%%Y-%%m'`) |
| số liệu doanh số phình to | quên lọc opening | thêm `IFNULL(is_opening,'No')!='Yes'` |
| "tụt -65%" sai | so partial-vs-full | period-aligned: dịch cửa sổ, cùng số ngày |
