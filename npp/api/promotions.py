# -*- coding: utf-8 -*-
"""Pricing Rules visible to current NPP."""

from __future__ import annotations

import frappe

from ._utils import require_customer


@frappe.whitelist()
def active_for_user() -> list[dict]:
    customer = require_customer()
    # Customer nằm trực tiếp ở tabPricing Rule.customer (không phải child
    # 'Pricing Rule Detail' — bảng đó không có cột customer).
    rows = frappe.db.sql(
        """
        SELECT pr.name, pr.title, pr.description,
               pr.discount_percentage, pr.discount_amount,
               pr.min_qty, pr.valid_from, pr.valid_upto,
               pr.applicable_for, pr.coupon_code_based
        FROM `tabPricing Rule` pr
        WHERE pr.disable = 0
          AND (pr.valid_from IS NULL OR pr.valid_from <= CURDATE())
          AND (pr.valid_upto IS NULL OR pr.valid_upto >= CURDATE())
          AND (
              pr.applicable_for IS NULL OR pr.applicable_for = ''
              OR (pr.applicable_for = 'Customer' AND pr.customer = %s)
          )
        ORDER BY pr.valid_upto ASC
        """,
        (customer,),
        as_dict=True,
    )
    return [dict(r) for r in rows]
