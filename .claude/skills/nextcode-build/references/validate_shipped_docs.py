#!/usr/bin/env python3
"""Cổng kiểm fixtures/report TRƯỚC khi `bench install-app` — Frappe v16.

Validate mọi document JSON app ship (fixtures/*.json + */report/*/*.json) chống
schema THẬT của Frappe (tải từ GitHub, cache /tmp/frappe_schemas) + schema doctype
của chính app. Mô phỏng các luật install hay làm vỡ (xem fixtures-install-pitfalls.md):

  - Table field (vd Report.columns) nhận string thay vì list-of-dict
  - Select value ngoài options; scalar nhận list/dict; key không có trong schema
  - Field reqd vắng trong JSON (fixture KHÔNG áp schema default trước mandatory)
  - is_standard=1 trên Dashboard/Dashboard Chart (throw khi không developer_mode)
  - child table (istable=1) ship làm fixture standalone -> MandatoryError parent
  - Workspace.content không phải JSON list
  - Notification event thiếu field đồng hành (date_changed/value_changed)
  - Chart/Card trỏ child-table document_type thiếu parent_document_type
  - Workflow trên Single doctype; state doc_status>=1 mà doctype không is_submittable

Dùng:
  python3 validate_shipped_docs.py <path/tới/apps/myapp/myapp>   # thư mục module app (chứa modules.txt, hooks.py, fixtures/)
  # exit code 0 = sạch; 1 = có ERROR. Chạy lại sau mỗi lần sửa fixture.

Cần mạng để tải schema core lần đầu (sau đó dùng cache). Trên bench có frappe source,
có thể trỏ BASE vào file local thay vì GitHub nếu offline hoàn toàn.
"""
import glob
import json
import os
import sys
import urllib.request

CACHE = "/tmp/frappe_schemas"
BASE = "https://raw.githubusercontent.com/frappe/frappe/version-16/frappe"

CORE_SCHEMAS = {
	"report": "core/doctype/report/report.json",
	"report_column": "core/doctype/report_column/report_column.json",
	"report_filter": "core/doctype/report_filter/report_filter.json",
	"has_role": "core/doctype/has_role/has_role.json",
	"role": "core/doctype/role/role.json",
	"custom_field": "custom/doctype/custom_field/custom_field.json",
	"property_setter": "custom/doctype/property_setter/property_setter.json",
	"workflow": "workflow/doctype/workflow/workflow.json",
	"workflow_document_state": "workflow/doctype/workflow_document_state/workflow_document_state.json",
	"workflow_transition": "workflow/doctype/workflow_transition/workflow_transition.json",
	"workflow_state": "workflow/doctype/workflow_state/workflow_state.json",
	"workflow_action_master": "workflow/doctype/workflow_action_master/workflow_action_master.json",
	"notification": "email/doctype/notification/notification.json",
	"notification_recipient": "email/doctype/notification_recipient/notification_recipient.json",
	"email_template": "email/doctype/email_template/email_template.json",
	"print_format": "printing/doctype/print_format/print_format.json",
	"dashboard": "desk/doctype/dashboard/dashboard.json",
	"dashboard_chart_link": "desk/doctype/dashboard_chart_link/dashboard_chart_link.json",
	"number_card_link": "desk/doctype/number_card_link/number_card_link.json",
	"dashboard_chart": "desk/doctype/dashboard_chart/dashboard_chart.json",
	"number_card": "desk/doctype/number_card/number_card.json",
	"workspace": "desk/doctype/workspace/workspace.json",
	"workspace_link": "desk/doctype/workspace_link/workspace_link.json",
	"workspace_shortcut": "desk/doctype/workspace_shortcut/workspace_shortcut.json",
	"workspace_chart": "desk/doctype/workspace_chart/workspace_chart.json",
	"workspace_number_card": "desk/doctype/workspace_number_card/workspace_number_card.json",
	"workspace_quick_list": "desk/doctype/workspace_quick_list/workspace_quick_list.json",
}

META_KEYS = {
	"doctype", "name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
	"parent", "parentfield", "parenttype", "__islocal", "_user_tags", "_comments", "_assign", "_liked_by",
}
TABLE_FT = ("Table", "Table MultiSelect")
LAYOUT_FT = ("Section Break", "Column Break", "Tab Break", "HTML", "Heading", "Button", "Fold")
STANDARD_GUARDED = {"Dashboard", "Dashboard Chart"}  # guard "Cannot edit Standard" không miễn in_install

