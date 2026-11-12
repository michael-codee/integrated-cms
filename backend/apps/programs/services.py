from django.db import transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.core import scoping
from apps.core.events import publish
from apps.core.exceptions import BusinessRuleError

from .models import Program


def approver_unit(program):
    return program.org_unit.parent or program.org_unit


@transaction.atomic
def submit(program, user):
    if program.status not in (Program.Status.PLANNED, Program.Status.POSTPONED):
        raise BusinessRuleError("Only planned programs can be submitted for approval.")
    program.status = Program.Status.PENDING
    program.updated_by = user
    program.save()
    audit.record(AuditLog.Action.SUBMIT, instance=program)
    publish("program.submitted", org_unit=approver_unit(program), actor=user,
            title=f"Program for approval: {program.title}", body=f"{program.org_unit.name}",
            link=f"/programs/{program.pk}", notify_perm="programs.approve")
    return program


@transaction.atomic
def decide(program, user, approve, comment=""):
    if program.status != Program.Status.PENDING:
        raise BusinessRuleError("This program is not awaiting approval.")
    unit = approver_unit(program)
    if user.pk == program.created_by_id:
        raise BusinessRuleError("Segregation of duties: you created this program.", status_code=403)
    if not scoping.can(user, "programs.approve", unit):
        raise BusinessRuleError(f"Programs of {program.org_unit.name} are approved at {unit.name}.", status_code=403)
    if not approve and not comment.strip():
        raise BusinessRuleError("Give a reason when returning a program.")
    program.status = Program.Status.APPROVED if approve else Program.Status.PLANNED
    program.decided_by, program.decided_at, program.decision_comment = user, timezone.now(), comment
    program.updated_by = user
    program.save()
    audit.record(AuditLog.Action.APPROVE if approve else AuditLog.Action.RETURN, instance=program, message=comment)
    publish("program.decided", org_unit=program.org_unit, actor=user,
            title=f"Program {'approved' if approve else 'returned'}: {program.title}", body=comment,
            link=f"/programs/{program.pk}", recipients=[program.created_by_id])
    return program


@transaction.atomic
def set_status(program, user, status, comment=""):
    allowed = {
        "completed": [Program.Status.PLANNED, Program.Status.APPROVED],
        "postponed": [Program.Status.PLANNED, Program.Status.APPROVED, Program.Status.PENDING],
        "cancelled": [Program.Status.PLANNED, Program.Status.APPROVED, Program.Status.PENDING,
                      Program.Status.POSTPONED],
        "planned": [Program.Status.POSTPONED],
    }
    if program.status not in allowed[status]:
        raise BusinessRuleError(f"A {program.get_status_display().lower()} program cannot become {status}.")
    if status == "completed" and program.starts_at > timezone.now():
        raise BusinessRuleError("A program cannot be completed before it starts.")
    if status == "cancelled" and not comment.strip():
        raise BusinessRuleError("Give a reason for cancelling.")
    before = program.status
    program.status = status
    if comment:
        program.decision_comment = comment
    program.updated_by = user
    program.save()
    audit.record(AuditLog.Action.STATUS_CHANGE, instance=program, changes={"status": [before, status]},
                 message=comment)
    if status in ("postponed", "cancelled"):
        publish(f"program.{status}", org_unit=program.org_unit, actor=user, title=f"Program {status}: {program.title}",
                body=comment, link=f"/programs/{program.pk}", notify_perm="programs.view")
    return program
