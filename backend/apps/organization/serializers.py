import copy
import re

from rest_framework import serializers

from .models import OrgUnit, OrgUnitHistory, UnitType

PREFIX = {
    UnitType.HEADQUARTERS: "HQ",
    UnitType.REGION: "RG",
    UnitType.DISTRICT: "DT",
    UnitType.BRANCH: "BR",
    UnitType.CONGREGATION: "CG",
}


def generate_code(unit_type, name):
    letters = re.sub(r"[^A-Z]", "", name.upper())[:3] or "XXX"
    prefix = f"{PREFIX[unit_type]}-{letters}"
    n = 1
    while True:
        code = f"{prefix}-{n:03d}"
        if not OrgUnit.all_objects.filter(code=code).exists():
            return code
        n += 1


class OrgUnitSerializer(serializers.ModelSerializer):
    parent_name = serializers.CharField(source="parent.name", read_only=True, default=None)
    unit_type_display = serializers.CharField(source="get_unit_type_display", read_only=True)
    lineage = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()
    code = serializers.CharField(required=False, allow_blank=True, max_length=32)

    class Meta:
        model = OrgUnit
        fields = [
            "id", "code", "name", "unit_type", "unit_type_display", "parent", "parent_name", "path", "depth",
            "status", "established_on", "country", "province", "civil_district", "chiefdom", "town", "address",
            "latitude", "longitude", "phone", "email", "notes", "lineage", "children_count", "version",
            "created_at", "updated_at",
        ]
        read_only_fields = ["path", "depth", "version", "created_at", "updated_at"]

    def get_lineage(self, obj):
        """Names of the ancestors, e.g. ['National HQ', 'Eastern Region', 'Kono District']."""
        cache = self.context.setdefault("_unit_names", {})
        ids = obj.ancestor_ids()[:-1]
        missing = [i for i in ids if i not in cache]
        if missing:
            for u in OrgUnit.objects.filter(id__in=missing).only("id", "name", "unit_type"):
                cache[u.id] = {"id": str(u.id), "name": u.name, "unit_type": u.unit_type}
        return [cache[i] for i in ids if i in cache]

    def get_children_count(self, obj):
        return getattr(obj, "_children_count", None) if hasattr(obj, "_children_count") else obj.children.count()

    def validate_code(self, value):
        value = (value or "").strip().upper()
        if value:
            qs = OrgUnit.all_objects.filter(code=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError("This code is already used by another unit.")
        return value

    def validate(self, attrs):
        unit_type = attrs.get("unit_type") or getattr(self.instance, "unit_type", None)
        if not attrs.get("code") and not getattr(self.instance, "code", None):
            attrs["code"] = generate_code(unit_type, attrs.get("name", ""))
        elif "code" in attrs and not attrs["code"]:
            attrs.pop("code")
        if self.instance:
            candidate = copy.copy(self.instance)
            candidate._state = copy.copy(self.instance._state)
            candidate.path_before_change = self.instance.path
        else:
            candidate = OrgUnit()
        for key, value in attrs.items():
            setattr(candidate, key, value)
        candidate.clean()
        return attrs


class OrgUnitHistorySerializer(serializers.ModelSerializer):
    by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = OrgUnitHistory
        fields = ["id", "event", "changes", "note", "by", "created_at"]
