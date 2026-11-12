from rest_framework import serializers

from apps.finance.serializers import ClientIdMixin

from . import periods, services
from .models import ReportSubmission, ReportTemplate


class ReportTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportTemplate
        fields = ["id", "code", "name", "description", "frequency", "unit_types", "due_days", "questions", "is_active"]

    def validate_questions(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Questions must be a list.")
        keys = set()
        for q in value:
            if not isinstance(q, dict) or not str(q.get("key", "")).strip() or not str(q.get("label", "")).strip():
                raise serializers.ValidationError("Each question needs a key and a label.")
            if q["key"] in keys:
                raise serializers.ValidationError(f"Duplicate question key: {q['key']}.")
            keys.add(q["key"])
        return value

    def validate_unit_types(self, value):
        allowed = {"headquarters", "region", "district", "branch", "congregation"}
        if not value or not set(value) <= allowed:
            raise serializers.ValidationError(f"Choose from: {', '.join(sorted(allowed))}.")
        return value


class ReportSubmissionSerializer(ClientIdMixin, serializers.ModelSerializer):
    template_name = serializers.CharField(source="template.name", read_only=True)
    frequency = serializers.CharField(source="template.frequency", read_only=True)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    period_label = serializers.SerializerMethodField()
    due_date = serializers.SerializerMethodField()
    submitted_by_name = serializers.CharField(source="submitted_by.full_name", read_only=True, default=None)
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True, default=None)
    can_review = serializers.SerializerMethodField()

    class Meta:
        model = ReportSubmission
        fields = ["id", "template", "template_name", "frequency", "org_unit", "org_unit_name", "period_start",
                  "period_end", "period_label", "due_date", "status", "figures", "answers", "submitted_at",
                  "submitted_by_name", "reviewed_at", "reviewed_by_name", "review_comment", "can_review", "version",
                  "client_created_at", "created_at"]
        read_only_fields = ["status", "figures", "submitted_at", "reviewed_at", "review_comment", "version",
                            "created_at"]
        extra_kwargs = {"period_end": {"required": False}}

    def get_period_label(self, obj):
        return periods.label(obj.template.frequency, obj.period_start)

    def get_due_date(self, obj):
        return services.due_date(obj.template, obj.period_end)

    def get_can_review(self, obj):
        request = self.context.get("request")
        return bool(request and services.can_review(request.user, obj))

    def validate(self, attrs):
        if self.instance is not None:
            attrs.pop("id", None)
            for locked in ("template", "org_unit", "period_start", "period_end"):
                if locked in attrs and attrs[locked] != getattr(self.instance, locked):
                    raise serializers.ValidationError({locked: "Cannot be changed after the report is created."})
            if self.instance.status in (ReportSubmission.Status.SUBMITTED, ReportSubmission.Status.APPROVED):
                raise serializers.ValidationError("Submitted reports cannot be edited. Ask the reviewer to return it.")
            return attrs
        template, unit, start = attrs["template"], attrs["org_unit"], attrs["period_start"]
        if not template.is_active:
            raise serializers.ValidationError({"template": "This report template is no longer in use."})
        if unit.unit_type not in template.unit_types:
            raise serializers.ValidationError({"template": f"{template.name} is not completed by a {unit.get_unit_type_display().lower()}."})
        start, end = periods.period_containing(template.frequency, start)
        services.check_period(template, start, end)
        attrs["period_start"], attrs["period_end"] = start, end
        if ReportSubmission.objects.filter(template=template, org_unit=unit, period_start=start).exists():
            raise serializers.ValidationError("This unit already has this report for the period. Open it instead.")
        answers = attrs.get("answers") or {}
        if not isinstance(answers, dict):
            raise serializers.ValidationError({"answers": "Answers must be an object."})
        return attrs

    def validate_answers(self, value):
        if not isinstance(value, dict) or any(not isinstance(v, str) for v in value.values()):
            raise serializers.ValidationError("Answers must be text.")
        if sum(len(v) for v in value.values()) > 50_000:
            raise serializers.ValidationError("The report is too long.")
        return value


class ReviewSerializer(serializers.Serializer):
    accept = serializers.BooleanField()
    comment = serializers.CharField(required=False, allow_blank=True, default="")