E, W = [], []


def fetch_schemas():
	os.makedirs(CACHE, exist_ok=True)
	for key, path in CORE_SCHEMAS.items():
		target = os.path.join(CACHE, key + ".json")
		if os.path.exists(target):
			continue
		try:
			urllib.request.urlretrieve(f"{BASE}/{path}", target)
		except Exception as ex:
			print(f"WARN: không tải được schema {key}: {ex}", file=sys.stderr)


def load_schemas(app):
	schemas = {}
	for f in glob.glob(f"{CACHE}/*.json"):
		try:
			d = json.load(open(f))
			schemas[d["name"]] = d
		except Exception:
			pass
	for f in glob.glob(f"{app}/*/doctype/*/*.json"):
		try:
			d = json.load(open(f))
		except Exception:
			continue
		if isinstance(d, dict) and d.get("doctype") == "DocType":
			schemas[d["name"]] = d
	return schemas


def check_record(schemas, rec, dt, ctx, mandatory_enforced):
	s = schemas.get(dt)
	if not s:
		W.append(f"{ctx}: không có schema cho '{dt}' (không tải được hoặc doctype lạ)")
		return
	fm = {f["fieldname"]: f for f in s.get("fields", []) if f.get("fieldname")}
	if dt in STANDARD_GUARDED and rec.get("is_standard"):
		E.append(f"{ctx}: is_standard=1 trên {dt} -> throw 'Cannot edit Standard' khi site không developer_mode")
	for k, v in rec.items():
		if k in META_KEYS:
			continue
		f = fm.get(k)
		if not f:
			E.append(f"{ctx}: key '{k}' KHÔNG có trong schema {dt}")
			continue
		ft = f.get("fieldtype")
		if ft in TABLE_FT:
			if not isinstance(v, list):
				E.append(f"{ctx}: '{k}' là {ft}->{f.get('options')} nhưng giá trị {type(v).__name__} (phải list-of-dict)")
				continue
			for i, row in enumerate(v):
				if not isinstance(row, dict):
					E.append(f"{ctx}: '{k}[{i}]' không phải dict")
					continue
				check_record(schemas, row, f.get("options"), f"{ctx}.{k}[{i}]", mandatory_enforced)
		else:
			if isinstance(v, (list, dict)):
				E.append(f"{ctx}: '{k}' ({ft}) nhận {type(v).__name__} — phải scalar")
				continue
			if ft == "Select" and v not in (None, "") and f.get("options"):
				opts = [o.strip() for o in str(f["options"]).split("\n")]
				if str(v) not in opts:
					E.append(f"{ctx}: '{k}'='{v}' ngoài options Select {opts} của {dt}")
	if mandatory_enforced:
		for fn, f in fm.items():
			if f.get("reqd") and f.get("fieldtype") not in LAYOUT_FT:
				# Fixtures KHÔNG áp schema default trước mandatory -> field reqd phải tường minh
				if fn not in rec or rec.get(fn) in (None, ""):
					hint = f" (schema default={f.get('default')!r} nhưng fixture import KHÔNG áp)" if f.get("default") not in (None, "") else ""
					E.append(f"{ctx}: thiếu field bắt buộc '{fn}' ({dt}){hint} — MandatoryError")


def check_controller_rules(schemas, rec, ctx):
	dt = rec.get("doctype")
	target = rec.get("document_type")
	tmeta = schemas.get(target, {}) if target else {}
	target_istable = bool(tmeta.get("istable"))
	target_issingle = bool(tmeta.get("issingle"))
	if dt == "Dashboard Chart" and rec.get("chart_type") not in ("Custom", "Report"):
		if target_issingle:
			E.append(f"{ctx}: document_type '{target}' là Single — DashboardChart.check_document_type throw")
		if target_istable and not rec.get("parent_document_type"):
			E.append(f"{ctx}: document_type '{target}' là child table — thiếu parent_document_type")
	if dt == "Number Card" and rec.get("type") == "Document Type":
		if target_istable and not rec.get("parent_document_type"):
			E.append(f"{ctx}: document_type '{target}' là child table — thiếu parent_document_type")
	if dt == "Workspace":
		c = rec.get("content")
		try:
			ok = isinstance(json.loads(c), list) if c not in (None, "") else False
		except Exception:
			ok = False
		if not ok:
			E.append(f"{ctx}: content phải là JSON list hợp lệ (Workspace.validate throw)")
	if dt == "Notification":
		ev = rec.get("event")
		need = {"Days Before": "date_changed", "Days After": "date_changed", "Value Change": "value_changed"}.get(ev)
		if need and not rec.get(need):
			E.append(f"{ctx}: event='{ev}' thiếu '{need}' (Notification.validate throw)")


