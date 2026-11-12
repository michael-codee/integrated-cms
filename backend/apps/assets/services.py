"""Asset business rules: registration numbering, transfers, maintenance, disposal."""
import datetime
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.events import publish
from apps.core.exceptions import BusinessRuleError

from .models import Asset, AssetDisposal, AssetMovement, MaintenanceRecord

CLOSED = (Asset.Status.DISPOSED, Asset.Status.LOST)


def ensure_open(asset):
    if asset.status in CLOSED:
        raise BusinessRuleError("This asset has left the register and can no longer be changed.", code="asset_closed",
                                status_code=409)


# ------------------------------------------------------------------ transfers


@transaction.atomic
def request_movement(asset, to_unit, user, reason, new_location="", new_custodian=""):
    ensure_open(asset)
    if to_unit.pk == asset.org_unit_id:
        raise BusinessRuleError("The asset is already registered to that unit.", code="same_unit")
    if to_unit.status != "active":
        raise BusinessRuleError("Assets can only be transferred to an active unit.", code="inactive_unit")
    if not scoping.can(user, "assets.edit", asset.org_unit):
        raise BusinessRuleError("You cannot transfer assets of this unit.", code="forbidden", status_code=403)
    if AssetMovement.objects.filter(asset=asset, status=AssetMovement.Status.PENDING).exists():
        raise BusinessRuleError("A transfer is already pending for this asset.", code="pending_exists")
    mv = AssetMovement.objects.create(asset=asset, from_unit=asset.org_unit, to_unit=to_unit, reason=reason,
                                      new_location=new_location, new_custodian=new_custodian, created_by=user)
    audit.record(AuditLog.Action.TRANSFER, instance=asset, message=f"Transfer requested to {to_unit.name}")
    publish("asset.transfer_requested", org_unit=to_unit, actor=user,
            title=f"Asset transfer: {asset.name} ({asset.asset_no})", body=f"From {asset.org_unit.name}: {reason}",
            link=f"/assets/{asset.pk}", notify_perm="assets.approve")
    return mv


def can_decide_movement(user, mv):
    return (mv.status == AssetMovement.Status.PENDING and user.pk != mv.created_by_id
            and scoping.can(user, "assets.approve", mv.to_unit))


def can_decide_disposal(user, d):
    return (d.status == AssetDisposal.Status.PENDING and user.pk != d.created_by_id
            and scoping.can(user, "assets.approve", disposal_approver_unit(d.asset)))


@transaction.atomic
def decide_movement(mv, user, approve, comment=""):
    mv = AssetMovement.objects.select_for_update(of=("self",)).select_related("asset", "to_unit").get(pk=mv.pk)
    if mv.status != AssetMovement.Status.PENDING:
        raise BusinessRuleError("This transfer has already been decided.", code="decided")
    if user.pk == mv.created_by_id:
        raise BusinessRuleError("Segregation of duties: you requested this transfer.", code="segregation",
                                status_code=403)
    if not scoping.can(user, "assets.approve", mv.to_unit):
        raise BusinessRuleError(f"Transfers into {mv.to_unit.name} are approved there.", code="cannot_approve",
                                status_code=403)
    if not approve and not comment.strip():
        raise BusinessRuleError("Give a reason for rejecting the transfer.", code="comment_required")
    mv.status = AssetMovement.Status.APPROVED if approve else AssetMovement.Status.REJECTED
    mv.decided_by, mv.decided_at, mv.comment = user, timezone.now(), comment
    mv.save()
    asset = mv.asset
    if approve:
        ensure_open(asset)
        before = audit.snapshot(asset)
        asset.org_unit = mv.to_unit
        if mv.new_location:
            asset.location = mv.new_location
        if mv.new_custodian:
            asset.custodian = mv.new_custodian
        asset.updated_by = user
        asset.save()
        audit.record(AuditLog.Action.TRANSFER, instance=asset, changes=audit.diff(before, audit.snapshot(asset)),
                     message=f"Transferred to {mv.to_unit.name}")
    else:
        audit.record(AuditLog.Action.REJECT, instance=asset, message=f"Transfer to {mv.to_unit.name} rejected")
    publish("asset.transfer_decided", org_unit=mv.from_unit, actor=user,
            title=f"Asset transfer {'approved' if approve else 'rejected'}: {asset.name}", body=comment,
            link=f"/assets/{asset.pk}", recipients=[mv.created_by_id])
    return mv


