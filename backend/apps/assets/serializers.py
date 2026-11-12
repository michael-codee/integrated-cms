from rest_framework import serializers

from apps.core.files import SignedFilesMixin
from apps.finance.serializers import ClientIdMixin
from apps.organization.models import OrgUnit

from . import services
from .models import Asset, AssetDisposal, AssetMovement, MaintenanceRecord


class AssetListSerializer(SignedFilesMixin, serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    book_value = serializers.SerializerMethodField()

    class Meta:
        model = Asset
        fields = ["id", "asset_no", "name", "category", "category_name", "org_unit", "org_unit_name", "location",
                  "custodian", "condition", "status", "cost", "currency", "book_value", "acquisition_date",
                  "version", "is_demo"]

    def get_book_value(self, obj):
        return obj.book_value()


class AssetSerializer(ClientIdMixin, AssetListSerializer):
    effective_rate = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    pending_movement = serializers.SerializerMethodField()
    pending_disposal = serializers.SerializerMethodField()
    last_maintenance = serializers.SerializerMethodField()

    class Meta(AssetListSerializer.Meta):
        fields = AssetListSerializer.Meta.fields + [
            "description", "serial_number", "registration_no", "title_document_no", "size_description",
            "acquisition_method", "funding_source", "supplier", "depreciation_rate", "effective_rate",
            "warranty_expiry", "insurance_expiry", "insurance_details", "photo", "document", "disposed_on", "notes",
            "pending_movement", "pending_disposal", "last_maintenance", "created_at", "updated_at", "client_created_at"]
        read_only_fields = ["asset_no", "disposed_on", "created_at", "updated_at", "version", "is_demo"]
        extra_kwargs = {"status": {"required": False}}

    def get_pending_movement(self, obj):
        mv = obj.movements.filter(status="pending").select_related("to_unit").first()
        if not mv:
            return None
        request = self.context.get("request")
        return {"id": str(mv.id), "to_unit_name": mv.to_unit.name, "reason": mv.reason,
                "can_decide": bool(request and services.can_decide_movement(request.user, mv))}

    def get_pending_disposal(self, obj):
        d = obj.disposals.filter(status="pending").first()
        if not d:
            return None
        request = self.context.get("request")
        return {"id": str(d.id), "method": d.get_method_display(), "reason": d.reason,
                "can_decide": bool(request and services.can_decide_disposal(request.user, d))}

    def get_last_maintenance(self, obj):
        m = obj.maintenance.first()
        return {"date": m.date, "kind": m.get_kind_display(), "next_due_date": m.next_due_date} if m else None

    def validate_status(self, value):
        if value in services.CLOSED:
            raise serializers.ValidationError("Assets leave the register only through an approved disposal.")
        return value

    def validate(self, attrs):
        if self.instance is not None:
            attrs.pop("id", None)
            services.ensure_open(self.instance)
            if "org_unit" in attrs and attrs["org_unit"] != self.instance.org_unit:
                raise serializers.ValidationError({"org_unit": "Use a transfer to move an asset to another unit."})
        if attrs.get("warranty_expiry") and attrs.get("acquisition_date") and \
                attrs["warranty_expiry"] < attrs["acquisition_date"]:
            raise serializers.ValidationError({"warranty_expiry": "Warranty cannot expire before acquisition."})
        return attrs


class MovementSerializer(serializers.ModelSerializer):
    asset_name = serializers.CharField(source="asset.name", read_only=True)
    asset_no = serializers.CharField(source="asset.asset_no", read_only=True)
    from_unit_name = serializers.CharField(source="from_unit.name", read_only=True)
    to_unit_name = serializers.CharField(source="to_unit.name", read_only=True)
    requested_by = serializers.CharField(source="created_by.full_name", read_only=True)
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)
    can_decide = serializers.SerializerMethodField()
    to_unit = serializers.PrimaryKeyRelatedField(queryset=OrgUnit.objects.all())

    class Meta:
        model = AssetMovement
        fields = ["id", "asset", "asset_name", "asset_no", "from_unit", "from_unit_name", "to_unit", "to_unit_name",
                  "reason", "new_location", "new_custodian", "status", "requested_by", "decided_by_name",
                  "decided_at", "comment", "can_decide", "created_at"]
        read_only_fields = ["from_unit", "status", "decided_at", "comment", "created_at"]

    def get_can_decide(self, obj):
        request = self.context.get("request")
        return bool(request and services.can_decide_movement(request.user, obj))


class MaintenanceSerializer(serializers.ModelSerializer):
    asset_name = serializers.CharField(source="asset.name", read_only=True)
    asset_no = serializers.CharField(source="asset.asset_no", read_only=True)
    recorded_by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = MaintenanceRecord
        fields = ["id", "asset", "asset_name", "asset_no", "kind", "date", "description", "provider", "cost",
                  "condition_after", "next_due_date", "recorded_by", "created_at"]
        read_only_fields = ["created_at"]


class DisposalSerializer(serializers.ModelSerializer):
    asset_name = serializers.CharField(source="asset.name", read_only=True)
    asset_no = serializers.CharField(source="asset.asset_no", read_only=True)
    org_unit_name = serializers.CharField(source="asset.org_unit.name", read_only=True)
    requested_by = serializers.CharField(source="created_by.full_name", read_only=True)
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)
    can_decide = serializers.SerializerMethodField()

    class Meta:
        model = AssetDisposal
        fields = ["id", "asset", "asset_name", "asset_no", "org_unit_name", "method", "reason", "proposed_date",
                  "proceeds", "book_value_at_request", "status", "requested_by", "decided_by_name", "decided_at",
                  "comment", "can_decide", "created_at"]
        read_only_fields = ["book_value_at_request", "status", "decided_at", "comment", "created_at"]

    def get_can_decide(self, obj):
        request = self.context.get("request")
        return bool(request and services.can_decide_disposal(request.user, obj))


class AssetDecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    comment = serializers.CharField(required=False, allow_blank=True, default="")
