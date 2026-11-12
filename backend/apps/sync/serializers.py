from rest_framework import serializers

from .models import Device, SyncConflict


class DeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = ["id", "device_id", "label", "user_agent", "first_seen", "last_seen", "last_sync_at"]
        read_only_fields = ["device_id", "user_agent", "first_seen", "last_seen", "last_sync_at"]


class ConflictSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    resolved_by_name = serializers.CharField(source="resolved_by.full_name", read_only=True, default=None)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True, default=None)

    class Meta:
        model = SyncConflict
        fields = ["id", "entity", "entity_id", "label", "user_name", "device_id", "org_unit_name", "client_payload",
                  "server_snapshot", "base_version", "server_version", "reason", "status", "resolution",
                  "resolved_by_name", "resolved_at", "created_at"]


class ResolveSerializer(serializers.Serializer):
    resolution = serializers.ChoiceField(choices=SyncConflict.Resolution.choices)
    note = serializers.CharField(required=False, allow_blank=True, default="")