@transaction.atomic
def cancel_movement(mv, user):
    if mv.status != AssetMovement.Status.PENDING:
        raise BusinessRuleError("Only pending transfers can be cancelled.", code="decided")
    if user.pk != mv.created_by_id and not scoping.can(user, "assets.edit", mv.from_unit):
        raise BusinessRuleError("You cannot cancel this transfer.", code="forbidden", status_code=403)
    mv.status, mv.decided_by, mv.decided_at = AssetMovement.Status.CANCELLED, user, timezone.now()
    mv.save()
    audit.record(AuditLog.Action.CANCEL, instance=mv.asset, message="Transfer cancelled")
    return mv


# ------------------------------------------------------------------ maintenance


@transaction.atomic
def record_maintenance(record: MaintenanceRecord, user):
    asset = record.asset
    ensure_open(asset)
    if record.date > timezone.localdate():
        raise BusinessRuleError("Maintenance cannot be recorded in the future; set a next due date instead.",
                                code="future_date")
    if record.next_due_date and record.next_due_date <= record.date:
        raise BusinessRuleError("The next due date must be after the maintenance date.", code="due_date")
    record.created_by = user
    record.save()
    changed = []
    if record.condition_after and record.condition_after != asset.condition:
        asset.condition = record.condition_after
        changed.append("condition")
    if asset.status == Asset.Status.MAINTENANCE and record.kind != MaintenanceRecord.Kind.INSPECTION:
        asset.status = Asset.Status.ACTIVE
        changed.append("status")
    if changed:
        asset.updated_by = user
        asset.save()
    audit.record(AuditLog.Action.CREATE, instance=record,
                 message=f"{record.get_kind_display()} on {asset.asset_no}: {record.description[:80]}")
    return record


# ------------------------------------------------------------------ disposal


def disposal_approver_unit(asset):
    """Disposal of church property is approved one level above the holding unit."""
    return asset.org_unit.parent or asset.org_unit


@transaction.atomic
def request_disposal(asset, user, method, reason, proposed_date=None, proceeds=Decimal("0")):
    ensure_open(asset)
    if not scoping.can(user, "assets.edit", asset.org_unit):
        raise BusinessRuleError("You cannot propose disposals for this unit.", code="forbidden", status_code=403)
    if AssetDisposal.objects.filter(asset=asset, status=AssetDisposal.Status.PENDING).exists():
        raise BusinessRuleError("A disposal request is already pending.", code="pending_exists")
    if not reason.strip():
        raise BusinessRuleError("A reason is required.", code="reason_required")
    d = AssetDisposal.objects.create(asset=asset, method=method, reason=reason,
                                     proposed_date=proposed_date or timezone.localdate(), proceeds=proceeds or 0,
                                     book_value_at_request=asset.book_value(), created_by=user)
    audit.record(AuditLog.Action.SUBMIT, instance=asset, message=f"Disposal requested ({d.get_method_display()})")
    publish("asset.disposal_requested", org_unit=disposal_approver_unit(asset), actor=user,
            title=f"Disposal request: {asset.name} ({asset.asset_no})", body=reason, link=f"/assets/{asset.pk}",
            notify_perm="assets.approve")
    return d


