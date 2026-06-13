# -*- coding: utf-8 -*-
"""Frappe hooks for NPP Portal."""

from . import __version__ as app_version  # noqa: F401

app_name = "npp"
app_title = "NPP Portal"
app_publisher = "Hoang Giang JSC"
app_description = "B2B portal for distributors of Hoang Giang JSC"
app_email = "chien@1nguoi.com"
app_license = "MIT"

# ─────────────────────────────────────────────────────────────────────
# Static assets — included on ALL desk pages (we don't want this for
# portal-only assets, so we keep these arrays empty and load assets
# only inside www/npp.html via <link>/<script> tags)
# ─────────────────────────────────────────────────────────────────────
app_include_css = []
app_include_js = []
web_include_css = []
web_include_js = []

# ─────────────────────────────────────────────────────────────────────
# Website redirects — legacy URLs → new SPA routes
# Frappe uses these as 301 redirects via website_redirects hook.
# ─────────────────────────────────────────────────────────────────────
website_redirects = [
    {"source": r"/dat-hang", "target": "/npp#/dat-hang", "redirect_http_status": 301},
    {"source": r"/don-hang", "target": "/npp#/don-hang", "redirect_http_status": 301},
    {
        "source": r"/cap-nhat-hoa-don/(?P<name>[^/]+)/edit",
        "target": "/npp#/dat-hang?edit={name}",
        "redirect_http_status": 301,
        "match_with_query_string": False,
    },
]

# ─────────────────────────────────────────────────────────────────────
# Permissions — User→Customer mapping via the custom field
# User.custom_customer (shipped in fixtures/custom_field.json).
# If multi-user-per-customer is needed later, plug in custom logic here.
# ─────────────────────────────────────────────────────────────────────
permission_query_conditions = {}
has_permission = {}

# ─────────────────────────────────────────────────────────────────────
# Fixtures — Custom fields for Sales Invoice & Item
# (Defined in npp/fixtures/custom_field.json — auto-loaded on install)
# ─────────────────────────────────────────────────────────────────────
fixtures = [
    {
        "doctype": "Custom Field",
        "filters": [["module", "=", "NPP Portal"]],
    },
]
