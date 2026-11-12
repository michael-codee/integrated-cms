"""Entities offered to offline devices through the pull feed.

Each entry names the model, the serializer used for the device copy, the
permission that governs visibility and how the record is scoped. Records are
filtered with the same jurisdiction rules as the normal API, so a device only
ever receives what its user could see online.
"""
from django.db.models import Q

from apps.core import scoping


def _entities():
    from apps.assets.models import Asset
    from apps.assets.serializers import AssetListSerializer
    from apps.attendance.models import AttendanceRecord
    from apps.attendance.serializers import AttendanceSerializer
    from apps.finance.models import Transaction
    from apps.finance.serializers import TransactionListSerializer
    from apps.members.models import Member
    from apps.members.serializers import MemberListSerializer
    from apps.programs.models import Program
    from apps.programs.serializers import ProgramSerializer

    return {
        "members": dict(model=Member, serializer=MemberListSerializer, perm="members.view"),
        "attendance": dict(model=AttendanceRecord, serializer=AttendanceSerializer, perm="attendance.view",
                           dept="department_id", related=("org_unit", "service_type", "program", "department")),
        "programs": dict(model=Program, serializer=ProgramSerializer, perm="programs.view", dept="department_id",
                         public=True, related=("org_unit", "category", "department")),
        "transactions": dict(model=Transaction, serializer=TransactionListSerializer, perm="finance.view",
                             related=("org_unit", "account", "category")),
        "assets": dict(model=Asset, serializer=AssetListSerializer, perm="assets.view",
                       related=("org_unit", "category")),
    }


ENTITY_NAMES = ["members", "attendance", "programs", "transactions", "assets"]


def pull(request, entity, cursor, limit):
    spec = _entities()[entity]
    user = request.user
    q = scoping.scope_q(user, spec["perm"], "org_unit__path", spec.get("dept"))
    if q is None:
        return None
    if spec.get("public"):
        q = q | Q(is_public=True)
    qs = spec["model"].all_objects.filter(q, sync_seq__gt=cursor).order_by("sync_seq")
    if spec.get("related"):
        qs = qs.select_related(*spec["related"])
    rows = list(qs[: limit + 1])
    more = len(rows) > limit
    rows = rows[:limit]
    results, deleted = [], []
    serializer = spec["serializer"]
    for obj in rows:
        if obj.is_deleted:
            deleted.append(str(obj.pk))
            continue
        data = serializer(obj, context={"request": request}).data
        data["version"] = obj.version
        data["sync_seq"] = obj.sync_seq
        results.append(data)
    next_cursor = rows[-1].sync_seq if rows else cursor
    return {"entity": entity, "results": results, "deleted": deleted, "cursor": next_cursor, "more": more}