@transaction.atomic
def decide_disposal(d, user, approve, comment=""):
    d = AssetDisposal.objects.select_for_update(of=("self",)).select_related("asset__org_unit__parent").get(pk=d.pk)
    if d.status != AssetDisposal.Status.PENDING:
        raise BusinessRuleError("This disposal has already been decided.", code="decided")
    unit = disposal_approver_unit(d.asset)
    if user.pk == d.created_by_id:
        raise BusinessRuleError("Segregation of duties: you proposed this disposal.", code="segregation",
                                status_code=403)
    if not scoping.can(user, "assets.approve", unit):
        raise BusinessRuleError(f"Disposals of {d.asset.org_unit.name} assets are approved at {unit.name}.",
                                code="cannot_approve", status_code=403)
    if not approve and not comment.strip():
        raise BusinessRuleError("Give a reason for rejecting the disposal.", code="comment_required")
    d.status = AssetDisposal.Status.APPROVED if approve else AssetDisposal.Status.REJECTED
    d.decided_by, d.decided_at, d.comment = user, timezone.now(), comment
    d.save()
    asset = d.asset
    if approve:
        asset.status = Asset.Status.LOST if d.method == AssetDisposal.Method.LOST else Asset.Status.DISPOSED
        asset.disposed_on = d.proposed_date
        asset.updated_by = user
        asset.save()
        audit.record(AuditLog.Action.APPROVE, instance=asset, message=f"Disposal approved ({d.get_method_display()})")
    else:
        audit.record(AuditLog.Action.REJECT, instance=asset, message=f"Disposal rejected: {comment}")
    publish("asset.disposal_decided", org_unit=asset.org_unit, actor=user,
            title=f"Disposal {'approved' if approve else 'rejected'}: {asset.name}", body=comment,
            link=f"/assets/{asset.pk}", recipients=[d.created_by_id])
    return d


# ------------------------------------------------------------------ reporting


def asset_summary(user, unit=None):
    qs = scoping.filter_queryset(Asset.objects.all(), user, "assets.view")
    if unit is not None:
        qs = qs.filter(org_unit__path__startswith=unit.path)
    on_register = qs.exclude(status__in=CLOSED)
    today = timezone.localdate()
    assets = list(on_register.select_related("category"))
    book_total = sum((a.book_value(today) for a in assets), Decimal("0"))
    by_category = {}
    for a in assets:
        row = by_category.setdefault(a.category.name, {"category": a.category.name, "count": 0, "cost": Decimal("0"),
                                                       "book_value": Decimal("0")})
        row["count"] += 1
        row["cost"] += a.cost
        row["book_value"] += a.book_value(today)
    by_condition = dict(on_register.values_list("condition").annotate(n=Count("id")).values_list("condition", "n"))
    by_unit = list(on_register.values("org_unit__name").annotate(count=Count("id"), cost=Sum("cost"))
                   .order_by("-cost")[:25])
    soon = today + datetime.timedelta(days=30)
    due_ids = (MaintenanceRecord.objects.filter(asset__in=on_register).order_by("asset_id", "-date", "-created_at")
               .distinct("asset_id").values_list("id", flat=True))
    due = MaintenanceRecord.objects.filter(id__in=list(due_ids), next_due_date__isnull=False,
                                           next_due_date__lte=soon).select_related("asset")
    return {
        "count": len(assets),
        "total_cost": sum((a.cost for a in assets), Decimal("0")),
        "book_value": book_total,
        "by_category": sorted(by_category.values(), key=lambda r: -r["cost"]),
        "by_condition": [{"condition": k, "label": Asset.Condition(k).label, "count": by_condition.get(k, 0)}
                         for k in Asset.Condition.values],
        "by_unit": by_unit,
        "disposed": qs.filter(status__in=CLOSED).count(),
        "maintenance_due": [{"asset": str(m.asset_id), "asset_no": m.asset.asset_no, "name": m.asset.name,
                             "due": m.next_due_date, "overdue": m.next_due_date < today} for m in due[:50]],
        "insurance_expiring": on_register.filter(insurance_expiry__isnull=False,
                                                 insurance_expiry__lte=today + datetime.timedelta(days=60)).count(),
        "needs_attention": on_register.filter(Q(condition__in=["poor", "unserviceable"])).count(),
    }