def check_not_child_table(schemas, f):
	try:
		recs = json.load(open(f))
	except Exception as ex:
		E.append(f"{os.path.basename(f)}: JSON hỏng: {ex}")
		return
	for dt in {r.get("doctype") for r in recs if isinstance(r, dict)}:
		if schemas.get(dt, {}).get("istable"):
			E.append(f"{os.path.basename(f)}: '{dt}' là child table — không ship làm fixture standalone (seed qua parent trong after_install)")


def check_workflow_targets(schemas, app):
	wf_path = os.path.join(app, "fixtures", "workflow.json")
	if not os.path.exists(wf_path):
		return
	for wf in json.load(open(wf_path)):
		dt = wf.get("document_type")
		s = schemas.get(dt)
		ctx = f"workflow.json[{wf.get('name')}]"
		if not s:
			W.append(f"{ctx}: document_type '{dt}' không có schema (kiểm tay)")
			continue
		if s.get("issingle"):
			E.append(f"{ctx}: '{dt}' là Single — workflow.on_update chạy UPDATE tab{dt} (không có bảng) -> install VỠ")
		max_ds = max((int(st.get("doc_status", 0)) for st in (wf.get("states") or [])), default=0)
		if max_ds >= 1 and not s.get("is_submittable"):
			E.append(f"{ctx}: state doc_status>=1 nhưng '{dt}' không is_submittable -> apply_workflow vỡ")
		active = [st for st in (wf.get("states") or [])]
		for st in active:
			ae = st.get("allow_edit")
			if ae and "," in ae:
				E.append(f"{ctx}: state '{st.get('state')}' allow_edit là CSV nhiều role — tách 1 row/role")
		for t in (wf.get("transitions") or []):
			if "," in (t.get("allowed") or ""):
				E.append(f"{ctx}: transition '{t.get('action')}' allowed là CSV nhiều role — tách 1 row/role")


def main():
	if len(sys.argv) < 2:
		print(__doc__)
		print("LỖI: cần đường dẫn thư mục module app (vd apps/myapp/myapp)", file=sys.stderr)
		return 2
	app = os.path.abspath(sys.argv[1])
	if not os.path.isdir(os.path.join(app, "fixtures")) and not glob.glob(f"{app}/*/doctype"):
		print(f"WARN: '{app}' không giống thư mục module app (không thấy fixtures/ hay */doctype)", file=sys.stderr)

	fetch_schemas()
	schemas = load_schemas(app)
	check_workflow_targets(schemas, app)

	for f in sorted(glob.glob(f"{app}/fixtures/*.json")):
		check_not_child_table(schemas, f)
		try:
			recs = json.load(open(f))
		except Exception:
			continue
		for i, rec in enumerate(recs):
			if not isinstance(rec, dict):
				continue
			ctx = f"{os.path.basename(f)}[{i} {rec.get('name', '?')}]"
			check_record(schemas, rec, rec.get("doctype"), ctx, True)
			check_controller_rules(schemas, rec, ctx)

	for f in sorted(glob.glob(f"{app}/*/report/*/*.json")):
		try:
			d = json.load(open(f))
		except Exception:
			continue
		if isinstance(d, dict) and d.get("doctype") == "Report":
			check_record(schemas, d, "Report", os.path.relpath(f, app), False)

	for f in sorted(glob.glob(f"{app}/*/doctype/*/*.json")):
		try:
			d = json.load(open(f))
		except Exception:
			continue
		if not isinstance(d, dict) or d.get("doctype") != "DocType":
			continue
		for k in ("fields", "permissions", "actions", "links", "states", "indexes"):
			if k in d and not isinstance(d[k], list):
				E.append(f"{os.path.relpath(f, app)}: DocType key '{k}' không phải list")

	print(f"========== VALIDATE SHIPPED DOCS: {len(E)} ERROR / {len(W)} WARN ==========")
	for x in E:
		print("ERROR:", x)
	for x in W:
		print("WARN :", x)
	return 1 if E else 0


if __name__ == "__main__":
	sys.exit(main())
