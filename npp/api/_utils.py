# -*- coding: utf-8 -*-
"""Shared helpers for NPP Portal API endpoints."""

from __future__ import annotations

import frappe
from frappe import _


def require_customer() -> str:
    """Return the Customer linked to the current session user.

    Raises PermissionError if user is Guest or has no Customer mapping.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Login required"), frappe.PermissionError)

    customer = frappe.db.get_value("User", frappe.session.user, "custom_customer")
    if not customer:
        frappe.throw(
            _("User account is not linked to any Customer. Contact administrator."),
            frappe.PermissionError,
        )
    return customer
