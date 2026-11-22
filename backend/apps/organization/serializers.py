import copy
import re

from django.db.models import Q

from rest_framework import serializers

from .models import OrgUnit, OrgUnitHistory, StructureLevel


def generate_code(unit_type, name):
    letters = re.sub(r"[^A-Z]", "", name.upper())[:3] or "XXX"
    level = StructureLevel.objects.filter(code=unit_type).first()
    head = (level.code_prefix if level and level.code_prefix else (unit_type or "U")[:2]).upper()
    prefix = f"{head}-{letters}"
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


class StructureLevelSerializer(serializers.ModelSerializer):
    is_system = serializers.BooleanField(read_only=True)
    unit_count = serializers.SerializerMethodField()

    class Meta:
        model = StructureLevel
        fields = ["id", "code", "name", "plural_name", "rank", "code_prefix", "holds_members", "icon",
                  "description", "is_active", "is_system", "unit_count"]

    def get_unit_count(self, obj):
        counts = self.context.get("unit_counts")
        if counts is None:
            return OrgUnit.objects.filter(unit_type=obj.code).count()
        return counts.get(obj.code, 0)

    def validate_code(self, value):
        value = (value or "").strip().lower().replace("-", "_")
        if self.instance and value != self.instance.code:
            raise serializers.ValidationError("A level's code cannot be changed once created.")
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,19}", value):
            raise serializers.ValidationError("Use 2-20 lowercase letters, digits or underscores, starting with a letter.")
        return value

    def validate_code_prefix(self, value):
        value = re.sub(r"[^A-Z0-9]", "", (value or "").upper())
        if not value:
            raise serializers.ValidationError("Enter a short prefix such as ZN.")
        return value[:4]

    def validate(self, attrs):
        inst = self.instance
        if "name" in attrs and not (attrs.get("plural_name") or getattr(inst, "plural_name", "")):
            attrs["plural_name"] = attrs["name"] if attrs["name"].endswith("s") else f"{attrs['name']}s"
        code = attrs.get("code", getattr(inst, "code", None))
        rank = attrs.get("rank", getattr(inst, "rank", None))
        root = code == "headquarters"
        if root and rank != 0:
            raise serializers.ValidationError({"rank": "Headquarters is always the top level."})
        if not root and (rank is None or rank <= 0):
            raise serializers.ValidationError({"rank": "Only headquarters can be at the top; choose a position below it."})
        if inst and inst.is_system and attrs.get("is_active") is False:
            raise serializers.ValidationError({"is_active": f"{inst.name} is a system level and is always in use."})
        if inst and rank != inst.rank:
            self._check_rank_change(inst, rank)
        return attrs

    def _check_rank_change(self, level, new_rank):
        """Moving a level must keep every existing parent above its children."""
        ranks = dict(StructureLevel.objects.values_list("code", "rank"))
        ranks[level.code] = new_rank
        pairs = (OrgUnit.objects.filter(parent__isnull=False)
                 .filter(Q(unit_type=level.code) | Q(parent__unit_type=level.code))
                 .values_list("parent__unit_type", "unit_type").distinct())
        for parent_type, child_type in pairs:
            if ranks.get(parent_type, 0) >= ranks.get(child_type, 0):
                raise serializers.ValidationError({"rank": (
                    f"Existing {StructureLevel.objects.get(code=child_type).name} units sit under "
                    f"{StructureLevel.objects.get(code=parent_type).name} units, so this position would break "
                    "the current structure. Move those units first.")})
