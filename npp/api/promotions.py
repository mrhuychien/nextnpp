# -*- coding: utf-8 -*-
"""Pricing Rules visible to current NPP."""

from __future__ import annotations

import frappe

from ._utils import require_customer


@frappe.whitelist()
def active_for_user() -> list[dict]:
    customer = require_customer()
    rows = frappe.db.sql(
        """
        SELECT DISTINCT pr.name, pr.title, pr.description,
               pr.discount_percentage, pr.discount_amount,
               pr.min_qty, pr.valid_from, pr.valid_upto,
               pr.applicable_for, pr.coupon_code_based
        FROM `tabPricing Rule` pr
        LEFT JOIN `tabPricing Rule Detail` prd ON prd.parent = pr.name
        WHERE pr.disable = 0
          AND (pr.valid_from IS NULL OR pr.valid_from <= CURDATE())
          AND (pr.valid_upto IS NULL OR pr.valid_upto >= CURDATE())
          AND (
              pr.applicable_for IS NULL OR pr.applicable_for = ''
              OR (pr.applicable_for = 'Customer' AND prd.customer = %s)
          )
        ORDER BY pr.valid_upto ASC
        """,
        (customer,),
        as_dict=True,
    )
    return [dict(r) for r in rows]
