from rest_framework import serializers

from apps.core import scoping

from . import services
from .models import (Account, ApprovalPolicy, ApprovalPolicyStep, Budget, BudgetLine, Reconciliation, Transaction,
                     TransactionApproval)


class AccountSerializer(serializers.ModelSerializer):
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    balance = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = ["id", "org_unit", "org_unit_name", "name", "kind", "institution", "account_number", "currency",
                  "opening_balance", "opening_date", "is_active", "notes", "balance", "created_at"]
        read_only_fields = ["created_at"]

    def get_balance(self, obj):
        return services.account_balance(obj)

    def validate(self, attrs):
        if self.instance and self.instance.transactions.exists():
            for field in ("org_unit", "currency", "opening_balance", "opening_date"):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError(
                        {field: "This account already has transactions; this field can no longer change."})
        return attrs


class ApprovalStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalPolicyStep
        fields = ["order", "level", "label"]


class ApprovalPolicySerializer(serializers.ModelSerializer):
    steps = ApprovalStepSerializer(many=True)

    class Meta:
        model = ApprovalPolicy
        fields = ["id", "name", "applies_to", "unit_type", "min_amount", "max_amount", "currency", "priority",
                  "is_active", "description", "steps"]

    def validate_steps(self, steps):
        if not steps:
            raise serializers.ValidationError("A policy needs at least one approval step.")
        if len(steps) > 5:
            raise serializers.ValidationError("At most five approval steps.")
        orders = [s["order"] for s in steps]
        if len(set(orders)) != len(orders):
            raise serializers.ValidationError("Step numbers must be unique.")
        return sorted(steps, key=lambda s: s["order"])

    def validate(self, attrs):
        lo = attrs.get("min_amount", getattr(self.instance, "min_amount", 0))
        hi = attrs.get("max_amount", getattr(self.instance, "max_amount", None))
        if hi is not None and hi <= lo:
            raise serializers.ValidationError({"max_amount": "The upper limit must be greater than the lower limit."})
        return attrs

    def _save_steps(self, policy, steps):
        policy.steps.all().delete()
        for i, s in enumerate(steps, start=1):
            ApprovalPolicyStep.objects.create(policy=policy, order=i, level=s["level"], label=s.get("label", ""))

    def create(self, validated_data):
        steps = validated_data.pop("steps")
        policy = super().create(validated_data)
        self._save_steps(policy, steps)
        return policy

    def update(self, instance, validated_data):
        steps = validated_data.pop("steps", None)
        policy = super().update(instance, validated_data)
        if steps is not None:
            self._save_steps(policy, steps)
        return policy


class ApprovalEntrySerializer(serializers.ModelSerializer):
    by = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model = TransactionApproval
        fields = ["id", "step", "step_label", "decision", "comment", "by", "created_at"]


class TransactionSerializer(serializers.ModelSerializer):
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    member_name = serializers.CharField(source="member.full_name", read_only=True, default=None)
    member_no = serializers.CharField(source="member.membership_no", read_only=True, default=None)
    financial_year_name = serializers.CharField(source="financial_year.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default=None)
    submitted_by_name = serializers.CharField(source="submitted_by.full_name", read_only=True, default=None)
    reversal_of_reference = serializers.CharField(source="reversal_of.reference", read_only=True, default=None)
    reversed_by = serializers.SerializerMethodField()
    approvals = ApprovalEntrySerializer(many=True, read_only=True)
    next_step = serializers.SerializerMethodField()
    can_approve = serializers.SerializerMethodField()
    sync_state = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = ["id", "reference", "kind", "org_unit", "org_unit_name", "account", "account_name", "category",
                  "category_name", "amount", "currency", "transaction_date", "financial_year", "financial_year_name",
                  "method", "party", "member", "member_name", "member_no", "program_ref", "description",
                  "external_ref", "attachment", "status", "required_steps", "current_step", "next_step",
                  "submitted_at", "submitted_by_name", "approved_at", "created_by_name", "created_at",
                  "reversal_of", "reversal_of_reference", "reversed_by", "approvals", "can_approve", "version",
                  "sync_state", "is_demo"]
        read_only_fields = ["reference", "financial_year", "status", "required_steps", "current_step", "submitted_at",
                            "approved_at", "created_at", "reversal_of", "version", "is_demo"]
        extra_kwargs = {"currency": {"required": False}, "org_unit": {"required": False}}

    def get_reversed_by(self, obj):
        rev = getattr(obj, "reversed_by", None)
        return {"id": str(rev.id), "reference": rev.reference, "status": rev.status} if rev else None

    def get_next_step(self, obj):
        if obj.status != Transaction.Status.SUBMITTED or obj.current_step >= len(obj.required_steps):
            return None
        step = obj.required_steps[obj.current_step]
        unit = services.approver_unit(obj.org_unit, step["level"])
        return {**step, "index": obj.current_step, "total": len(obj.required_steps), "unit_name": unit.name}

    def get_can_approve(self, obj):
        request = self.context.get("request")
        if not request or obj.status != Transaction.Status.SUBMITTED:
            return False
        return services.can_approve(request.user, obj)[0]

    def get_sync_state(self, obj):
        return "synced"

    def validate(self, attrs):
        if self.instance is not None and self.instance.status != Transaction.Status.DRAFT:
            raise serializers.ValidationError("Only drafts can be edited. Approved entries are corrected by reversal.")
        account = attrs.get("account") or getattr(self.instance, "account", None)
        if account is not None:
            attrs.setdefault("currency", account.currency)
            if "org_unit" not in attrs and self.instance is None:
                attrs["org_unit"] = account.org_unit
        candidate = Transaction(**{**({f.name: getattr(self.instance, f.name) for f in Transaction._meta.concrete_fields}
                                     if self.instance else {}), **attrs})
        services.validate_entry(candidate, self.context["request"].user)
        attrs["financial_year"] = candidate.financial_year
        return attrs


class TransactionListSerializer(serializers.ModelSerializer):
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    member_name = serializers.CharField(source="member.full_name", read_only=True, default=None)

    class Meta:
        model = Transaction
        fields = ["id", "reference", "kind", "org_unit", "org_unit_name", "account_name", "category",
                  "category_name", "amount", "currency", "transaction_date", "party", "member_name", "status",
                  "current_step", "required_steps", "reversal_of", "version", "is_demo"]


class DecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, default="")
    return_to_draft = serializers.BooleanField(required=False, default=False)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField()


class BudgetLineSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    kind = serializers.CharField(source="category.kind", read_only=True)

    class Meta:
        model = BudgetLine
        fields = ["id", "category", "category_name", "kind", "amount", "notes"]


class BudgetSerializer(serializers.ModelSerializer):
    lines = BudgetLineSerializer(many=True, required=False)
    org_unit_name = serializers.CharField(source="org_unit.name", read_only=True)
    financial_year_name = serializers.CharField(source="financial_year.name", read_only=True)
    total_income = serializers.SerializerMethodField()
    total_expense = serializers.SerializerMethodField()
    submitted_by_name = serializers.CharField(source="submitted_by.full_name", read_only=True, default=None)
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)
    can_decide = serializers.SerializerMethodField()

    class Meta:
        model = Budget
        fields = ["id", "org_unit", "org_unit_name", "financial_year", "financial_year_name", "name", "currency",
                  "status", "notes", "lines", "total_income", "total_expense", "submitted_at", "submitted_by_name",
                  "decided_at", "decided_by_name", "decision_comment", "can_decide", "created_at"]
        read_only_fields = ["status", "submitted_at", "decided_at", "decision_comment", "created_at"]

    def _total(self, obj, kind):
        return sum((line.amount for line in obj.lines.all() if line.category.kind == kind), 0)

    def get_total_income(self, obj):
        return self._total(obj, "income")

    def get_total_expense(self, obj):
        return self._total(obj, "expense")

    def get_can_decide(self, obj):
        request = self.context.get("request")
        if not request or obj.status != Budget.Status.SUBMITTED:
            return False
        return (scoping.can(request.user, "budgets.approve", services.budget_approver_unit(obj))
                and request.user.pk not in {obj.created_by_id, obj.submitted_by_id})

    def validate_lines(self, lines):
        cats = [line["category"].pk for line in lines]
        if len(set(cats)) != len(cats):
            raise serializers.ValidationError("Each category can appear only once.")
        return lines

    def validate(self, attrs):
        if self.instance and self.instance.status in (Budget.Status.SUBMITTED, Budget.Status.APPROVED):
            raise serializers.ValidationError("Submitted or approved budgets cannot be edited.")
        fy = attrs.get("financial_year") or getattr(self.instance, "financial_year", None)
        if fy and fy.is_closed:
            raise serializers.ValidationError({"financial_year": "This financial year is closed."})
        return attrs

    def _save_lines(self, budget, lines):
        budget.lines.all().delete()
        BudgetLine.objects.bulk_create([BudgetLine(budget=budget, **line) for line in lines])

    def create(self, validated_data):
        lines = validated_data.pop("lines", [])
        budget = super().create(validated_data)
        self._save_lines(budget, lines)
        return budget

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        if instance.status == Budget.Status.REJECTED:
            validated_data["status"] = Budget.Status.DRAFT
        budget = super().update(instance, validated_data)
        if lines is not None:
            self._save_lines(budget, lines)
        return budget


class ReconciliationSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    org_unit_name = serializers.CharField(source="account.org_unit.name", read_only=True)
    by = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model = Reconciliation
        fields = ["id", "account", "account_name", "org_unit_name", "as_of", "statement_balance", "book_balance",
                  "difference", "notes", "by", "created_at"]
        read_only_fields = ["book_balance", "difference", "created_at"]
