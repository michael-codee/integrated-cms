from .models import SyncConflict


def record_conflict(request, *, entity, instance, payload, base_version, server_data, reason, label=""):
    return SyncConflict.objects.create(
        entity=entity, entity_id=str(instance.pk), label=label or str(instance)[:240], user=request.user,
        device_id=request.META.get("HTTP_X_DEVICE_ID", "")[:64], org_unit=getattr(instance, "org_unit", None),
        client_payload=_jsonable(payload), server_snapshot=_jsonable(server_data), base_version=base_version,
        server_version=getattr(instance, "version", None), reason=reason[:300],
    )


def _jsonable(data):
    import json

    from django.core.serializers.json import DjangoJSONEncoder

    try:
        return json.loads(json.dumps(data, cls=DjangoJSONEncoder))
    except (TypeError, ValueError):
        return {}
