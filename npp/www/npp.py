# -*- coding: utf-8 -*-
"""Web Page route handler for /npp portal."""

from __future__ import annotations

import frappe
from frappe import _

from npp.api._utils import is_manager

no_cache = 1  # SPA shell, no server-side caching


def get_context(context: dict) -> dict:
    """Inject server-side context into the SPA shell template.

    Redirects unauthenticated users to /login, then exposes the
    user's linked Customer (and its display name) so the SPA can
    render the welcome banner without an extra round-trip.
    """
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = (
            f"/login?redirect-to=/npp{frappe.local.request.full_path[len('/npp'):]}"
        )
        raise frappe.Redirect

    user_doc = frappe.db.get_value(
        "User",
        frappe.session.user,
        ["custom_customer", "first_name", "full_name"],
        as_dict=True,
    ) or {}

    customer = user_doc.get("custom_customer")
    customer_name = None
    if customer:
        customer_name = frappe.db.get_value("Customer", customer, "customer_name")

    context.update(
        {
            "title": _("NPP Portal"),
            "user": frappe.session.user,
            "user_first_name": user_doc.get("first_name") or "",
            "user_full_name": user_doc.get("full_name") or "",
            "customer": customer or "",
            "customer_name": customer_name or "",
            "is_manager": 1 if is_manager() else 0,
            "no_cache": 1,
        }
    )
    return context
