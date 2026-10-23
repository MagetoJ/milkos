"""Reporting center: /api/v1/reports/{kind}?date_from=&date_to=&format=json|csv|xlsx

  COOP_ADMIN / MANAGER   their own cooperative only (a different cooperative_id is refused with 403)
  SUPER_ADMIN            the whole platform, or one cooperative with ?cooperative_id=
Some reports need more than REPORT_READ: audit (AUDIT_READ) and payments/pricing (FARMER_PAYMENT_READ / PRICING_READ).
"""
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.dependencies.auth import require_permission
from app.api.dependencies.db import get_db
from app.core.permissions import Permission
from app.core.utils import optional_uuid
from app.domain.exceptions import NotFound
from app.infrastructure.exports import xlsx
from app.services import reporting, reports as legacy_reports
from app.services.principal import Principal, cooperative_scope

router = APIRouter(prefix="/api/v1/reports", tags=["Reports"])

EXTRA_PERMISSION = {
    "audit": Permission.AUDIT_READ,
    "payments": Permission.FARMER_PAYMENT_READ,
    "pricing": Permission.PRICING_READ,
}


@router.get("")
def catalogue(principal: Principal = Depends(require_permission(Permission.REPORT_READ))):
    titles = {
        "collections": "Collections", "farmers": "Farmers", "collectors": "Collectors", "coolers": "Coolers",
        "centres": "Centres", "sms": "SMS", "payments": "Farmer payments", "pricing": "Milk pricing",
        "corrections": "Corrections", "reversals": "Reversals", "audit": "Audit trail", "sync": "Offline sync",
        "summary": "Cooperative summary",
    }
    return [
        {"kind": kind, "title": titles[kind], "available": principal.can(EXTRA_PERMISSION[kind]) if kind in EXTRA_PERMISSION else True}
        for kind in reporting.REPORTS
    ]


@router.get("/{kind}")
def run_report(
    kind: str,
    date_from: Optional[datetime.date] = None,
    date_to: Optional[datetime.date] = None,
    cooperative_id: Optional[str] = None,
    format: str = Query("json", pattern="^(json|csv|xlsx)$"),
    farmer_id: Optional[str] = None,
    collector_id: Optional[str] = None,
    cooler_id: Optional[str] = None,
    centre_id: Optional[str] = None,
    quality_status: Optional[str] = Query(None, pattern="^(ACCEPTED|REJECTED|PENDING)$"),
    status: Optional[str] = Query(None, max_length=30, pattern="^[A-Z_]+$"),
    action: Optional[str] = Query(None, max_length=60, pattern="^[A-Z_]+$"),
    include_history: bool = False,
    principal: Principal = Depends(require_permission(Permission.REPORT_READ)),
    db: Session = Depends(get_db),
):
    builder = reporting.REPORTS.get(kind)
    if builder is None:
        raise NotFound("Report", "Unknown report")
    if kind in EXTRA_PERMISSION:
        principal.require(EXTRA_PERMISSION[kind])
    coop = cooperative_scope(principal, optional_uuid(cooperative_id, "Cooperative"))
    start, end = legacy_reports.resolve_range(date_from, date_to)
    filters = {
        "farmer_id": optional_uuid(farmer_id, "Farmer"),
        "collector_id": optional_uuid(collector_id, "Collector"),
        "cooler_id": optional_uuid(cooler_id, "Cooler"),
        "centre_id": optional_uuid(centre_id, "Centre"),
        "quality_status": quality_status, "status": status, "action": action, "include_history": include_history,
    }
    report = builder(db, coop, start, end, filters)
    if format == "json":
        return report.as_json(start, end, coop)

    reporting.record_export(db, principal, kind, report, start, end, format, coop, filters)
    name = f"milkos-{kind}-{start.isoformat()}-to-{end.isoformat()}"
    if format == "csv":
        return Response(
            content=reporting.to_csv(report).encode("utf-8-sig"), media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
        )
    header, rows = report.table()
    return Response(
        content=xlsx.build(report.title, header, rows),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'},
    )
