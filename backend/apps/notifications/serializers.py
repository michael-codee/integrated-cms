from rest_framework import serializers

from .models import Announcement, Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "event_type", "title", "body", "link", "actor_name", "created_at", "read_at"]


class AnnouncementSerializer(serializers.ModelSerializer):
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    author = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = Announcement
        fields = ["id", "org_unit", "org_unit_name", "title", "body", "priority", "publish_at", "expires_at",
                  "is_pinned", "author", "created_at"]
        read_only_fields = ["created_at"]

    def validate(self, attrs):
        start = attrs.get("publish_at") or getattr(self.instance, "publish_at", None)
        end = attrs.get("expires_at")
        if start and end and end <= start:
            raise serializers.ValidationError({"expires_at": "The expiry must be after publication."})
        return attrs
